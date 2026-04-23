/**
 * TokenUnlocks-style upcoming unlock feed. Wrapper around the public CryptoRank
 * Vesting endpoint as a free baseline; can be swapped to TokenUnlocks paid API
 * when `TOKENUNLOCKS_API_KEY` is set.
 *
 * Emits IntelEvent { topic: "token_unlock" } so the scanner can flag
 * sell-side risk near unlock dates.
 */
import type { DataFeed, DreyvEvent, IntelEvent } from "./normalize";

export interface TokenUnlocksInput {
  withinDays?: number;
}

export const tokenUnlocksFeed: DataFeed<TokenUnlocksInput> = {
  id: "tokenunlocks",
  // Always "ready" — public fallback works without a key
  isReady: () => true,
  async fetch({ withinDays = 30 } = {}) {
    try {
      const url = "https://api.cryptorank.io/v0/coins?orderBy=marketCap&orderDirection=desc&limit=200";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const items: any[] = data?.data || [];
      const cutoff = Date.now() + withinDays * 86_400_000;
      const observedAt = new Date().toISOString();
      const events: IntelEvent[] = [];

      for (const it of items) {
        const next = it?.vesting?.nextUnlock?.date || it?.nextUnlockDate;
        if (!next) continue;
        const t = new Date(next).getTime();
        if (!Number.isFinite(t) || t > cutoff || t < Date.now()) continue;
        events.push({
          kind: "intel",
          observedAt,
          source: "tokenunlocks",
          topic: "token_unlock",
          symbol: it?.symbol,
          summary: `${it?.symbol} unlock on ${new Date(t).toISOString().slice(0, 10)} (~${Math.round((t - Date.now()) / 86_400_000)}d)`,
          weight: 0.5,
          payload: { unlockAt: new Date(t).toISOString(), raw: it },
        });
      }
      return events as DreyvEvent[];
    } catch {
      return [];
    }
  },
};
