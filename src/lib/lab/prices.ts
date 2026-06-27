/**
 * Historical price fetcher (CoinGecko free tier).
 *
 * - In-memory TTL cache (10 minutes per series).
 * - Maps known mints → CoinGecko IDs. Unknown mints return null (Lab will
 *   gracefully skip them rather than fabricating numbers).
 *
 * Free tier: ~30 calls/min. We batch by single coin and cache aggressively.
 */

const TEN_MIN_MS = 10 * 60 * 1000;

// mint -> coingecko id
const MINT_TO_CG: Record<string, string> = {
  "So11111111111111111111111111111111111111112": "solana",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "usd-coin",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "tether",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "msol",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "jito-staked-sol",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "blazestake-staked-sol",
  STAKED_SOL_NATIVE: "solana",
  // Common speculative
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "jupiter-exchange-solana",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "bonk",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "pyth-network",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "raydium",
};

export function mintToCoingecko(mint: string): string | null {
  return MINT_TO_CG[mint] ?? null;
}

type CacheEntry = { at: number; series: Array<[number, number]> };
const cache = new Map<string, CacheEntry>();

/**
 * Returns price history as [unix_ms, usd][] sampled hourly/daily per CG.
 * windowDays of 1/7/30/90/365 is supported by CoinGecko free.
 */
export async function fetchPriceHistory(
  mint: string,
  windowDays: 30 | 90 | 365,
): Promise<Array<[number, number]> | null> {
  const cgId = mintToCoingecko(mint);
  if (!cgId) return null;
  const key = `${cgId}:${windowDays}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TEN_MIN_MS) return hit.series;

  const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${windowDays}&interval=daily`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return hit?.series ?? null;
    const data = await res.json();
    const series: Array<[number, number]> = Array.isArray(data?.prices)
      ? data.prices.map((p: [number, number]) => [p[0], p[1]])
      : [];
    if (series.length === 0) return hit?.series ?? null;
    cache.set(key, { at: now, series });
    return series;
  } catch {
    return hit?.series ?? null;
  }
}

/**
 * Multi-mint batch — sequenced (CG free tier is rate-limited).
 * Returns a map; missing entries are omitted, never faked.
 */
export async function fetchManyHistories(
  mints: string[],
  windowDays: 30 | 90 | 365,
): Promise<Record<string, Array<[number, number]>>> {
  const out: Record<string, Array<[number, number]>> = {};
  for (const m of mints) {
    const s = await fetchPriceHistory(m, windowDays);
    if (s) out[m] = s;
  }
  return out;
}

/** First price in the window (USD) or null if unavailable. */
export function priceAt(history: Array<[number, number]> | undefined, offsetFromEnd: number): number | null {
  if (!history || history.length === 0) return null;
  const idx = Math.max(0, history.length - 1 - offsetFromEnd);
  return history[idx]?.[1] ?? null;
}

/** Annualized realized vol (decimal) from a daily price series. */
export function realizedVol(history: Array<[number, number]> | undefined): number {
  if (!history || history.length < 8) return 0.25; // sensible default rather than NaN
  const rets: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1][1];
    const b = history[i][1];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length === 0) return 0.25;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(365);
}
