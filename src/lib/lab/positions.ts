/**
 * Resolve a Solana address into a categorized, USD-valued LabPosition[].
 * Pulls holdings via Helius DAS (server-side proxy) and prices via CoinGecko.
 */

import type { LabPosition, LabCategory } from "./types";
import { IDLE_MINTS, YIELD_MINTS, NATIVE_STAKING_MINT } from "@/lib/yield-registry";

const CG_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";

// Reuse the same mapping mints → CG ids used in prices.ts (kept here as
// a local subset so this module doesn't import the historical cache).
const MINT_CG: Record<string, string> = {
  "So11111111111111111111111111111111111111112": "solana",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "usd-coin",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "tether",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "msol",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "jito-staked-sol",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "blazestake-staked-sol",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "jupiter-exchange-solana",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "bonk",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "pyth-network",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "raydium",
};

function classify(mint: string): LabCategory {
  if (IDLE_MINTS.has(mint)) return "IDLE";
  if (mint in YIELD_MINTS) return "YIELD_BEARING";
  return "SPECULATIVE";
}

interface RawHolding {
  mint: string;
  symbol?: string;
  name?: string;
  balance?: string | number;
  amount?: string | number;
  decimals?: number;
}

async function fetchPricesUSD(mints: string[]): Promise<Record<string, number>> {
  const ids = Array.from(new Set(mints.map((m) => MINT_CG[m]).filter(Boolean)));
  if (ids.length === 0) return {};
  try {
    const res = await fetch(`${CG_PRICE_URL}?ids=${ids.join(",")}&vs_currencies=usd`, {
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const byMint: Record<string, number> = {};
    for (const [mint, cg] of Object.entries(MINT_CG)) {
      const usd = data[cg]?.usd;
      if (typeof usd === "number") byMint[mint] = usd;
    }
    return byMint;
  } catch {
    return {};
  }
}

async function fetchCurrentApys(): Promise<Record<string, number>> {
  // Read live rates from our own endpoint; fall back to registry defaults.
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/yield/rates`, {
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 120 },
    });
    if (!res.ok) throw new Error("rates");
    const data = await res.json();
    const out: Record<string, number> = {};
    for (const [mint, entry] of Object.entries((data?.rates ?? {}) as Record<string, { apy?: number }>)) {
      if (typeof entry?.apy === "number") out[mint] = entry.apy;
    }
    return out;
  } catch {
    const fallback: Record<string, number> = {};
    for (const [mint, meta] of Object.entries(YIELD_MINTS)) fallback[mint] = meta.fallbackApy;
    return fallback;
  }
}

export async function resolveAddressPositions(address: string): Promise<{
  positions: LabPosition[];
  totalUsd: number;
  fetchedAt: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${baseUrl}/api/helius/das/wallet-holdings?address=${encodeURIComponent(address)}&limit=100`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Holdings fetch failed: ${res.status} ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  const raw: RawHolding[] = Array.isArray(data?.items) ? data.items : Array.isArray(data?.holdings) ? data.holdings : [];

  const mints = raw.map((h) => h.mint).filter(Boolean);
  const [prices, apys] = await Promise.all([fetchPricesUSD(mints), fetchCurrentApys()]);

  const positions: LabPosition[] = [];
  for (const h of raw) {
    if (!h.mint) continue;
    const dec = typeof h.decimals === "number" ? h.decimals : 0;
    const rawAmt = typeof h.amount === "string" ? Number(h.amount) : Number(h.amount ?? h.balance ?? 0);
    const amount = rawAmt / Math.pow(10, dec || 0);
    if (!isFinite(amount) || amount <= 0) continue;

    const price = prices[h.mint] ?? 0;
    if (price === 0) {
      // Surface unpriced positions for transparency; engine will skip them.
      warnings.push(`Skipped unpriced asset: ${h.symbol || h.mint.slice(0, 6)}`);
    }
    const category = classify(h.mint);
    const meta = YIELD_MINTS[h.mint];
    positions.push({
      mint: h.mint,
      symbol: h.symbol || meta?.symbol || h.mint.slice(0, 4),
      name: h.name,
      amount,
      decimals: dec,
      priceUsd: price,
      valueUsd: amount * price,
      category,
      protocol: meta?.protocol,
      currentApy: category === "YIELD_BEARING" ? apys[h.mint] ?? meta?.fallbackApy ?? 0 : 0,
      riskTier: meta?.riskTier,
    });
  }

  // Include native SOL if Helius response omits it (DAS sometimes excludes native).
  const hasSol = positions.some((p) => p.mint === "So11111111111111111111111111111111111111112");
  if (!hasSol) {
    try {
      const balRes = await fetch(
        `https://api.mainnet-beta.solana.com`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (balRes.ok) {
        const j = await balRes.json();
        const lamports = Number(j?.result?.value ?? 0);
        if (lamports > 0) {
          const amount = lamports / 1e9;
          const price = prices["So11111111111111111111111111111111111111112"] ?? 0;
          positions.push({
            mint: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
            name: "Solana",
            amount,
            decimals: 9,
            priceUsd: price,
            valueUsd: amount * price,
            category: "IDLE",
            currentApy: 0,
          });
        }
      }
    } catch {
      warnings.push("Could not resolve native SOL balance — RPC fallback failed.");
    }
  }

  positions.sort((a, b) => b.valueUsd - a.valueUsd);
  const totalUsd = positions.reduce((s, p) => s + p.valueUsd, 0);
  return { positions, totalUsd, fetchedAt: new Date().toISOString(), warnings };
}

export { fetchCurrentApys, fetchPricesUSD };
