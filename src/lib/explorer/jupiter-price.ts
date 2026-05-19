/**
 * Thin Jupiter Price API wrapper used by the explorer for current
 * and historical USD prices. Falls back gracefully when prices are
 * missing — never throws.
 */

interface PriceMap {
  [mint: string]: number; // usd per token
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

let cache: { at: number; data: PriceMap } | null = null;
const TTL_MS = 30_000;

export async function getCurrentPricesUsd(mints: string[]): Promise<PriceMap> {
  if (!mints.length) return {};
  if (cache && Date.now() - cache.at < TTL_MS) {
    const hit = Object.fromEntries(mints.filter((m) => cache!.data[m] != null).map((m) => [m, cache!.data[m]]));
    if (Object.keys(hit).length === mints.length) return hit;
  }
  try {
    // Jupiter Lite Price API v3 — replaces deprecated price.jup.ag/v6.
    // Response shape: { [mint]: { usdPrice, decimals, ... } }
    const url = `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return {};
    const j = await r.json();
    const out: PriceMap = {};
    const root = j?.data ?? j ?? {};
    for (const [mint, v] of Object.entries<any>(root)) {
      const px = v?.usdPrice ?? v?.price;
      if (px != null) out[mint] = Number(px);
    }
    cache = { at: Date.now(), data: { ...(cache?.data ?? {}), ...out } };
    return out;
  } catch {
    return {};
  }
}

/** Returns SOL USD price now, or null. */
export async function getSolUsdPrice(): Promise<number | null> {
  const p = await getCurrentPricesUsd([SOL_MINT]);
  return p[SOL_MINT] ?? null;
}

/**
 * Daily close USD prices for a single mint over `days` days.
 * Uses CoinGecko market_chart (Jupiter has no public historical).
 * Returns [{ ts: ms, usd }] ascending. Empty on failure.
 */
export async function getDailyCloseUsd(coingeckoId: string, days: number): Promise<Array<{ ts: number; usd: number }>> {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    const prices: [number, number][] = j?.prices ?? [];
    return prices.map(([ts, usd]) => ({ ts, usd }));
  } catch {
    return [];
  }
}

export const COINGECKO_IDS: Record<string, string> = {
  [SOL_MINT]: "solana",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "usd-coin",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "tether",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "msol",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "jito-staked-sol",
};
