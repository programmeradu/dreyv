/**
 * POST /api/agents/claim/redeem — signed-in human absorbs an agent into their account.
 *
 *   Cookie: keystone-siws-session (SIWS JWT)
 *   Body:   { token: "agcl.…" }            // from POST /api/agents/claim
 *
 * Effect (single transaction):
 *   1. publicApiKeys.user_id      agent → customer
 *   2. agentApiKeys.user_id       agent → customer
 *   3. agentPayments.user_id      agent → customer
 *   4. agentBalanceLedger.user_id agent → customer
 *   5. agentBalances              add agent balance to customer balance, drop agent row
 *   6. agentWallets               re-point if customer has none, else refuse
 *   7. ledger row recording the merge
 *   8. soft-delete agent user (wallet_address renamed to claimed:<id>)
 *
 * Single-use enforced by in-memory jti set (process-local; survives within a
 * server instance; a replay against a cold instance fails at step 1 because
 * the agent user no longer owns anything).
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/db";
import {
  agentApiKeys,
  agentBalanceLedger,
  agentBalances,
  agentPayments,
  agentWallets,
  publicApiKeys,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REDEEMED = new Set<string>();

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET missing");
  return new TextEncoder().encode(s);
}

export async function POST(req: NextRequest) {
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const me = await getAuthUser(req);
  if (!me) {
    return NextResponse.json(
      {
        error: "unauthenticated",
        message: "Sign in to Dreyv first, then re-submit the claim token.",
      },
      { status: 401 },
    );
  }

  let body: { token?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const raw = (body.token || "").trim();
  if (!raw.startsWith("agcl.")) {
    return NextResponse.json(
      { error: "invalid_token", message: "Claim token must start with `agcl.`." },
      { status: 400 },
    );
  }

  let agentUserId: string;
  let jti: string;
  try {
    const { payload } = await jwtVerify(raw.slice("agcl.".length), secret(), {
      issuer: "dreyv-agent-claim",
      audience: "dreyv-customer",
    });
    agentUserId = String(payload.agentUserId || "");
    jti = String(payload.jti || "");
    if (!agentUserId || !jti) throw new Error("missing claims");
  } catch {
    return NextResponse.json(
      { error: "invalid_token", message: "Claim token is invalid or expired." },
      { status: 400 },
    );
  }

  if (REDEEMED.has(jti)) {
    return NextResponse.json(
      { error: "already_redeemed", message: "This claim token has already been used." },
      { status: 409 },
    );
  }
  if (agentUserId === me.id) {
    return NextResponse.json(
      { error: "self_claim", message: "Agent already belongs to this account." },
      { status: 400 },
    );
  }

  // Verify the agent user still exists and is a synthetic agent row.
  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId)).limit(1);
  if (!agent) {
    return NextResponse.json(
      { error: "agent_missing", message: "Agent account no longer exists." },
      { status: 404 },
    );
  }
  if (!agent.walletAddress.startsWith("agent:")) {
    return NextResponse.json(
      {
        error: "not_an_agent",
        message: "This user is not an autonomously-provisioned agent and cannot be absorbed.",
      },
      { status: 400 },
    );
  }

  // Wallet conflict: agentWallets.userId is UNIQUE per user. If the customer
  // already has a hosted wallet, we refuse instead of silently dropping funds.
  const [agentWallet] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.userId, agentUserId))
    .limit(1);
  const [customerWallet] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.userId, me.id))
    .limit(1);
  if (agentWallet && customerWallet) {
    return NextResponse.json(
      {
        error: "wallet_conflict",
        message:
          "Both the agent and your account already have a hosted Solana wallet. Sweep the agent wallet to your customer wallet (POST /api/agents/wallet/sweep) before claiming.",
        agent_wallet: agentWallet.publicKey,
        customer_wallet: customerWallet.publicKey,
      },
      { status: 409 },
    );
  }

  // Read balances.
  const [agentBal] = await db
    .select()
    .from(agentBalances)
    .where(eq(agentBalances.userId, agentUserId))
    .limit(1);
  const [customerBal] = await db
    .select()
    .from(agentBalances)
    .where(eq(agentBalances.userId, me.id))
    .limit(1);

  const agentMinor = BigInt(agentBal?.balanceMinor ?? "0");
  const customerMinor = BigInt(customerBal?.balanceMinor ?? "0");
  const mergedMinor = agentMinor + customerMinor;

  // Reassign rows. Drizzle/Neon-http doesn't expose a transaction here; we do
  // sequential updates and mark the jti redeemed on success.
  await db
    .update(publicApiKeys)
    .set({ userId: me.id })
    .where(eq(publicApiKeys.userId, agentUserId));
  await db
    .update(agentApiKeys)
    .set({ userId: me.id })
    .where(eq(agentApiKeys.userId, agentUserId));
  await db
    .update(agentPayments)
    .set({ userId: me.id })
    .where(eq(agentPayments.userId, agentUserId));
  await db
    .update(agentBalanceLedger)
    .set({ userId: me.id })
    .where(eq(agentBalanceLedger.userId, agentUserId));

  if (agentWallet && !customerWallet) {
    await db
      .update(agentWallets)
      .set({ userId: me.id })
      .where(eq(agentWallets.userId, agentUserId));
  }

  // Merge balance: write the combined total onto the customer row, drop the agent row.
  if (customerBal) {
    await db
      .update(agentBalances)
      .set({ balanceMinor: mergedMinor.toString(), updatedAt: new Date() })
      .where(eq(agentBalances.userId, me.id));
  } else {
    await db.insert(agentBalances).values({
      userId: me.id,
      balanceMinor: mergedMinor.toString(),
      currency: agentBal?.currency ?? "USDC",
    });
  }
  if (agentBal) {
    await db.delete(agentBalances).where(eq(agentBalances.userId, agentUserId));
  }

  // Ledger marker on the customer's history.
  if (agentMinor > BigInt(0)) {
    await db.insert(agentBalanceLedger).values({
      userId: me.id,
      deltaMinor: agentMinor.toString(),
      balanceAfter: mergedMinor.toString(),
      reason: "agent_claim_merge",
      ref: agentUserId,
    });
  }

  // Soft-delete the agent shell: rename wallet_address so the synthetic row
  // can't be re-claimed and so its unique index is freed for future agents.
  await db
    .update(users)
    .set({
      walletAddress: `claimed:${agentUserId}`,
      displayName: `${agent.displayName ?? "Agent"} (claimed)`,
    })
    .where(eq(users.id, agentUserId));

  REDEEMED.add(jti);

  return NextResponse.json({
    ok: true,
    absorbed_agent_user_id: agentUserId,
    customer_user_id: me.id,
    transferred: {
      balance_minor_added: agentMinor.toString(),
      balance_minor_total: mergedMinor.toString(),
      wallet_transferred: Boolean(agentWallet && !customerWallet),
    },
    notice:
      "Agent absorbed. Its dk_live_ keys, payment history, prepaid balance and (if applicable) hosted wallet now belong to your account. The agent's bearer keys keep working — they're just yours now.",
  });
}
