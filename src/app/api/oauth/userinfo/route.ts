/**
 * GET /api/oauth/userinfo — OIDC UserInfo. Requires Bearer access token with
 * `openid` scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyAccessToken } from "@/lib/oauth/tokens";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  if (!m) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv"' } },
    );
  }
  const tok = await verifyAccessToken(m[1]);
  if (!tok || !tok.userId) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv", error="invalid_token"' } },
    );
  }
  if (!db) return NextResponse.json({ error: "server_error" }, { status: 500 });

  const [u] = await db.select().from(users).where(eq(users.id, tok.userId)).limit(1);
  if (!u) return NextResponse.json({ error: "invalid_token" }, { status: 401 });

  const claims: Record<string, unknown> = { sub: u.id };
  if (tok.scopes.includes("profile")) {
    claims.name = u.displayName ?? null;
    claims.preferred_username = u.walletAddress;
  }
  if (tok.scopes.includes("email") && u.email) {
    claims.email = u.email;
    claims.email_verified = false;
  }
  return NextResponse.json(claims, { headers: { "Cache-Control": "no-store" } });
}
