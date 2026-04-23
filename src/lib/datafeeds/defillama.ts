/**
 * DefiLlama yield + price feed. No API key required.
 * Docs: https://defillama.com/docs/api
 *
 * `fetchYields` returns the top N pools above a TVL floor, normalized to
 * YieldEvent. The scanner uses this every minute to spot APY deltas.
 */
import type { Chain, DataFeed, DreyvEvent, YieldEvent } from "./normalize";

const YIELDS_URL = "https://yields.llama.fi/pools";

const CHAIN_MAP: Record<string, Chain> = {
  solana: "solana",
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon",
  bsc: "bsc",
};

export interface DefiLlamaInput {
  chains?: Chain[];
  minTvlUsd?: number;
  limit?: number;
}

export const defiLlamaYields: DataFeed<DefiLlamaInput> = {
  id: "defillama",
  isReady: () => true,
  async fetch({ chains, minTvlUsd = 1_000_000, limit = 50 } = {}) {
    const res = await fetch(YIELDS_URL, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const pools: any[] = data?.data || [];
    const observedAt = new Date().toISOString();

    const filtered = pools
      .filter((p) => {
        const c = CHAIN_MAP[String(p?.chain || "").toLowerCase()];
        if (!c) return false;
        if (chains && !chains.includes(c)) return false;
        const tvl = Number(p?.tvlUsd) || 0;
        return tvl >= minTvlUsd;
      })
      .sort((a, b) => (Number(b?.apy) || 0) - (Number(a?.apy) || 0))
      .slice(0, limit);

    const events: YieldEvent[] = filtered.map((p) => ({
      kind: "yield",
      observedAt,
      source: "defillama",
      protocol: String(p?.project || "unknown"),
      chain: CHAIN_MAP[String(p?.chain).toLowerCase()],
      poolId: String(p?.pool || `${p?.project}-${p?.symbol}`),
      asset: String(p?.symbol || "?"),
      apy: Number(p?.apy) || 0,
      tvlUsd: Number(p?.tvlUsd) || 0,
      // crude risk: low TVL = riskier; outlier APY also bumps risk
      riskScore: Math.min(
        100,
        Math.round(
          50 -
            Math.log10(Math.max(1, Number(p?.tvlUsd) || 1)) * 5 +
            Math.min(50, Math.max(0, Number(p?.apy) || 0) / 2),
        ),
      ),
    }));

    return events as DreyvEvent[];
  },
};
