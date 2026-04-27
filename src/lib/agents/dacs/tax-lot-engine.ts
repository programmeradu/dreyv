/**
 * DACS Phase 7C.3 — Tax-lot engine (FIFO / LIFO / HIFO).
 *
 * Pipeline:
 *   1. Fetch enhanced txs from Helius for [fromDate, toDate] window.
 *   2. Parse via `parseTxFacts` to get {direction, symbol, amount, timestamp}.
 *   3. Price each event at the tx timestamp using CoinGecko historical prices
 *      (cached in-memory per (coingeckoId, daystamp)). Stables = $1.
 *   4. Build per-symbol lot ledger:
 *        - "in" event → push lot {amount, costBasisUsd, acquiredAt}
 *        - "out" event → consume lots in chosen order (FIFO/LIFO/HIFO),
 *          producing realized gain/loss rows.
 *   5. Emit rows in JSON, TokenTax CSV, or Cryptio CSV format.
 *
 * No fabricated prices: if CoinGecko returns nothing for a symbol/day, the
 * gain row is emitted with `priced: false` and surfaces in `warnings[]`.
 */

import { fetchHeliusTransactions } from "@/lib/agents/artifacts/helius";
import { parseTxFacts } from "@/lib/agents/tx-stream/categorize";

export type LotMethod = "FIFO" | "LIFO" | "HIFO";
export type ExportFormat = "json" | "csv_tokentax" | "csv_cryptio";

export interface RealizedGainRow {
  symbol: string;
  signature: string;
  disposedAt: string;
  amount: number;
  proceedsUsd: number;
  costBasisUsd: number;
  realizedGainUsd: number;
  holdingPeriodDays: number;
  longTerm: boolean; // > 365d (US default)
  acquiredAt: string;
  acquireSignature: string | null;
  pricedProceeds: boolean;
  pricedBasis: boolean;
}

export interface TaxLotReport {
  wallet: string;
  method: LotMethod;
  fromDate: string;
  toDate: string;
  rows: RealizedGainRow[];
  totals: {
    proceedsUsd: number;
    costBasisUsd: number;
    realizedGainUsd: number;
    longTermGainUsd: number;
    shortTermGainUsd: number;
    rowCount: number;
  };
  openLots: Array<{ symbol: string; amount: number; costBasisUsd: number; acquiredAt: string; signature: string | null }>;
  warnings: string[];
  exportFormat: ExportFormat;
  /** Populated for csv_* formats. */
  csv?: string;
}

const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI", "USD"]);
const SYMBOL_TO_CG: Record<string, string> = {
  SOL: "solana", WSOL: "solana",
  ETH: "ethereum", BTC: "bitcoin",
  JUP: "jupiter-exchange-solana",
  JTO: "jito-governance-token", JITO: "jito-governance-token",
  BONK: "bonk", WIF: "dogwifcoin",
  PYTH: "pyth-network",
  RAY: "raydium", ORCA: "orca",
  MSOL: "msol", JITOSOL: "jito-staked-sol", BSOL: "blazestake-staked-sol", STSOL: "lido-staked-sol",
  TRUMP: "official-trump",
};

const priceCache = new Map<string, number | null>(); // key: `${cgId}:${dayStamp}` -> usd or null

function dayStamp(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

async function fetchPriceUsd(symbol: string, unixSec: number): Promise<number | null> {
  const sym = symbol.toUpperCase();
  if (STABLES.has(sym)) return 1;
  const cgId = SYMBOL_TO_CG[sym];
  if (!cgId) return null;
  const day = dayStamp(unixSec);
  const cacheKey = `${cgId}:${day}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey)!;
  try {
    const from = unixSec - 3600 * 12;
    const to = unixSec + 3600 * 12;
    const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      priceCache.set(cacheKey, null);
      return null;
    }
    const json = await res.json();
    const prices: Array<[number, number]> = json?.prices ?? [];
    if (prices.length === 0) {
      priceCache.set(cacheKey, null);
      return null;
    }
    // Pick the price closest to unixSec.
    const targetMs = unixSec * 1000;
    let best = prices[0];
    let bestDelta = Math.abs(best[0] - targetMs);
    for (const p of prices) {
      const d = Math.abs(p[0] - targetMs);
      if (d < bestDelta) { best = p; bestDelta = d; }
    }
    priceCache.set(cacheKey, best[1]);
    return best[1];
  } catch {
    priceCache.set(cacheKey, null);
    return null;
  }
}

interface OpenLot {
  amount: number;
  costBasisUsd: number; // total basis for `amount`
  acquiredAt: number;   // unix
  signature: string | null;
  pricedBasis: boolean;
}

function pickLotIndex(lots: OpenLot[], method: LotMethod): number {
  if (lots.length === 0) return -1;
  if (method === "FIFO") return 0;
  if (method === "LIFO") return lots.length - 1;
  // HIFO: highest cost basis per unit.
  let best = 0;
  let bestPerUnit = lots[0].costBasisUsd / lots[0].amount;
  for (let i = 1; i < lots.length; i++) {
    const perUnit = lots[i].costBasisUsd / lots[i].amount;
    if (perUnit > bestPerUnit) { best = i; bestPerUnit = perUnit; }
  }
  return best;
}

function toCsvTokenTax(rows: RealizedGainRow[]): string {
  // TokenTax CSV columns (commonly): Type,BuyAmount,BuyCurrency,SellAmount,SellCurrency,Fee,FeeCurrency,Exchange,Group,Comment,Date
  const header = "Type,SellAmount,SellCurrency,BuyAmount,BuyCurrency,FeeAmount,FeeCurrency,Exchange,Comment,Date";
  const lines = rows.map(r =>
    `Trade,${r.amount},${r.symbol},${r.proceedsUsd.toFixed(2)},USD,0,USD,Solana,${r.signature.slice(0, 12)} ${r.method ?? ""},${r.disposedAt}`
  );
  return [header, ...lines].join("\n");
}

function toCsvCryptio(rows: RealizedGainRow[]): string {
  // Cryptio-style: Date,From,To,Amount,Currency,USDValue,RealizedGain,HoldingDays,LongTerm,TxHash
  const header = "Date,Asset,AmountDisposed,ProceedsUSD,CostBasisUSD,RealizedGainUSD,HoldingDays,LongTerm,TxHash";
  const lines = rows.map(r =>
    `${r.disposedAt},${r.symbol},${r.amount},${r.proceedsUsd.toFixed(2)},${r.costBasisUsd.toFixed(2)},${r.realizedGainUsd.toFixed(2)},${r.holdingPeriodDays},${r.longTerm ? "Y" : "N"},${r.signature}`
  );
  return [header, ...lines].join("\n");
}

export async function runTaxLots(input: {
  wallet: string;
  method: LotMethod;
  fromDate: string;
  toDate: string;
  exportFormat: ExportFormat;
}): Promise<TaxLotReport> {
  const sinceUnix = Math.floor(new Date(input.fromDate).getTime() / 1000);
  const untilUnix = Math.floor(new Date(input.toDate).getTime() / 1000);
  if (!Number.isFinite(sinceUnix) || !Number.isFinite(untilUnix) || sinceUnix >= untilUnix) {
    throw new Error("Invalid date range — fromDate must precede toDate.");
  }

  const txs = await fetchHeliusTransactions(input.wallet, { sinceUnix, untilUnix, limit: 1000 });

  // Sort ascending by timestamp so FIFO/LIFO ordering is correct.
  const sorted = [...txs].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const lotsBySymbol = new Map<string, OpenLot[]>();
  const rows: RealizedGainRow[] = [];
  const warnings: string[] = [];

  for (const tx of sorted) {
    const facts = parseTxFacts(tx, input.wallet);
    const sym = (facts.tokenSymbol ?? "").toUpperCase();
    const amount = facts.amount ?? 0;
    if (!sym || amount <= 0) continue;
    if (facts.direction === "internal" || facts.direction === "unknown") continue;

    const ts = tx.timestamp ?? 0;
    const px = await fetchPriceUsd(sym, ts);
    if (px == null) warnings.push(`No CoinGecko price for ${sym} @ ${dayStamp(ts)} — row priced as 0.`);

    if (facts.direction === "in") {
      const lot: OpenLot = {
        amount,
        costBasisUsd: (px ?? 0) * amount,
        acquiredAt: ts,
        signature: tx.signature ?? null,
        pricedBasis: px != null,
      };
      const arr = lotsBySymbol.get(sym) ?? [];
      arr.push(lot);
      lotsBySymbol.set(sym, arr);
    } else if (facts.direction === "out") {
      const arr = lotsBySymbol.get(sym) ?? [];
      let remaining = amount;
      const proceedsPerUnit = px ?? 0;

      while (remaining > 0 && arr.length > 0) {
        const idx = pickLotIndex(arr, input.method);
        const lot = arr[idx];
        const take = Math.min(remaining, lot.amount);
        const lotPerUnitBasis = lot.costBasisUsd / lot.amount;
        const takenBasis = lotPerUnitBasis * take;
        const proceeds = proceedsPerUnit * take;
        const holdingMs = (ts - lot.acquiredAt) * 1000;
        const holdingDays = Math.floor(holdingMs / 86_400_000);

        rows.push({
          symbol: sym,
          signature: tx.signature ?? "",
          disposedAt: new Date(ts * 1000).toISOString(),
          amount: take,
          proceedsUsd: proceeds,
          costBasisUsd: takenBasis,
          realizedGainUsd: proceeds - takenBasis,
          holdingPeriodDays: holdingDays,
          longTerm: holdingDays > 365,
          acquiredAt: new Date(lot.acquiredAt * 1000).toISOString(),
          acquireSignature: lot.signature,
          pricedProceeds: px != null,
          pricedBasis: lot.pricedBasis,
        });

        lot.amount -= take;
        lot.costBasisUsd -= takenBasis;
        remaining -= take;
        if (lot.amount <= 1e-12) arr.splice(idx, 1);
      }

      if (remaining > 0) {
        // Disposed without a matching lot — phantom basis (likely airdrop/unknown).
        warnings.push(`${sym}: disposed ${remaining} without a prior acquisition lot (sig ${tx.signature?.slice(0, 8)}…). Recorded with $0 basis.`);
        rows.push({
          symbol: sym,
          signature: tx.signature ?? "",
          disposedAt: new Date(ts * 1000).toISOString(),
          amount: remaining,
          proceedsUsd: proceedsPerUnit * remaining,
          costBasisUsd: 0,
          realizedGainUsd: proceedsPerUnit * remaining,
          holdingPeriodDays: 0,
          longTerm: false,
          acquiredAt: new Date(ts * 1000).toISOString(),
          acquireSignature: null,
          pricedProceeds: px != null,
          pricedBasis: false,
        });
      }
    }
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.proceedsUsd += r.proceedsUsd;
      acc.costBasisUsd += r.costBasisUsd;
      acc.realizedGainUsd += r.realizedGainUsd;
      if (r.longTerm) acc.longTermGainUsd += r.realizedGainUsd;
      else acc.shortTermGainUsd += r.realizedGainUsd;
      acc.rowCount += 1;
      return acc;
    },
    { proceedsUsd: 0, costBasisUsd: 0, realizedGainUsd: 0, longTermGainUsd: 0, shortTermGainUsd: 0, rowCount: 0 }
  );

  const openLots: TaxLotReport["openLots"] = [];
  for (const [sym, arr] of lotsBySymbol) {
    for (const lot of arr) {
      if (lot.amount > 1e-12) {
        openLots.push({
          symbol: sym,
          amount: lot.amount,
          costBasisUsd: lot.costBasisUsd,
          acquiredAt: new Date(lot.acquiredAt * 1000).toISOString(),
          signature: lot.signature,
        });
      }
    }
  }

  const report: TaxLotReport = {
    wallet: input.wallet,
    method: input.method,
    fromDate: input.fromDate,
    toDate: input.toDate,
    rows,
    totals,
    openLots,
    warnings,
    exportFormat: input.exportFormat,
  };

  if (input.exportFormat === "csv_tokentax") report.csv = toCsvTokenTax(rows);
  else if (input.exportFormat === "csv_cryptio") report.csv = toCsvCryptio(rows);

  return report;
}
