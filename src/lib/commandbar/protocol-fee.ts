/**
 * Protocol fee — Dreyv takes a 0.05% skim on every CommandBar transaction.
 *
 * Implementation: we append an extra SOL transfer instruction (as its own
 * legacy Transaction) to the batch the wallet signs. The wallet sees the
 * fee transfer alongside the user-intended tx and approves both at once
 * via signAllTransactions — no second popup, no second blockhash fetch.
 *
 * Fee math:
 *   fee_usd       = estimatedValueUsd * 0.0005
 *   fee_lamports  = round(fee_usd / sol_price_usd * 1e9)
 *
 * If we don't know the USD value or the SOL price, we skip the fee
 * (better to ship the tx than to brick a real user flow over fee math).
 */

import { Transaction, SystemProgram, PublicKey, Connection } from "@solana/web3.js";

export const PROTOCOL_FEE_BPS = 5; // 0.05% = 5 / 10_000
export const PROTOCOL_FEE_RATE = PROTOCOL_FEE_BPS / 10_000;

// Treasury wallet — same address used by the Studio marketplace skim.
// Override via NEXT_PUBLIC_DREYV_TREASURY_WALLET when rotating.
export const TREASURY_WALLET =
  process.env.NEXT_PUBLIC_DREYV_TREASURY_WALLET ||
  "9agsk4cgDFrcz2xBoTfitPVQcBPV6bB65LcQMkppYn8n";

// Floor: don't bother charging dust (also avoids 0-lamport transfers
// failing rent / runtime checks). 1000 lamports ≈ $0.00015 at $150 SOL.
const MIN_FEE_LAMPORTS = 1_000;

let cachedSolPrice: { value: number; expiry: number } | null = null;

async function getSolPriceUsd(): Promise<number | null> {
  const now = Date.now();
  if (cachedSolPrice && cachedSolPrice.expiry > now) return cachedSolPrice.value;
  try {
    const r = await fetch("/api/jupiter/price?ids=SOL");
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.data?.SOL?.price;
    if (typeof p === "number" && p > 0) {
      cachedSolPrice = { value: p, expiry: now + 60_000 };
      return p;
    }
  } catch {
    /* swallow — caller will skip the fee */
  }
  return null;
}

export interface ProtocolFeeResult {
  tx: Transaction;
  feeLamports: number;
  feeUsd: number;
}

/**
 * Build the fee Transaction the wallet will sign alongside the user tx.
 * Returns null when no fee should be appended (unknown value, dust, etc).
 */
export async function buildProtocolFeeTx(params: {
  connection: Connection;
  payer: PublicKey;
  estimatedValueUsd: number | null | undefined;
  blockhash: string;
  lastValidBlockHeight: number;
}): Promise<ProtocolFeeResult | null> {
  const { connection: _connection, payer, estimatedValueUsd, blockhash, lastValidBlockHeight } = params;
  if (!estimatedValueUsd || !Number.isFinite(estimatedValueUsd) || estimatedValueUsd <= 0) {
    return null;
  }
  const solPrice = await getSolPriceUsd();
  if (!solPrice) return null;

  const feeUsd = estimatedValueUsd * PROTOCOL_FEE_RATE;
  const feeLamports = Math.round((feeUsd / solPrice) * 1_000_000_000);
  if (feeLamports < MIN_FEE_LAMPORTS) return null;

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: new PublicKey(TREASURY_WALLET),
      lamports: feeLamports,
    }),
  );
  return { tx, feeLamports, feeUsd };
}
