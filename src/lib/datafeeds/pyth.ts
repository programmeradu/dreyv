/**
 * Pyth Hermes price feed client. Public REST, no API key required.
 *  - Docs: https://hermes.pyth.network/docs
 *  - Returns latest USD prices for a set of feed IDs.
 *
 * We map a small allowlist of common Solana symbols -> Pyth feed IDs so the
 * scanner can request `["SOL","BTC","ETH"]` without knowing the IDs.
 */
import type { DataFeed, DreyvEvent, MarketEvent } from "./normalize";

// Mainnet Pyth feed IDs (hex). Extend as needed.
export const PYTH_FEED_IDS: Record<string, string> = {
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USDT: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  JUP: "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  BONK: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
};

const HERMES_URL = "https://hermes.pyth.network/v2/updates/price/latest";

export interface PythInput {
  symbols: string[];
}

export const pythFeed: DataFeed<PythInput> = {
  id: "pyth",
  isReady: () => true,
  async fetch({ symbols }) {
    const valid = symbols
      .map((s) => s.toUpperCase())
      .filter((s) => PYTH_FEED_IDS[s]);
    if (!valid.length) return [];

    const url = new URL(HERMES_URL);
    for (const s of valid) url.searchParams.append("ids[]", PYTH_FEED_IDS[s]);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const parsed: any[] = data?.parsed || [];
    const observedAt = new Date().toISOString();
    const out: MarketEvent[] = [];

    for (const item of parsed) {
      const id: string = item?.id;
      const symbol = valid.find(
        (s) => PYTH_FEED_IDS[s].replace(/^0x/, "") === String(id).replace(/^0x/, ""),
      );
      if (!symbol) continue;
      const priceObj = item?.price;
      const price = Number(priceObj?.price);
      const expo = Number(priceObj?.expo ?? 0);
      if (!Number.isFinite(price)) continue;
      const priceUsd = price * Math.pow(10, expo);
      out.push({
        kind: "market",
        observedAt,
        source: "pyth",
        symbol,
        chain: "solana",
        priceUsd,
      });
    }
    return out as DreyvEvent[];
  },
};
