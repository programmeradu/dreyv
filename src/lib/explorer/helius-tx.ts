/**
 * Server-side helper to fetch Helius enhanced transactions for a wallet.
 * Cached briefly in-process to avoid duplicate work across API routes
 * during a single page render.
 */

export interface EnhancedTx {
  signature: string;
  timestamp: number; // unix seconds
  fee: number;
  type: string;
  source?: string;
  description?: string;
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number; // lamports
  }>;
  events?: any;
  raw?: unknown;
}

const cache = new Map<string, { at: number; data: EnhancedTx[] }>();
const TTL = 60_000;

export async function getEnhancedTransactions(address: string, limit = 100): Promise<EnhancedTx[]> {
  const key = `${address}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=${limit}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    const arr = Array.isArray(j) ? (j as EnhancedTx[]) : [];
    cache.set(key, { at: Date.now(), data: arr });
    return arr;
  } catch {
    return [];
  }
}

/** Approximate wallet age (days) from oldest enhanced tx, or null. */
export function deriveAgeDays(txs: EnhancedTx[]): number | null {
  if (!txs.length) return null;
  const oldest = txs.reduce((min, t) => (t.timestamp && t.timestamp < min ? t.timestamp : min), txs[0]!.timestamp);
  if (!oldest) return null;
  return Math.floor((Date.now() / 1000 - oldest) / 86400);
}
