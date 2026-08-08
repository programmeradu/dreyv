/**
 * GET /api/agents/wallet/cold — return (and lazily provision) the user's
 * COLD agent wallet address. High-trust counterpart to the hot wallet.
 *
 * Sweep destination for `/api/agents/wallet/promote`. Refilling the hot
 * wallet from cold requires a human-approved action code, so an agent
 * key alone cannot drain the cold balance.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getOrCreateColdWallet } from "@/lib/agent/cold-wallet";
import { tokenFor } from "@/lib/billing/crypto-config";
import { getWalletBalances } from "@/lib/agent/wallet";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let wallet;
  try {
    wallet = await getOrCreateColdWallet(key.userId);
  } catch (err) {
    return NextResponse.json(
      { error: "wallet_provision_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  const usdc = tokenFor("solana", "usdc");
  let balances: Awaited<ReturnType<typeof getWalletBalances>> | null = null;
  let rpcError: string | null = null;
  if (usdc?.contract) {
    try {
      balances = await getWalletBalances({ publicKey: wallet.publicKey, mintAddress: usdc.contract });
    } catch (err) {
      rpcError = err instanceof Error ? err.message : "rpc_failed";
    }
  }

  return NextResponse.json({
    role: "cold",
    address: wallet.publicKey,
    network: "solana",
    created_at: wallet.createdAt.toISOString(),
    usdc: usdc?.contract
      ? {
          mint: usdc.contract,
          decimals: usdc.decimals,
          balance_minor: balances ? balances.tokenMinor.toString() : null,
        }
      : null,
    sol: balances ? { balance_lamports: balances.solLamports.toString() } : null,
    refill_instructions:
      "Cold balance can only be moved back to the hot wallet via POST /api/agents/wallet/refill, which requires a human-approved action code (POST /api/agents/action-codes).",
    rpc_error: rpcError,
  });
}
