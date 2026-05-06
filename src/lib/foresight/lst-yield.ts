/**
 * Liquid-staking token yield estimator.
 *
 * Holding LSTs (jitoSOL, mSOL, bSOL, …) accrues value via exchange-rate
 * appreciation rather than discrete payouts, so it never lands in the
 * `treasury_events` ledger as `kind="yield"`. This helper produces a
 * weighted-average estimated APY so the analytics cockpit can show a real
 * number for users earning staking yield, even before we wire per-LST
 * exchange-rate snapshotting.
 *
 * Numbers below are conservative public APY ranges (Jito ~7.6%, Marinade
 * ~7.1%, Solayer ~7.3%, BlazeStake ~7.1%) — refresh quarterly.
 */

export interface LstHolding {
  symbol: string;
  amount: number;      // human units
  priceUsd?: number | null;
}

export interface LstYieldEstimate {
  positions: number;
  yieldBearingUsd: number;
  blendedApy: number;       // 0..1 (e.g. 0.073)
  annualYieldUsd: number;
  breakdown: Array<{ symbol: string; usd: number; apy: number; annualUsd: number }>;
}

const LST_APY: Record<string, number> = {
  JITOSOL: 0.0762,
  MSOL:    0.0710,
  BSOL:    0.0712,
  JSOL:    0.0688,
  STSOL:   0.0682,
  INF:     0.0855,
  HUBSOL:  0.0691,
};

const STABLE_LP_APY: Record<string, number> = {
  // Conservative fallback for tokenized stable yields. We only count
  // these when the symbol is unambiguously a yield-bearing wrapper.
  USDS:    0.0500,
};

function lookupApy(sym: string): number | null {
  const u = sym.toUpperCase();
  return LST_APY[u] ?? STABLE_LP_APY[u] ?? null;
}

export function estimateLstYield(holdings: LstHolding[]): LstYieldEstimate {
  let yieldBearingUsd = 0;
  let annualYieldUsd = 0;
  const breakdown: LstYieldEstimate["breakdown"] = [];
  for (const h of holdings) {
    const apy = lookupApy(h.symbol);
    if (apy == null) continue;
    const usd = Math.max(0, (h.priceUsd ?? 0) * (h.amount ?? 0));
    if (usd <= 0) continue;
    const annual = usd * apy;
    yieldBearingUsd += usd;
    annualYieldUsd += annual;
    breakdown.push({ symbol: h.symbol.toUpperCase(), usd, apy, annualUsd: annual });
  }
  const blendedApy = yieldBearingUsd > 0 ? annualYieldUsd / yieldBearingUsd : 0;
  return {
    positions: breakdown.length,
    yieldBearingUsd,
    blendedApy,
    annualYieldUsd,
    breakdown,
  };
}
