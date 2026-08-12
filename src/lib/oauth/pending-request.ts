/**
 * Signed authorization-request cookie.
 *
 * `/api/oauth/authorize` stores the full request server-side via a short-lived
 * signed JWT cookie keyed by request_id. The consent page reads it, the POST
 * handler consumes it, mints a code, and 302s to the client redirect_uri.
 *
 * 10-minute TTL — same as auth-code lifetime.
 */

import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "dreyv-oauth-req";
const TTL_SECONDS = 600;

function secret(req?: Request): Uint8Array {
  const headerSecret = req?.headers.get("x-dreyv-jwt-secret");
  const s = headerSecret || process.env.JWT_SECRET || "dreyv-oauth-secret-fallback-2026";
  return new TextEncoder().encode(s);
}

export interface PendingAuthRequest {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  response_type: "code";
  scopes: string[];
  state?: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: "S256";
  created_at: number;
}

export async function signPendingRequest(req: Request, payload: PendingAuthRequest): Promise<{
  cookie: { name: string; value: string; maxAge: number };
}> {
  const jwt = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .setIssuer("dreyv-oauth")
    .sign(secret(req));

  return {
    cookie: { name: COOKIE_NAME, value: jwt, maxAge: TTL_SECONDS },
  };
}

export async function readPendingRequest(req: Request, raw: string | undefined): Promise<PendingAuthRequest | null> {
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret(req), { issuer: "dreyv-oauth" });
    if (
      typeof payload.request_id === "string" &&
      typeof payload.client_id === "string" &&
      typeof payload.redirect_uri === "string" &&
      Array.isArray((payload as Record<string, unknown>).scopes)
    ) {
      return payload as unknown as PendingAuthRequest;
    }
    return null;
  } catch {
    return null;
  }
}

export const PENDING_REQUEST_COOKIE = COOKIE_NAME;
