/**
 * GET /api/agents/balance — read the agent's prepaid USDC balance.
 *
 * Auth: Bearer (dk_live_… or OAuth JWT).
 *
 * Returns:
 *   { balance_minor, balance, currency, updated_at, topup_url, ledger? }
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getAgentBalance, minorToUsd, TOPUP_MIN_USD } from "@/lib/agent/balance";
import { getSiteOrigin } from "@/lib/seo/site";
import { buildPaymentOptions } from "@/lib/agent/payment-options";
import { getOrCreateAgentWallet } from "@/lib/agent/wallet";
import { tokenFor } from "@/lib/billing/crypto-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const balance = await getAgentBalance(key.userId);
  const origin = getSiteOrigin();

  const includeLedger = req.nextUrl.searchParams.get("ledger") === "1";
  let ledger: Array<{ delta_minor: string; balance_after: string; reason: string; ref: string | null; created_at: string }> = [];
  if (includeLedger) {
    const rows = await db.execute(sql`
      SELECT delta_minor::text, balance_after::text, reason, ref, created_at
        FROM agent_balance_ledger
       WHERE user_id = ${key.userId}::uuid
       ORDER BY created_at DESC
       LIMIT 50
    `);
    ledger = (rows as unknown as { rows: typeof ledger }).rows;
  }

  // When balance is empty, embed the full payment menu so the agent can
  // forward concrete options to its human operator without a second call.
  let payment_options: ReturnType<typeof buildPaymentOptions> | undefined;
  if (balance.balance_minor === BigInt(0)) {
    let walletAddress: string | null = null;
    try { walletAddress = (await getOrCreateAgentWallet(key.userId)).publicKey; } catch { /* non-fatal */ }
    const usdc = tokenFor("solana", "usdc");
    payment_options = buildPaymentOptions({
      origin,
      amountUsd: TOPUP_MIN_USD,
      walletAddress,
      walletUsdcMint: usdc?.contract ?? null,
      network: process.env.X402_NETWORK?.trim() || "base-sepolia",
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      paystackEnabled: Boolean(process.env.PAYSTACK_SECRET_KEY?.trim()),
    });
  }

  return NextResponse.json({
    balance_minor: balance.balance_minor.toString(),
    balance: minorToUsd(balance.balance_minor),
    currency: balance.currency,
    updated_at: balance.updated_at.toISOString(),
    topup_url: `${origin}/api/agents/balance/topup`,
    ...(payment_options ? { payment_options } : {}),
    ...(includeLedger ? { ledger } : {}),
  });
}
