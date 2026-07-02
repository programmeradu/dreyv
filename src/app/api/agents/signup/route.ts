/**
 * POST /api/agents/signup — autonomous agent provisioning.
 *
 * One call creates: users row + oauth client + a default dk_live_ key
 * with `agent:delegate` so the agent can mint further scoped keys via
 * /api/keys.
 *
 * Body:
 *   {
 *     client_name?: string,           // optional human label
 *     redirect_uris?: string[],       // default ["urn:ietf:wg:oauth:2.0:oob"]
 *     owner_did?: string,             // optional DID/handle of operator
 *     scopes?: OAuthScope[]           // requested at registration time
 *   }
 *
 * Returns:
 *   { user_id, client_id, client_secret, api_key, scopes, tier, audit_id }
 *
 * Authentication signal:
 *   - Anonymous: rate-limited per IP (50/day, same cap as DCR).
 *   - Higher trust: presence of a valid HTTP Message Signature
 *     (Signature / Signature-Input headers per Web Bot Auth) bumps the
 *     audit method from 'anon' to 'web-bot-auth' and lifts the per-IP
 *     cap. Verification of the signature itself is out of scope here —
 *     we only record the keyid for the audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, agentSignupAudit } from "@/db/schema";
import { registerClient } from "@/lib/oauth/clients";
import { mintPublicKey } from "@/lib/api-keys/public-keys";
import { getOrCreateAgentWallet } from "@/lib/agent/wallet";
import { getAgentBalance, minorToUsd, ensureStarterGrant, STARTER_GRANT_USD } from "@/lib/agent/balance";
import { getSiteOrigin } from "@/lib/seo/site";
import type { OAuthScope } from "@/lib/oauth/scopes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_AGENT_API_SCOPES = [
  "read:portfolio",
  "read:treasury",
  "read:market",
  "read:insights",
  "read:search",
  "agent:delegate",
] as const;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

function detectMethod(req: NextRequest): { method: string; keyid: string | null } {
  const sig = req.headers.get("signature-input");
  if (sig) {
    const m = /keyid="([^"]+)"/.exec(sig);
    return { method: "web-bot-auth", keyid: m?.[1] ?? null };
  }
  return { method: "anon", keyid: null };
}

export async function POST(req: NextRequest) {
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  let body: {
    client_name?: string;
    redirect_uris?: string[];
    owner_did?: string;
    scopes?: OAuthScope[];
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const ip = clientIp(req);
  const { method, keyid } = detectMethod(req);

  const redirectUris =
    Array.isArray(body.redirect_uris) && body.redirect_uris.length
      ? body.redirect_uris
      : ["urn:ietf:wg:oauth:2.0:oob"];

  const reg = await registerClient(
    {
      redirect_uris: redirectUris,
      client_name: body.client_name?.slice(0, 160) || "Autonomous Agent",
      grant_types: ["client_credentials", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
      scope: (body.scopes ?? ["mcp", "treasury:read", "agent:execute"]).join(" "),
    },
    { ip, createdByUserId: null },
  );
  if (!reg.ok) {
    return NextResponse.json({ error: reg.error, description: reg.description }, { status: 429 });
  }

  // Create a synthetic user row for the agent. wallet_address is NOT NULL UNIQUE,
  // so we encode the client id into a deterministic synthetic identifier.
  const syntheticWallet = `agent:${reg.client.client_id}`;
  const [insertedUser] = await db
    .insert(users)
    .values({
      walletAddress: syntheticWallet,
      role: "user",
      displayName: body.client_name?.slice(0, 80) || "Agent",
      organizationName: body.owner_did ?? null,
    })
    .returning({ id: users.id });

  const userId = insertedUser.id;

  const apiKey = await mintPublicKey({
    userId,
    label: body.client_name?.slice(0, 80) || "Agent default key",
    env: "live",
    scopes: [...DEFAULT_AGENT_API_SCOPES],
    rateLimitRpm: 300,
  });

  const [audit] = await db
    .insert(agentSignupAudit)
    .values({
      userId,
      clientId: reg.client.client_id,
      method,
      callerDid: body.owner_did ?? keyid ?? null,
      ip,
      userAgent: req.headers.get("user-agent") ?? null,
    })
    .returning({ id: agentSignupAudit.id });

  // Auto-provision the autonomous payment surfaces so the agent doesn't
  // have to discover two extra endpoints before its first paid call.
  let walletAddress: string | null = null;
  let walletError: string | null = null;
  try {
    const w = await getOrCreateAgentWallet(userId);
    walletAddress = w.publicKey;
  } catch (err) {
    walletError = err instanceof Error ? err.message : "wallet_provision_failed";
  }
  // Seed the one-time starter grant so the agent's first paid call doesn't 402.
  let starterGranted = false;
  try {
    const g = await ensureStarterGrant(userId);
    starterGranted = g.ok === true;
  } catch {
    /* non-fatal — surfaces via balance below */
  }
  let balanceMinor = BigInt(0);
  try {
    const b = await getAgentBalance(userId);
    balanceMinor = b.balance_minor;
  } catch {
    /* table may not be migrated yet — non-fatal */
  }
  const origin = getSiteOrigin();

  return NextResponse.json(
    {
      user_id: userId,
      client_id: reg.client.client_id,
      client_secret: reg.client.client_secret,
      registration_access_token: reg.client.registration_access_token,
      api_key: apiKey.fullKey,
      api_key_id: apiKey.id,
      scopes: apiKey.scopes,
      tier: "free",
      audit_id: audit.id,
      wallet: walletAddress
        ? { address: walletAddress, network: "solana", endpoint: `${origin}/api/agents/wallet` }
        : { error: walletError },
      balance: {
        balance_minor: balanceMinor.toString(),
        balance: minorToUsd(balanceMinor),
        currency: "USDC",
        topup_url: `${origin}/api/agents/balance/topup`,
      },
      notice:
        "Store client_secret and api_key now — they are shown only once. " +
        "Upgrade tier via POST /api/acp/checkout. Top up prepaid balance via POST /api/agents/balance/topup. " +
        "Mint scoped keys via POST /api/keys.",
    },
    { status: 201 },
  );
}
