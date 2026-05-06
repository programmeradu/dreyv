/**
 * Lightweight USD pricing helper for capability outputs.
 *
 * Capabilities that build signable transactions should attach an
 * `estimatedValueUsd` field so the CommandBar can size the 0.05% protocol
 * fee transfer. We resolve token → USD price via Jupiter's lite price API
 * with a 60s in-process cache. Returns `null` (never throws) on failure —
 * the fee skips when value is unknown.
 */

const JUP_PRICE_URL = "https://lite-api.jup.ag/price/v3";

type CacheEntry = { price: number; expiry: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI"]);
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

function looksLikeMint(s: string) {
  return s.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
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

  try {
    const url = `${JUP_PRICE_URL}?ids=${encodeURIComponent(looksLikeMint(key) ? key : upper)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, { price?: number }> };
    const entry = json?.data?.[looksLikeMint(key) ? key : upper];
    const p = typeof entry?.price === "number" ? entry.price : null;
    if (p && p > 0) {
      cache.set(key, { price: p, expiry: now + TTL_MS });
      return p;
    }
  } catch {
    /* swallow */
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
