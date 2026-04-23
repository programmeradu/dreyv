/**
 * LunarCrush narrative + social signal feed. Requires `LUNARCRUSH_API_KEY`.
 * Docs: https://lunarcrush.com/developers/api
 *
 * Pulls top movers / galaxy score deltas as IntelEvent. Optional — feed is
 * isReady=false when key absent so the scanner just skips it.
 */
import type { DataFeed, DreyvEvent, IntelEvent } from "./normalize";

export interface LunarCrushInput {
  symbols?: string[];
  limit?: number;
}

export const lunarCrushFeed: DataFeed<LunarCrushInput> = {
  id: "lunarcrush",
  isReady: () => Boolean(process.env.LUNARCRUSH_API_KEY),
  async fetch({ symbols, limit = 25 } = {}) {
    const key = process.env.LUNARCRUSH_API_KEY;
    if (!key) return [];
    const url = new URL("https://lunarcrush.com/api4/public/coins/list/v1");
    url.searchParams.set("limit", String(limit));
    if (symbols?.length) url.searchParams.set("symbol", symbols.join(","));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const items: any[] = data?.data || [];
    const observedAt = new Date().toISOString();

    return items.slice(0, limit).map<IntelEvent>((it) => ({
      kind: "intel",
      observedAt,
      source: "lunarcrush",
      topic: "social",
      symbol: it?.symbol,
      summary: `${it?.symbol} galaxy ${it?.galaxy_score ?? "?"} • alt-rank ${it?.alt_rank ?? "?"} • social vol ${it?.social_volume_24h ?? "?"}`,
      weight:
        typeof it?.galaxy_score === "number"
          ? Math.min(1, it.galaxy_score / 100)
          : undefined,
      payload: it,
    })) as DreyvEvent[];
  },
};
