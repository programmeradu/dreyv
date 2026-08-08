/**
 * OAuth client registry + Dynamic Client Registration (RFC 7591).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, getDb } from "@/db";
import { oauthClients, oauthRegistrationAttempts } from "@/db/schema";
import { OAUTH_SCOPES, type OAuthScope } from "@/lib/oauth/scopes";

export const SUPPORTED_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
  "client_credentials",
  "urn:ietf:params:oauth:grant-type:device_code",
] as const;

const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];
const DEFAULT_RESPONSE_TYPES = ["code"];

export type TokenEndpointAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

export interface RegistrationRequest {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: TokenEndpointAuthMethod;
  scope?: string;
  software_id?: string;
  software_version?: string;
}

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  scope: string;
  client_name: string;
  registration_access_token: string;
  registration_client_uri: string;
}

function hash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function newClientId(): string {
  return `doc_${randomBytes(12).toString("base64url")}`;
}

function newClientSecret(): string {
  return `dos_${randomBytes(32).toString("base64url")}`;
}

function isValidRedirectUri(raw: string, allowLoopback: boolean): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") {
      // Loopback for native MCP clients (RFC 8252).
      return allowLoopback && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
    }
    // Custom schemes allowed for native apps.
    if (/^[a-z][a-z0-9+\-.]+:/i.test(raw) && u.protocol !== "javascript:") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const REGISTRATION_DAILY_CAP = 50;

export async function bumpRegistrationCounter(ip: string): Promise<number> {
  const database = getDb();
  if (!database) return 0;
  const today = new Date().toISOString().slice(0, 10);
  await database
    .insert(oauthRegistrationAttempts)
    .values({ ip, day: today, count: 1 })
    .onConflictDoUpdate({
      target: [oauthRegistrationAttempts.ip, oauthRegistrationAttempts.day],
      set: { count: sql`${oauthRegistrationAttempts.count} + 1` },
    });
  const [row] = await database
    .select()
    .from(oauthRegistrationAttempts)
    .where(
      and(
        eq(oauthRegistrationAttempts.ip, ip),
        eq(oauthRegistrationAttempts.day, today),
      ),
    )
    .limit(1);
  return row?.count ?? 1;
}

export async function registerClient(
  req: RegistrationRequest,
  meta: { ip: string; createdByUserId?: string | null },
): Promise<{ ok: true; client: RegisteredClient } | { ok: false; error: string; description: string }> {
  const database = getDb();
  if (!database) return { ok: false, error: "server_error", description: "Database unavailable" };

  if (!Array.isArray(req.redirect_uris) || req.redirect_uris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris is required" };
  }
  if (req.redirect_uris.length > 10) {
    return { ok: false, error: "invalid_redirect_uri", description: "Too many redirect_uris" };
  }
  for (const uri of req.redirect_uris) {
    if (!isValidRedirectUri(uri, true)) {
      return { ok: false, error: "invalid_redirect_uri", description: `Invalid redirect_uri: ${uri}` };
    }
  }

  const grantTypes = (req.grant_types ?? DEFAULT_GRANT_TYPES).filter((g) =>
    (SUPPORTED_GRANT_TYPES as readonly string[]).includes(g),
  );
  if (grantTypes.length === 0) {
    return { ok: false, error: "invalid_client_metadata", description: "No supported grant_types" };
  }

  const responseTypes = (req.response_types ?? DEFAULT_RESPONSE_TYPES).filter((r) =>
    ["code"].includes(r),
  );

  const authMethod: TokenEndpointAuthMethod =
    req.token_endpoint_auth_method === "client_secret_basic" ||
    req.token_endpoint_auth_method === "client_secret_post"
      ? req.token_endpoint_auth_method
      : "none";

  const requestedScopes = (req.scope ?? "").split(/\s+/).filter(Boolean);
  const scopes = requestedScopes.filter((s) => (OAUTH_SCOPES as string[]).includes(s)) as OAuthScope[];
  if (scopes.length === 0) {
    // Default minimal scope set so the consent screen has something to show.
    scopes.push("openid", "mcp", "treasury:read");
  }

  // Rate-limit self-registration per IP per day.
  if (!meta.createdByUserId) {
    const used = await bumpRegistrationCounter(meta.ip);
    if (used > REGISTRATION_DAILY_CAP) {
      return {
        ok: false,
        error: "rate_limited",
        description: `Self-registration capped at ${REGISTRATION_DAILY_CAP}/day per IP.`,
      };
    }
  }

  const clientId = newClientId();
  const clientSecret = authMethod === "none" ? null : newClientSecret();
  const registrationAccessToken = `dort_${randomBytes(32).toString("base64url")}`;

  const clientName =
    typeof req.client_name === "string" && req.client_name.trim()
      ? req.client_name.trim().slice(0, 160)
      : "Untitled MCP Client";

  await database.insert(oauthClients).values({
    clientId,
    clientSecretHash: clientSecret ? hash(clientSecret) : null,
    clientName,
    clientUri: typeof req.client_uri === "string" ? req.client_uri.slice(0, 500) : null,
    logoUri: typeof req.logo_uri === "string" ? req.logo_uri.slice(0, 500) : null,
    redirectUris: req.redirect_uris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod: authMethod,
    scopes,
    softwareId: typeof req.software_id === "string" ? req.software_id.slice(0, 160) : null,
    softwareVersion: typeof req.software_version === "string" ? req.software_version.slice(0, 80) : null,
    registrationAccessTokenHash: hash(registrationAccessToken),
    createdByUserId: meta.createdByUserId ?? null,
  });

  const now = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    client: {
      client_id: clientId,
      client_secret: clientSecret ?? undefined,
      client_id_issued_at: now,
      client_secret_expires_at: clientSecret ? 0 : undefined,
      redirect_uris: req.redirect_uris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: authMethod,
      scope: scopes.join(" "),
      client_name: clientName,
      registration_access_token: registrationAccessToken,
      registration_client_uri: `/api/oauth/register/${clientId}`,
    },
  };
}

export async function getClient(clientId: string) {
  const database = getDb();
  if (!database) return null;
  const [row] = await database
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!row) return null;
  if (row.disabledAt) return null;
  return row;
}

export function verifyClientSecret(presented: string, stored: string | null): boolean {
  if (!stored || !presented) return false;
  const a = Buffer.from(hash(presented), "hex");
  const b = Buffer.from(stored, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function redirectUriAllowed(client: { redirectUris: string[] }, candidate: string): boolean {
  return client.redirectUris.includes(candidate);
}
