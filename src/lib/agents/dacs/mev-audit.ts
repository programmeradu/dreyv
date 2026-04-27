/**
 * DACS Phase 7C.6 — Jito MEV audit engine.
 *
 * What this actually does (no fake "claim" — Jito does NOT have a user-claimable
 * MEV rebate program; searchers tip validators directly, and JitoSOL stakers
 * capture MEV via the JitoSOL/SOL exchange-rate appreciation, not via a claim tx):
 *
 *   1. Audit how much SOL the wallet has spent on Jito tips over a window —
 *      scans Helius enhanced-tx history for native transfers TO any of the
 *      8 canonical Jito tip accounts.
 *   2. Detect JitoSOL holdings and convert to "MEV-bearing SOL exposure" using
 *      the live exchange rate from Jito's stake-pool API.
 *   3. Surface the actionable preference: route future swaps via Jito bundles
 *      (we already have `/api/solana/jito-bundle`). Persisted to user_settings.preferences.
 *
 * Returns a real audit object — never fabricates rebate amounts.
 */

import { fetchHeliusTransactions, type HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";

/** Canonical Jito tip accounts (mainnet). Source: Jito docs / bundle SDK. */
export const JITO_TIP_ACCOUNTS: ReadonlySet<string> = new Set([
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwQhE3FMPB",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSQnR21urPnRsJJXKSt",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
]);

export const JITOSOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

const LAMPORTS_PER_SOL = 1_000_000_000;

export interface TipPayment {
  signature: string;
  timestamp: number;
  tipAccount: string;
  lamports: number;
  sol: number;
}

export interface JitoSolPosition {
  /** JitoSOL token balance (UI amount). */
  jitosolBalance: number;
  /** Live JitoSOL → SOL exchange rate from Jito stake-pool. */
  exchangeRate: number;
  /** Equivalent SOL backing this JitoSOL position. */
  solEquivalent: number;
  /** Source of the exchange rate. */
  rateSource: "jito-api" | "fallback-1.0";
}

export interface MevAuditResult {
  wallet: string;
  windowDays: number;
  windowSinceUnix: number;
  /** Every native transfer the wallet sent to a Jito tip account in window. */
  tipPayments: TipPayment[];
  /** Aggregate metrics. */
  totalTipsSol: number;
  totalTipsLamports: number;
  tipCount: number;
  /** JitoSOL position snapshot (null if zero balance or fetch failed). */
  jitosolPosition: JitoSolPosition | null;
  /** Honest summary message — explains what's claimable and what isn't. */
  summary: string;
  /** Future-routing preference recorded for this wallet (from caller). */
  routingEnabled?: boolean;
}

/**
 * Fetch live JitoSOL/SOL exchange rate from Jito's public stake-pool API.
 * Falls back to 1.0 (with `rateSource: "fallback-1.0"`) on network failure
 * so we never silently inflate the user's apparent SOL exposure.
 */
async function fetchJitoSolExchangeRate(): Promise<{ rate: number; source: JitoSolPosition["rateSource"] }> {
  try {
    const res = await fetch("https://kobe.mainnet.jito.network/api/v1/stake_pool_stats", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { rate: 1.0, source: "fallback-1.0" };
    const data = (await res.json()) as { apy?: number; tvl?: number; jitosol_sol_rate?: number };
    const rate = typeof data.jitosol_sol_rate === "number" && data.jitosol_sol_rate > 0 ? data.jitosol_sol_rate : null;
    if (rate) return { rate, source: "jito-api" };
    return { rate: 1.0, source: "fallback-1.0" };
  } catch {
    return { rate: 1.0, source: "fallback-1.0" };
  }
}

/** Sum native transfers FROM `wallet` TO any Jito tip account. */
function extractTipPayments(wallet: string, txs: HeliusEnhancedTx[]): TipPayment[] {
  const out: TipPayment[] = [];
  for (const tx of txs) {
    if (tx.transactionError) continue;
    const transfers = tx.nativeTransfers ?? [];
    for (const t of transfers) {
      if (t.fromUserAccount !== wallet) continue;
      if (!JITO_TIP_ACCOUNTS.has(t.toUserAccount)) continue;
      if (!Number.isFinite(t.amount) || t.amount <= 0) continue;
      out.push({
        signature: tx.signature,
        timestamp: tx.timestamp,
        tipAccount: t.toUserAccount,
        lamports: t.amount,
        sol: t.amount / LAMPORTS_PER_SOL,
      });
    }
  }
  return out;
}

/** Detect JitoSOL holdings from token transfers (last seen balance for the wallet). */
async function fetchJitoSolPosition(wallet: string, rpcEndpoint: string): Promise<JitoSolPosition | null> {
  try {
    const res = await fetch(rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          wallet,
          { mint: JITOSOL_MINT },
          { encoding: "jsonParsed" },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } } }> };
    };
    const accounts = data.result?.value ?? [];
    let total = 0;
    for (const a of accounts) {
      const ui = a.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof ui === "number" && Number.isFinite(ui)) total += ui;
    }
    if (total <= 0) return null;
    const { rate, source } = await fetchJitoSolExchangeRate();
    return {
      jitosolBalance: total,
      exchangeRate: rate,
      solEquivalent: total * rate,
      rateSource: source,
    };
  } catch {
    return null;
  }
}

/**
 * Run the full MEV audit for a wallet. `rpcEndpoint` is required so we can
 * read JitoSOL balances; `windowDays` defaults to ~5 epochs (≈ 12 days).
 */
export async function auditWalletMev(input: {
  wallet: string;
  rpcEndpoint: string;
  windowDays?: number;
}): Promise<MevAuditResult> {
  const windowDays = Math.max(1, Math.min(365, input.windowDays ?? 12));
  const sinceUnix = Math.floor(Date.now() / 1000) - windowDays * 86400;

  const [txs, position] = await Promise.all([
    fetchHeliusTransactions(input.wallet, { sinceUnix, limit: 1000 }).catch(() => [] as HeliusEnhancedTx[]),
    fetchJitoSolPosition(input.wallet, input.rpcEndpoint),
  ]);

  const tipPayments = extractTipPayments(input.wallet, txs);
  const totalLamports = tipPayments.reduce((s, p) => s + p.lamports, 0);
  const totalSol = totalLamports / LAMPORTS_PER_SOL;

  const summaryParts: string[] = [];
  if (tipPayments.length === 0) {
    summaryParts.push(
      `No Jito tips paid in last ${windowDays}d — wallet hasn't been routing through Jito bundles.`,
    );
  } else {
    summaryParts.push(
      `Paid ${totalSol.toFixed(6)} SOL in tips across ${tipPayments.length} bundle(s) over last ${windowDays}d.`,
    );
  }
  if (position) {
    summaryParts.push(
      `Hold ${position.jitosolBalance.toFixed(4)} JitoSOL (≈ ${position.solEquivalent.toFixed(4)} SOL at ${position.exchangeRate.toFixed(6)} rate). MEV accrues automatically via exchange-rate growth — no claim tx needed.`,
    );
  }
  summaryParts.push(
    "Note: Jito does NOT offer user-claimable tip rebates. Validators redistribute MEV to JitoSOL stakers via exchange-rate appreciation. Toggle `routing` to send future swaps through Jito bundles for MEV protection.",
  );

  return {
    wallet: input.wallet,
    windowDays,
    windowSinceUnix: sinceUnix,
    tipPayments,
    totalTipsSol: totalSol,
    totalTipsLamports: totalLamports,
    tipCount: tipPayments.length,
    jitosolPosition: position,
    summary: summaryParts.join(" "),
  };
}
