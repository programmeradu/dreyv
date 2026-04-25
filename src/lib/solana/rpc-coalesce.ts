/**
 * Solana RPC request coalescer.
 *
 * Two clients, two pages, two refresh intervals — all hitting `getBalance`
 * for the same vault address — would burn through the Helius free tier in
 * minutes. This coalescer collapses identical RPC calls fired within
 * `windowMs` (default 8s) into a single in-flight promise.
 *
 * Use with any Connection method:
 *   const balance = await coalesce("getBalance:" + vault, () => connection.getBalance(vault));
 *
 * The cache holds *promises*, so concurrent callers all await the same
 * underlying RPC. Once resolved, the promise is evicted after `windowMs`.
 *
 * Note: only suitable for read-only RPC calls. NEVER use for sendTransaction.
 */

interface CacheEntry {
  promise: Promise<unknown>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_WINDOW_MS = 8_000;

export function coalesce<T>(
  key: string,
  fn: () => Promise<T>,
  windowMs: number = DEFAULT_WINDOW_MS
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.promise as Promise<T>;
  }
  const promise = fn().finally(() => {
    // Evict shortly after resolution so subsequent fresh calls aren't blocked
    setTimeout(() => {
      const cur = cache.get(key);
      if (cur && cur.promise === promise) cache.delete(key);
    }, windowMs);
  });
  cache.set(key, { promise, expiresAt: now + windowMs });
  return promise;
}

/** Manual eviction — useful in tests or after a known state change. */
export function invalidate(key: string): void {
  cache.delete(key);
}

/** Full reset. */
export function clearCoalesceCache(): void {
  cache.clear();
}

/** Diagnostics. */
export function coalesceStats(): { keys: number; entries: string[] } {
  return { keys: cache.size, entries: Array.from(cache.keys()) };
}
