/**
 * POST /api/agents/claim — agent requests a single-use claim token.
 *
 *   Authorization: Bearer dk_live_…
 *   Body: {} (no params)
 *
 * Returns:
 *   {
 *     claim_token: "agcl_…",                // present to a signed-in human within 10 min
 *     expires_at: ISO8601,
 *     redeem_url: "https://…/api/agents/claim/redeem",
 *     redeem_ui:  "https://…/app/agents/claim?token=agcl_…",
 *     notice:     "Open redeem_ui in a browser while signed into Dreyv to absorb this agent into your account."
 *   }
 *
 * The token is a JWT signed with JWT_SECRET; payload = { agentUserId, keyId, jti }.
 * Redemption is single-use, enforced server-side at /api/agents/claim/redeem.
 */

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { randomBytes } from "node:crypto";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const CLAIM_TTL_SECONDS = 10 * 60;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET missing");
  return new TextEncoder().encode(s);
}

export async function POST(req: NextRequest) {
  const key = await resolvePublicKey(extractBearer(req));
  if (!key) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Pass `Authorization: Bearer dk_live_…` from the agent that wants to be claimed.",
      },
      { status: 401 },
    );
  }
  if (key.keyPrefix === "oauth_jwt") {
    return NextResponse.json(
      {
        error: "unsupported_bearer",
        message:
          "Claims must be initiated from a dk_live_ key (the agent's persistent identity), not a short-lived OAuth token.",
      },
      { status: 400 },
    );
  }

  const jti = `agcl_${randomBytes(12).toString("base64url")}`;
  const jwt = await new SignJWT({
    agentUserId: key.userId,
    keyId: key.id,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dreyv-agent-claim")
    .setAudience("dreyv-customer")
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${CLAIM_TTL_SECONDS}s`)
    .sign(secret());

  const token = `agcl.${jwt}`;
  const origin = getSiteOrigin();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_SECONDS * 1000).toISOString();

  return NextResponse.json({
    claim_token: token,
    expires_at: expiresAt,
    redeem_url: `${origin}/api/agents/claim/redeem`,
    redeem_ui: `${origin}/app/agents/claim?token=${encodeURIComponent(token)}`,
    notice:
      "Open redeem_ui in a browser while signed into Dreyv (or POST the token to redeem_url with your SIWS cookie) within 10 minutes to absorb this agent — its API keys, prepaid balance, ledger history, hosted wallet and payment records will transfer to your account.",
  });
}
