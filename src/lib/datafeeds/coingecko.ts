/**
 * CoinGecko free price feed. Public, no key required (rate-limited).
 * Docs: https://docs.coingecko.com/reference/simple-price
 */
import type { DataFeed, DreyvEvent, MarketEvent } from "./normalize";

const URL_BASE = "https://api.coingecko.com/api/v3/simple/price";

export interface CoingeckoInput {
  /** CoinGecko ids, e.g. ["solana","ethereum","jupiter-exchange-solana"]. */
  ids: string[];
}

export const coingeckoFeed: DataFeed<CoingeckoInput> = {
  id: "coingecko",
  isReady: () => true,
  async fetch({ ids }) {
    if (!ids?.length) return [];
    const url = new URL(URL_BASE);
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_24hr_change", "true");

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as
      | Record<string, { usd?: number; usd_24h_change?: number }>
      | null;
    if (!data) return [];

    const observedAt = new Date().toISOString();
    const out: MarketEvent[] = [];
    for (const [id, payload] of Object.entries(data)) {
      const priceUsd = Number(payload?.usd);
      if (!Number.isFinite(priceUsd)) continue;
      out.push({
        kind: "market",
        observedAt,
        source: "coingecko",
        symbol: id.toUpperCase(),
        chain: "off-chain",
        priceUsd,
        changePct:
          typeof payload?.usd_24h_change === "number"
            ? payload.usd_24h_change
            : undefined,
        windowSec: 86_400,
      });
    }
    return out as DreyvEvent[];
  },
};
