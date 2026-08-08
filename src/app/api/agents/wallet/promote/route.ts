export const runtime = "edge";
/**
 * POST /api/agents/wallet/promote — sweep the HOT agent wallet into the
 * COLD wallet. Reduces blast radius if an agent key leaks: only the
 * unswept hot balance is at risk.
 *
 * Body: { keep_sol_lamports?: number }  (default 5_000_000 = 0.005 SOL float)
 *
 * Idempotent: if the hot wallet is empty, returns { skipped: "empty" }.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getOrCreateAgentWallet, sweepHostedWallet } from "@/lib/agent/wallet";
import { getOrCreateColdWallet } from "@/lib/agent/cold-wallet";
import { tokenFor } from "@/lib/billing/crypto-config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const usdc = tokenFor("solana", "usdc");
  if (!usdc?.contract) {
    return NextResponse.json({ error: "usdc_mint_unconfigured" }, { status: 500 });
  }

  let hot, cold;
  try {
    hot = await getOrCreateAgentWallet(key.userId, { withSecret: true });
    cold = await getOrCreateColdWallet(key.userId);
  } catch (err) {
    return NextResponse.json(
      { error: "wallet_provision_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  if (!hot.secretBase58) {
    return NextResponse.json({ error: "hot_secret_missing" }, { status: 500 });
  }

  try {
    const result = await sweepHostedWallet({
      sourceSecretBase58: hot.secretBase58,
      destinationPublicKey: cold.publicKey,
      mintAddress: usdc.contract,
      decimals: usdc.decimals,
    });
    return NextResponse.json({
      ok: true,
      signature: result.signature,
      from: hot.publicKey,
      to: cold.publicKey,
      swept_usdc_minor: result.tokenMinor.toString(),
      swept_sol_lamports: result.solLamports.toString(),
      skipped: result.skippedReason ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "sweep_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
