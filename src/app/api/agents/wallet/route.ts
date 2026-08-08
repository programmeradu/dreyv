export const runtime = "edge";
/**
 * GET /api/agents/wallet — agent-facing view of the custodial Solana
 * wallet that funds autonomous on-chain payments.
 *
 * Auth: Bearer (dk_live_… or OAuth JWT) — companion to /api/agent/wallet
 * which requires a user session. Provisions the wallet on first call.
 *
 * Returns:
 *   {
 *     address, network: "solana", created_at,
 *     usdc: { mint, decimals, balance_minor, balance, account_exists },
 *     sol:  { balance_lamports, balance },
 *     funding_instructions: "...",
 *     rpc_error?: string
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { tokenFor } from "@/lib/billing/crypto-config";
import { getOrCreateAgentWallet, getWalletBalances } from "@/lib/agent/wallet";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const usdc = tokenFor("solana", "usdc");
  if (!usdc?.contract) {
    return NextResponse.json({ error: "usdc_mint_unconfigured" }, { status: 500 });
  }

  let wallet: { publicKey: string; createdAt: Date };
  try {
    wallet = await getOrCreateAgentWallet(key.userId);
  } catch (err) {
    return NextResponse.json(
      { error: "wallet_provision_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  let balances: { solLamports: bigint; tokenMinor: bigint; tokenAccountExists: boolean } | null = null;
  let rpcError: string | null = null;
  try {
    balances = await getWalletBalances({ publicKey: wallet.publicKey, mintAddress: usdc.contract });
  } catch (err) {
    rpcError = err instanceof Error ? err.message : "rpc_failed";
  }

  return NextResponse.json({
    address: wallet.publicKey,
    network: "solana",
    created_at: wallet.createdAt.toISOString(),
    usdc: {
      mint: usdc.contract,
      decimals: usdc.decimals,
      balance_minor: balances ? balances.tokenMinor.toString() : null,
      balance: balances ? formatTokenAmount(balances.tokenMinor, usdc.decimals) : null,
      account_exists: balances?.tokenAccountExists ?? null,
    },
    sol: {
      balance_lamports: balances ? balances.solLamports.toString() : null,
      balance: balances ? Number(balances.solLamports) / 1e9 : null,
    },
    funding_instructions: `Send USDC (mint ${usdc.contract}) on Solana to ${wallet.publicKey}. Keep a small SOL float (~0.01 SOL) for tx fees. Drained automatically when capabilities settle via POST /api/x402/pay.`,
    rpc_error: rpcError,
  });
}

function formatTokenAmount(minor: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = minor / base;
  const frac = minor % base;
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}
