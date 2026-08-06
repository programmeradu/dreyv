/**
 * POST /api/oauth/token — RFC 6749 §3.2 + extensions.
 *
 * Supported grant types:
 *   - authorization_code      (PKCE required)
 *   - refresh_token            (rotates + chains; reuse detection)
 *   - client_credentials       (confidential clients only)
 *   - urn:ietf:params:oauth:grant-type:device_code
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAuthCodes, oauthDeviceCodes } from "@/db/schema";
import { getClient, verifyClientSecret, redirectUriAllowed } from "@/lib/oauth/clients";
import { verifyS256 } from "@/lib/oauth/pkce";
import { consumeRefreshToken, hashToken, issueTokens } from "@/lib/oauth/tokens";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function tokenError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

interface ClientAuthResult {
  clientId: string;
  client: Awaited<ReturnType<typeof getClient>>;
  authenticated: boolean; // true = confirmed via secret; false = public client (PKCE-only)
}

async function authenticateClient(req: NextRequest, form: FormData): Promise<ClientAuthResult | null> {
  // 1) HTTP Basic
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    try {
      const raw = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
      const idx = raw.indexOf(":");
      if (idx > 0) {
        const cid = decodeURIComponent(raw.slice(0, idx));
        const secret = decodeURIComponent(raw.slice(idx + 1));
        const client = await getClient(cid);
        if (!client) return null;
        if (verifyClientSecret(secret, client.clientSecretHash)) {
          return { clientId: cid, client, authenticated: true };
        }
        return null;
      }
    } catch {
      // fall through
    }
  }

  // 2) form fields
  const cid = String(form.get("client_id") ?? "");
  if (!cid) return null;
  const client = await getClient(cid);
  if (!client) return null;

  const secret = form.get("client_secret");
  if (typeof secret === "string" && secret.length > 0) {
    if (verifyClientSecret(secret, client.clientSecretHash)) {
      return { clientId: cid, client, authenticated: true };
    }
    return null;
  }

  // Public client (PKCE-only) is fine — no secret required.
  if (client.tokenEndpointAuthMethod === "none") {
    return { clientId: cid, client, authenticated: false };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const grantType = String(form.get("grant_type") ?? "");

  const auth = await authenticateClient(req, form);
  if (!auth || !auth.client) return tokenError("invalid_client", "Client authentication failed", 401);
  if (!auth.client.grantTypes.includes(grantType)) {
    return tokenError("unauthorized_client", `Client not allowed to use ${grantType}`);
  }

  if (!db) return tokenError("server_error", "Database unavailable", 500);

  // ── authorization_code ────────────────────────────────────────────────
  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const codeVerifier = String(form.get("code_verifier") ?? "");
    if (!code || !redirectUri || !codeVerifier) {
      return tokenError("invalid_request", "code, redirect_uri, code_verifier are required");
    }
    if (!redirectUriAllowed(auth.client, redirectUri)) {
      return tokenError("invalid_grant", "redirect_uri mismatch");
    }
    const codeHash = hashToken(code);
    const [row] = await db
      .select()
      .from(oauthAuthCodes)
      .where(eq(oauthAuthCodes.codeHash, codeHash))
      .limit(1);
    if (!row) return tokenError("invalid_grant", "Unknown authorization code");
    if (row.clientId !== auth.clientId) return tokenError("invalid_grant", "Code issued to different client");
    if (row.consumedAt) {
      // Replay — revoke any tokens we may have issued for this code.
      return tokenError("invalid_grant", "Authorization code already used");
    }
    if (row.expiresAt.getTime() < Date.now()) return tokenError("invalid_grant", "Authorization code expired");
    if (row.redirectUri !== redirectUri) return tokenError("invalid_grant", "redirect_uri mismatch");
    if (!verifyS256(codeVerifier, row.codeChallenge)) {
      return tokenError("invalid_grant", "PKCE verification failed");
    }

    await db
      .update(oauthAuthCodes)
      .set({ consumedAt: new Date() })
      .where(eq(oauthAuthCodes.codeHash, codeHash));

    const tokens = await issueTokens({
      clientId: auth.clientId,
      userId: row.userId,
      scopes: row.scopes,
    });

    return NextResponse.json(
      {
        access_token: tokens.accessToken,
        token_type: tokens.tokenType,
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken ?? undefined,
        scope: tokens.scope,
      },
      { status: 200, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }

  // ── refresh_token ─────────────────────────────────────────────────────
  if (grantType === "refresh_token") {
    const refresh = String(form.get("refresh_token") ?? "");
    if (!refresh) return tokenError("invalid_request", "refresh_token is required");
    const consumed = await consumeRefreshToken(refresh, auth.clientId);
    if ("reuseDetected" in consumed) {
      return tokenError("invalid_grant", "Refresh token reuse detected — chain revoked.", 400);
    }
    if (!("clientId" in consumed)) {
      return tokenError("invalid_grant", "Unknown or expired refresh_token");
    }
    const newTokens = await issueTokens({
      clientId: consumed.clientId,
      userId: consumed.userId,
      scopes: consumed.scopes,
      parentRefreshHash: consumed.parentRefreshHash ?? consumed.tokenHash,
    });
    return NextResponse.json(
      {
        access_token: newTokens.accessToken,
        token_type: newTokens.tokenType,
        expires_in: newTokens.expiresIn,
        refresh_token: newTokens.refreshToken ?? undefined,
        scope: newTokens.scope,
      },
      { status: 200, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }

  // ── client_credentials ────────────────────────────────────────────────
  if (grantType === "client_credentials") {
    if (!auth.authenticated) {
      return tokenError("invalid_client", "client_credentials requires a confidential client", 401);
    }
    const requested = String(form.get("scope") ?? "").split(/\s+/).filter(Boolean);
    const allowed = auth.client.scopes;
    const scopes = requested.length > 0 ? requested.filter((s) => allowed.includes(s)) : allowed;
    const tokens = await issueTokens({
      clientId: auth.clientId,
      userId: null,
      scopes,
    });
    return NextResponse.json(
      {
        access_token: tokens.accessToken,
        token_type: tokens.tokenType,
        expires_in: tokens.expiresIn,
        scope: tokens.scope,
      },
      { status: 200, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }

  // ── device_code ───────────────────────────────────────────────────────
  if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
    const deviceCode = String(form.get("device_code") ?? "");
    if (!deviceCode) return tokenError("invalid_request", "device_code is required");
    const dHash = hashToken(deviceCode);
    const [row] = await db
      .select()
      .from(oauthDeviceCodes)
      .where(and(eq(oauthDeviceCodes.deviceCodeHash, dHash), eq(oauthDeviceCodes.clientId, auth.clientId)))
      .limit(1);
    if (!row) return tokenError("invalid_grant", "Unknown device_code");
    if (row.expiresAt.getTime() < Date.now()) return tokenError("expired_token", "Device code expired");
    if (row.deniedAt) return tokenError("access_denied", "User denied the request");
    // Slow-down enforcement
    const minIntervalMs = row.intervalSeconds * 1000;
    if (row.lastPolledAt && Date.now() - row.lastPolledAt.getTime() < minIntervalMs) {
      await db
        .update(oauthDeviceCodes)
        .set({ lastPolledAt: new Date(), intervalSeconds: row.intervalSeconds + 5 })
        .where(eq(oauthDeviceCodes.deviceCodeHash, dHash));
      return tokenError("slow_down", "Polling too fast");
    }
    await db
      .update(oauthDeviceCodes)
      .set({ lastPolledAt: new Date() })
      .where(eq(oauthDeviceCodes.deviceCodeHash, dHash));
    if (!row.approvedUserId) return tokenError("authorization_pending", "User has not yet approved");

    const tokens = await issueTokens({
      clientId: auth.clientId,
      userId: row.approvedUserId,
      scopes: row.scopes,
    });

    // Single-use: revoke the device code by setting expires_at in the past.
    await db
      .update(oauthDeviceCodes)
      .set({ expiresAt: new Date(0) })
      .where(eq(oauthDeviceCodes.deviceCodeHash, dHash));

    return NextResponse.json(
      {
        access_token: tokens.accessToken,
        token_type: tokens.tokenType,
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken ?? undefined,
        scope: tokens.scope,
      },
      { status: 200, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }

  return tokenError("unsupported_grant_type", `grant_type=${grantType} is not supported`);
}
