/**
 * OAuth token signing, hashing, and refresh-token rotation.
 */

import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, importJWK, type JWTPayload } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { oauthTokens } from "@/db/schema";
import { getActiveSigner, getVerifierKeys } from "@/lib/oauth/keys";
import { getSiteOrigin } from "@/lib/seo/site";

const ACCESS_TTL_SECONDS = 3600;            // 1h
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export interface IssueTokensInput {
  clientId: string;
  userId: string | null; // null = client_credentials
  scopes: string[];
  parentRefreshHash?: string | null;
}

export interface IssuedTokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string;
  jti: string;
  refreshExpiresAt: Date | null;
}

export async function issueTokens(input: IssueTokensInput): Promise<IssuedTokenSet> {
  if (!db) throw new Error("Database unavailable");
  const origin = getSiteOrigin();
  const signer = await getActiveSigner();

  const jti = randomToken(16);
  const now = Math.floor(Date.now() / 1000);
  const expSec = now + ACCESS_TTL_SECONDS;

  const payload: JWTPayload = {
    iss: origin,
    aud: `${origin}/api`,
    sub: input.userId ?? `client:${input.clientId}`,
    client_id: input.clientId,
    scope: input.scopes.join(" "),
    jti,
  };

  const accessToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: signer.alg, kid: signer.kid, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(expSec)
    .sign(signer.privateKey);

  const accessHash = hashToken(accessToken);
  await db.insert(oauthTokens).values({
    tokenHash: accessHash,
    tokenType: "access",
    clientId: input.clientId,
    userId: input.userId ?? null,
    scopes: input.scopes,
    jti,
    parentRefreshHash: null,
    expiresAt: new Date(expSec * 1000),
  });

  // Refresh tokens only for user-bound sessions with offline_access scope
  // (or when there's no explicit scope filter — issue by default for code flow).
  let refreshToken: string | null = null;
  let refreshExpiresAt: Date | null = null;
  if (input.userId) {
    refreshToken = `dor_${randomToken(36)}`;
    refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await db.insert(oauthTokens).values({
      tokenHash: hashToken(refreshToken),
      tokenType: "refresh",
      clientId: input.clientId,
      userId: input.userId,
      scopes: input.scopes,
      jti: null,
      parentRefreshHash: input.parentRefreshHash ?? null,
      expiresAt: refreshExpiresAt,
    });
  }

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TTL_SECONDS,
    scope: input.scopes.join(" "),
    jti,
    refreshExpiresAt,
  };
}

export interface VerifiedAccessToken {
  jti: string;
  sub: string;
  clientId: string;
  userId: string | null;
  scopes: string[];
  exp: number;
}

/**
 * Verify a presented Bearer access token. Returns null if invalid, expired,
 * revoked, or not issued by us.
 */
export async function verifyAccessToken(raw: string): Promise<VerifiedAccessToken | null> {
  if (!raw || !raw.includes(".") || !raw.startsWith("ey")) return null;
  const verifiers = await getVerifierKeys();
  if (verifiers.length === 0) return null;
  const origin = getSiteOrigin();

  let payload: JWTPayload | null = null;
  for (const v of verifiers) {
    try {
      const key = await importJWK(v.publicJwk, v.alg);
      const result = await jwtVerify(raw, key, {
        issuer: origin,
        audience: `${origin}/api`,
      });
      payload = result.payload;
      break;
    } catch {
      // try next key
    }
  }
  if (!payload) return null;

  // Check our hash table for revocation.
  if (!db) return null;
  const tokenHash = hashToken(raw);
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.tokenType, "access")))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const clientId =
    typeof (payload as Record<string, unknown>).client_id === "string"
      ? ((payload as Record<string, unknown>).client_id as string)
      : row.clientId;
  const scopeStr = typeof (payload as Record<string, unknown>).scope === "string"
    ? ((payload as Record<string, unknown>).scope as string)
    : row.scopes.join(" ");

  return {
    jti: typeof payload.jti === "string" ? payload.jti : (row.jti ?? ""),
    sub,
    clientId,
    userId: row.userId ?? null,
    scopes: scopeStr.split(/\s+/).filter(Boolean),
    exp: typeof payload.exp === "number" ? payload.exp : Math.floor(row.expiresAt.getTime() / 1000),
  };
}

export interface RefreshTokenRecord {
  tokenHash: string;
  clientId: string;
  userId: string;
  scopes: string[];
  parentRefreshHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function consumeRefreshToken(
  raw: string,
  presentedClientId: string,
): Promise<RefreshTokenRecord | { reuseDetected: true; chainRoot: string }> {
  if (!db) throw new Error("Database unavailable");
  const tokenHash = hashToken(raw);
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.tokenType, "refresh")))
    .limit(1);

  if (!row) {
    return { reuseDetected: false } as never;
  }
  if (row.clientId !== presentedClientId) {
    return { reuseDetected: false } as never;
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { reuseDetected: false } as never;
  }

  if (row.revokedAt) {
    // Reuse detected — revoke the entire chain rooted at this token's parent
    // (or this token if it's the root).
    const root = row.parentRefreshHash ?? row.tokenHash;
    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthTokens.parentRefreshHash, root),
          isNull(oauthTokens.revokedAt),
        ),
      );
    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthTokens.tokenHash, root), isNull(oauthTokens.revokedAt)));
    return { reuseDetected: true, chainRoot: root };
  }

  // Mark consumed (revoked). Caller will mint a replacement linked to chain.
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthTokens.tokenHash, row.tokenHash));

  return {
    tokenHash: row.tokenHash,
    clientId: row.clientId,
    userId: row.userId as string,
    scopes: row.scopes,
    parentRefreshHash: row.parentRefreshHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export async function revokeByToken(raw: string): Promise<boolean> {
  if (!db) return false;
  const tokenHash = hashToken(raw);
  const result = await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.tokenHash, tokenHash), isNull(oauthTokens.revokedAt)))
    .returning({ tokenHash: oauthTokens.tokenHash });
  return result.length > 0;
}

export async function introspectToken(raw: string): Promise<
  | { active: false }
  | {
      active: true;
      scope: string;
      client_id: string;
      sub: string | null;
      exp: number;
      iat: number;
      token_type: "Bearer";
    }
> {
  if (!db) return { active: false };
  const tokenHash = hashToken(raw);
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return { active: false };
  if (row.revokedAt) return { active: false };
  if (row.expiresAt.getTime() < Date.now()) return { active: false };

  return {
    active: true,
    scope: row.scopes.join(" "),
    client_id: row.clientId,
    sub: row.userId ?? null,
    exp: Math.floor(row.expiresAt.getTime() / 1000),
    iat: Math.floor(row.createdAt.getTime() / 1000),
    token_type: "Bearer",
  };
}
