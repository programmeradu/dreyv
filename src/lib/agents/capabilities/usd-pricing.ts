/**
 * Lightweight USD pricing helper for capability outputs.
 *
 * Capabilities that build signable transactions should attach an
 * `estimatedValueUsd` field so the CommandBar can size the 0.05% protocol
 * fee transfer. We resolve token → USD price via Jupiter's lite price API
 * with a 60s in-process cache. Returns `null` (never throws) on failure —
 * the fee skips when value is unknown.
 */

// Jupiter v3 lite API takes mint addresses (not symbols) and returns
// `{ <mint>: { usdPrice, ... } }`. We therefore resolve symbols → mints
// locally, then fall back to DefiLlama's `coins.llama.fi/prices/current`
// (which keys by `coingecko:slug` or `solana:<mint>` and returns `price`).

type CacheEntry = { price: number; expiry: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI"]);
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",  // USDS
]);

// Symbol → SPL mint for the most common Solana tokens. Anything else
// the caller is expected to pass as a base58 mint already.
const SYMBOL_TO_MINT: Record<string, string> = {
  SOL:     "So11111111111111111111111111111111111111112",
  WSOL:    "So11111111111111111111111111111111111111112",
  MSOL:    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  BSOL:    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  JUP:     "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK:    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  PYTH:    "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  RAY:     "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA:    "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  JTO:     "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  WIF:     "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
};

function looksLikeMint(s: string) {
  return s.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

async function fetchJupV3(mint: string): Promise<number | null> {
  try {
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(mint)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { usdPrice?: number; price?: number }>;
    // v3 returns `{ <mint>: { usdPrice } }` at the root (no `data` wrapper).
    const entry = json?.[mint];
    const p = typeof entry?.usdPrice === "number"
      ? entry.usdPrice
      : typeof entry?.price === "number"
        ? entry.price
        : null;
    return p && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fetchLlama(mint: string, isSol: boolean): Promise<number | null> {
  try {
    const id = isSol ? "coingecko:solana" : `solana:${mint}`;
    const url = `https://coins.llama.fi/prices/current/${encodeURIComponent(id)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { coins?: Record<string, { price?: number }> };
    const p = json?.coins?.[id]?.price;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

export async function priceUsd(symbolOrMint: string): Promise<number | null> {
  if (!symbolOrMint) return null;
  const key = symbolOrMint.trim();
  if (!key) return null;

  const upper = key.toUpperCase();
  if (STABLE_SYMBOLS.has(upper) || STABLE_MINTS.has(key)) return 1;

  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiry > now) return cached.price;

  // Resolve to a mint; if we can't, we can't price it.
  const mint = looksLikeMint(key) ? key : SYMBOL_TO_MINT[upper];
  if (!mint) return null;

  const isSol = mint === "So11111111111111111111111111111111111111112";

  // Jupiter v3 first, DefiLlama as fallback.
  const p = (await fetchJupV3(mint)) ?? (await fetchLlama(mint, isSol));
  if (p && p > 0) {
    cache.set(key, { price: p, expiry: now + TTL_MS });
    return p;
  }
  return null;
}

/**
 * Convenience: token amount × USD price. Returns null if price unknown.
 */
export async function estimateUsdValue(
  symbolOrMint: string,
  amount: number | null | undefined,
): Promise<number | null> {
  if (!amount || !Number.isFinite(amount) || amount <= 0) return null;
  const p = await priceUsd(symbolOrMint);
  if (!p) return null;
  return p * amount;
}
