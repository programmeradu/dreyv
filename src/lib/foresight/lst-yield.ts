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
export async function fetchLiveLstRates(signal?: AbortSignal, baseUrl?: string): Promise<LiveRatesMap> {
  try {
    const url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/yield/rates` : "/api/yield/rates";
    const res = await fetch(url, { signal, cache: "no-store" });
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

function fmtUsdShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Build a compact, LLM-friendly yield context string from a holdings list +
 * (optional) live rates. Used by every agent surface (CommandBar system
 * prompt, /analytics insights, foresight narrative) so every reasoning pass
 * knows what the treasury is currently earning. Never invents numbers — if
 * no yield-bearing positions are detected, returns an explicit "no yield"
 * line so the LLM does not hallucinate.
 */
export function summarizeYieldForLLM(
  holdings: LstHolding[],
  liveRates?: LiveRatesMap,
): string {
  const est = estimateLstYield(holdings, liveRates);
  if (est.positions === 0 || est.yieldBearingUsd <= 0) {
    return "Yield context: no yield-bearing positions detected (no LSTs or tokenized stable yield in current holdings).";
  }
  const top = [...est.breakdown]
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5)
    .map(
      (b) =>
        `${b.symbol} ${fmtUsdShort(b.usd)} @ ${(b.apy * 100).toFixed(2)}% (${b.source}) → ${fmtUsdShort(b.annualUsd)}/yr`,
    )
    .join("; ");
  return [
    `Yield context (${est.source}):`,
    `${est.positions} yield-bearing position(s), ${fmtUsdShort(est.yieldBearingUsd)} earning, blended APY ${(est.blendedApy * 100).toFixed(2)}%, projected ${fmtUsdShort(est.annualYieldUsd)}/yr.`,
    `Breakdown: ${top}.`,
  ].join(" ");
}
