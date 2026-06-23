/**
 * GET  /api/oauth/authorize — validate request, log in if needed, then either
 *                             auto-approve (saved consent) or 302 → /oauth/consent.
 * POST /api/oauth/authorize — consent submit: mint code, 302 → client redirect_uri.
 *
 * Authorization Code + PKCE (S256) flow only — implicit and plain are refused.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAuthCodes, oauthConsents } from "@/db/schema";
import { getClient, redirectUriAllowed } from "@/lib/oauth/clients";
import { parseScopeString, scopesEqual, type OAuthScope } from "@/lib/oauth/scopes";
import { getOAuthUser } from "@/lib/oauth/session";
import { hashToken } from "@/lib/oauth/tokens";
import {
  PENDING_REQUEST_COOKIE,
  readPendingRequest,
  signPendingRequest,
} from "@/lib/oauth/pending-request";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errRedirect(redirectUri: string, error: string, description: string, state?: string) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return NextResponse.redirect(u, { status: 302 });
}

function htmlError(status: number, msg: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>OAuth error</title><body style="font-family:ui-sans-serif,system-ui;padding:24px;color:#1f2937"><h1 style="color:#7c3aed">OAuth error</h1><p>${msg}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const scopeRaw = url.searchParams.get("scope") ?? "";
  const state = url.searchParams.get("state") ?? undefined;
  const nonce = url.searchParams.get("nonce") ?? undefined;
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";

  if (!clientId) return htmlError(400, "Missing client_id.");
  const client = await getClient(clientId);
  if (!client) return htmlError(400, "Unknown client_id.");
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return htmlError(400, "redirect_uri is not registered for this client.");
  }
  if (responseType !== "code") {
    return errRedirect(redirectUri, "unsupported_response_type", "Only response_type=code is supported", state);
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return errRedirect(
      redirectUri,
      "invalid_request",
      "PKCE is required: code_challenge + code_challenge_method=S256",
      state,
    );
  }

  const scopes = parseScopeString(scopeRaw);
  if (scopes.length === 0) {
    return errRedirect(redirectUri, "invalid_scope", "No supported scopes requested", state);
  }
  // Disallow scopes the client wasn't registered with (if any were declared).
  if (client.scopes.length > 0) {
    const disallowed = scopes.filter((s) => !client.scopes.includes(s));
    if (disallowed.length > 0) {
      return errRedirect(
        redirectUri,
        "invalid_scope",
        `Client not authorized for scope(s): ${disallowed.join(" ")}`,
        state,
      );
    }
  }

  const user = await getOAuthUser();
  if (!user) {
    // Bounce through dreyv login; come back to the same /authorize URL.
    const next = `/auth?redirect=${encodeURIComponent(url.pathname + url.search)}`;
    return NextResponse.redirect(new URL(next, getSiteOrigin()), { status: 302 });
  }

  // Already-consented? Auto-approve.
  if (db) {
    const [existing] = await db
      .select()
      .from(oauthConsents)
      .where(and(eq(oauthConsents.userId, user.id), eq(oauthConsents.clientId, clientId)))
      .limit(1);

    if (existing && scopes.every((s) => existing.scopes.includes(s))) {
      const code = `doa_${randomBytes(32).toString("base64url")}`;
      await db.insert(oauthAuthCodes).values({
        codeHash: hashToken(code),
        clientId,
        userId: user.id,
        scopes,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        nonce: nonce ?? null,
        state: state ?? null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      const dest = new URL(redirectUri);
      dest.searchParams.set("code", code);
      if (state) dest.searchParams.set("state", state);
      return NextResponse.redirect(dest, { status: 302 });
    }
  }

  // Render consent. Persist the full request in a signed cookie keyed by id.
  const requestId = `req_${randomBytes(12).toString("base64url")}`;
  const { cookie } = await signPendingRequest({
    request_id: requestId,
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    created_at: Date.now(),
  });

  const consentUrl = new URL("/oauth/consent", getSiteOrigin());
  const res = NextResponse.redirect(consentUrl, { status: 302 });
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure: getSiteOrigin().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: cookie.maxAge,
  });
  return res;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const decision = String(form.get("decision") ?? "deny");
  const cookieValue = req.cookies.get(PENDING_REQUEST_COOKIE)?.value;
  const pending = await readPendingRequest(cookieValue);
  if (!pending) return htmlError(400, "Authorization request expired. Please start over from your MCP client.");

  const user = await getOAuthUser();
  if (!user) return htmlError(401, "Sign in to dreyv first, then retry.");

  const dest = new URL(pending.redirect_uri);
  if (pending.state) dest.searchParams.set("state", pending.state);

  if (decision !== "allow") {
    dest.searchParams.set("error", "access_denied");
    dest.searchParams.set("error_description", "User denied the request.");
    const res = NextResponse.redirect(dest, { status: 302 });
    res.cookies.delete(PENDING_REQUEST_COOKIE);
    return res;
  }

  if (!db) return htmlError(500, "Database unavailable.");

  // Persist consent for next time.
  await db
    .insert(oauthConsents)
    .values({
      userId: user.id,
      clientId: pending.client_id,
      scopes: pending.scopes,
    })
    .onConflictDoUpdate({
      target: [oauthConsents.userId, oauthConsents.clientId],
      set: { scopes: pending.scopes as OAuthScope[], grantedAt: new Date() },
    });

  const code = `doa_${randomBytes(32).toString("base64url")}`;
  await db.insert(oauthAuthCodes).values({
    codeHash: hashToken(code),
    clientId: pending.client_id,
    userId: user.id,
    scopes: pending.scopes,
    redirectUri: pending.redirect_uri,
    codeChallenge: pending.code_challenge,
    codeChallengeMethod: "S256",
    nonce: pending.nonce ?? null,
    state: pending.state ?? null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  dest.searchParams.set("code", code);
  const res = NextResponse.redirect(dest, { status: 302 });
  res.cookies.delete(PENDING_REQUEST_COOKIE);
  return res;
}
