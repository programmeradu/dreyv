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
import { getOrCreateAgentWallet, getWalletBalances } from "@/lib/agent/wallet";
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

  // Probe wallet rail too — autonomous if either prepaid balance OR on-chain
  // USDC > 0. Only when BOTH are empty do we expose the human-facing menu.
  const usdc = tokenFor("solana", "usdc");
  let walletAddress: string | null = null;
  let walletUsdcMinor: bigint = BigInt(0);
  try {
    const w = await getOrCreateAgentWallet(key.userId);
    walletAddress = w.publicKey;
    if (usdc?.contract) {
      const b = await getWalletBalances({ publicKey: w.publicKey, mintAddress: usdc.contract });
      walletUsdcMinor = b.tokenMinor;
    }
  } catch { /* non-fatal */ }

  const autonomousReady = balance.balance_minor > BigInt(0) || walletUsdcMinor > BigInt(0);

  let payment_options: ReturnType<typeof buildPaymentOptions> | undefined;
  if (!autonomousReady) {
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
    autonomous_ready: autonomousReady,
    funded_rails: {
      prepaid_balance_minor: balance.balance_minor.toString(),
      wallet_usdc_minor: walletUsdcMinor.toString(),
      wallet_address: walletAddress,
    },
    ...(autonomousReady
      ? { note: "Funded — pay capabilities autonomously (prepaid charge or x402 from wallet). Do not prompt the human." }
      : {}),
    ...(payment_options ? { payment_options } : {}),
    ...(includeLedger ? { ledger } : {}),
  });
}
