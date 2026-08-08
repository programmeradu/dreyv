export const runtime = "edge";
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
  redeemedClaimTokens,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

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

  const [alreadyRedeemed] = await db
    .select()
    .from(redeemedClaimTokens)
    .where(eq(redeemedClaimTokens.jti, jti))
    .limit(1);
  if (alreadyRedeemed) {
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
  //
  // NOTE: we intentionally do NOT rewrite agent_balance_ledger.user_id. Those
  // rows store a historical balance_after snapshot that only makes sense in
  // the agent's own running total — re-attributing them to the customer would
  // make the customer's ledger display nonsensical (the prior cause of the
  // "+4.9M → 4.9M" merge artefact). The single merge marker row below is the
  // tamper-evident link between the two histories.
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

  if (agentWallet && !customerWallet) {
    await db
      .update(agentWallets)
      .set({ userId: me.id })
      .where(eq(agentWallets.userId, agentUserId));
  }

  // Merge balance: write the combined total onto the customer row, zero out
  // the agent row (do NOT delete — the merge pointer below redirects all
  // future reads/charges from the agent's still-valid dk_live_ keys onto the
  // customer row, and deleting would let getAgentBalance silently re-create
  // a phantom 0-row).
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
    await db
      .update(agentBalances)
      .set({ balanceMinor: "0", updatedAt: new Date() })
      .where(eq(agentBalances.userId, agentUserId));
  }

  // Ledger marker on the customer's history. delta = funds transferred in;
  // balance_after = customer's new running total. Only insert when there was
  // something to transfer (zero-delta merges would just be noise).
  if (agentMinor > BigInt(0)) {
    await db.insert(agentBalanceLedger).values({
      userId: me.id,
      deltaMinor: agentMinor.toString(),
      balanceAfter: mergedMinor.toString(),
      reason: "agent_claim_merge",
      ref: agentUserId,
    });
    // Mirror -delta row on the agent's ledger so its own history balances to 0.
    await db.insert(agentBalanceLedger).values({
      userId: agentUserId,
      deltaMinor: (-agentMinor).toString(),
      balanceAfter: "0",
      reason: "agent_claim_merge_out",
      ref: me.id,
    });
  }

  // Soft-delete the agent shell: rename wallet_address so the synthetic row
  // can't be re-claimed, free its unique index for future agents, and install
  // the merge pointer so balance.ts reads/charges resolve to the customer.
  await db
    .update(users)
    .set({
      walletAddress: `claimed:${agentUserId}`,
      displayName: `${agent.displayName ?? "Agent"} (claimed)`,
      mergedIntoUserId: me.id,
    })
    .where(eq(users.id, agentUserId));

  await db
    .insert(redeemedClaimTokens)
    .values({ jti, agentUserId, customerUserId: me.id })
    .onConflictDoNothing();


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
