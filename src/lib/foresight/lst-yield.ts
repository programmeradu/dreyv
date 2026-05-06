/**
 * Liquid-staking token yield estimator.
 *
 * Holding LSTs (jitoSOL, mSOL, bSOL, …) accrues value via exchange-rate
 * appreciation rather than discrete payouts, so it never lands in the
 * `treasury_events` ledger as `kind="yield"`. This helper produces a
 * weighted-average estimated APY so the analytics cockpit can show a real
 * number for users earning staking yield.
 *
 * APYs come from the live /api/yield/rates feed (Marinade, Sanctum,
 * Stakeview, Jito) cached for 5 min. The conservative fallbacks here are
 * ONLY used when the live feed is unavailable AND the caller did not pass
 * a liveRates map — they should never be considered the source of truth.
 */

import { YIELD_MINTS } from "@/lib/yield-registry";

export interface LstHolding {
  symbol: string;
  mint?: string;
  amount: number;      // human units
  priceUsd?: number | null;
}

export interface LstYieldEstimate {
  positions: number;
  yieldBearingUsd: number;
  blendedApy: number;       // 0..1 (e.g. 0.073)
  annualYieldUsd: number;
  source: "live" | "estimated" | "mixed";
  breakdown: Array<{ symbol: string; usd: number; apy: number; annualUsd: number; source: "live" | "estimated" }>;
}

export interface LiveRateEntry {
  apy: number;            // percentage, e.g. 6.5
  source: "live" | "estimated";
  protocol: string;
  symbol: string;
}

export type LiveRatesMap = Record<string, LiveRateEntry>;

// Build a symbol→mint reverse map from the registry so we can match
// holdings that only carry a symbol (e.g. portfolio aggregations).
const SYMBOL_TO_MINT: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [mint, meta] of Object.entries(YIELD_MINTS)) {
    out[meta.symbol.toUpperCase()] = mint;
  }
  return out;
})();

// Conservative fallback for tokenized stable yields (only used when no live
// rate is available). Keep this minimal — anything else should be live.
const STABLE_FALLBACK_APY: Record<string, number> = {
  USDS: 0.05,
};

function findRate(holding: LstHolding, liveRates?: LiveRatesMap): { apy: number; source: "live" | "estimated" } | null {
  const sym = (holding.symbol || "").toUpperCase();
  const mint = holding.mint || SYMBOL_TO_MINT[sym] || null;

  if (liveRates && mint && liveRates[mint]) {
    const r = liveRates[mint];
    const apy = Number(r.apy) || 0;
    if (apy > 0) return { apy: apy / 100, source: r.source };
  }

  // Fallback to registry's conservative APY
  if (mint && YIELD_MINTS[mint]) {
    return { apy: YIELD_MINTS[mint].fallbackApy / 100, source: "estimated" };
  }
  if (sym in STABLE_FALLBACK_APY) {
    return { apy: STABLE_FALLBACK_APY[sym], source: "estimated" };
  }
  return null;
}

/**
 * Fetch live LST APYs from /api/yield/rates. Safe to call from the browser.
 * Returns an empty object on failure — callers should fall back to registry.
 */
export async function fetchLiveLstRates(signal?: AbortSignal): Promise<LiveRatesMap> {
  try {
    const res = await fetch("/api/yield/rates", { signal, cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    return (data?.rates ?? {}) as LiveRatesMap;
  } catch {
    return {};
  }
}

export function estimateLstYield(holdings: LstHolding[], liveRates?: LiveRatesMap): LstYieldEstimate {
  let yieldBearingUsd = 0;
  let annualYieldUsd = 0;
  let liveCount = 0;
  let estCount = 0;
  const breakdown: LstYieldEstimate["breakdown"] = [];
  for (const h of holdings) {
    const rate = findRate(h, liveRates);
    if (!rate) continue;
    const usd = Math.max(0, (h.priceUsd ?? 0) * (h.amount ?? 0));
    if (usd <= 0) continue;
    const annual = usd * rate.apy;
    yieldBearingUsd += usd;
    annualYieldUsd += annual;
    if (rate.source === "live") liveCount++;
    else estCount++;
    breakdown.push({
      symbol: (h.symbol || "").toUpperCase(),
      usd,
      apy: rate.apy,
      annualUsd: annual,
      source: rate.source,
    });
  }
  const blendedApy = yieldBearingUsd > 0 ? annualYieldUsd / yieldBearingUsd : 0;
  const source: "live" | "estimated" | "mixed" =
    liveCount > 0 && estCount === 0 ? "live"
    : liveCount === 0 && estCount > 0 ? "estimated"
    : liveCount > 0 ? "mixed"
    : "estimated";
  return {
    positions: breakdown.length,
    yieldBearingUsd,
    blendedApy,
    annualYieldUsd,
    source,
    breakdown,
  };
}
