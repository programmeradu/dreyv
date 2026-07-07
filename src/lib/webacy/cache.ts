/**
 * Tiny in-memory TTL cache for Webacy responses.
 *
 * Process-local — OK because Webacy calls are already cached upstream by
 * the provider and every response is small. If we later move to Redis,
 * we swap this module and keep the same API.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const STORE = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 5000;

function evictIfNeeded() {
  if (STORE.size <= MAX_ENTRIES) return;
  // Drop the oldest ~10% of entries (FIFO on insertion order via Map).
  const drop = Math.ceil(MAX_ENTRIES * 0.1);
  let i = 0;
  for (const key of STORE.keys()) {
    if (i++ >= drop) break;
    STORE.delete(key);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const e = STORE.get(key) as Entry<T> | undefined;
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    STORE.delete(key);
    return undefined;
  }
  return e.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  STORE.set(key, { value, expiresAt: Date.now() + ttlMs });
  evictIfNeeded();
}

export async function cacheWrap<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}

export const WEBACY_TTL = {
  address: 6 * 60 * 60 * 1000, // 6h
  token: 6 * 60 * 60 * 1000, // 6h
  url: 24 * 60 * 60 * 1000, // 24h
  tx: 5 * 60 * 1000, // 5m
  exposure: 15 * 60 * 1000, // 15m
  approvals: 5 * 60 * 1000, // 5m
} as const;

/** Test-only helper. Do not call from app code. */
export function __clearWebacyCache() {
  STORE.clear();
}
