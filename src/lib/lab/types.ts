/**
 * Dreyv Lab — shared types.
 * Engine is pure; no I/O lives here.
 */

import type { RiskTier } from "@/lib/yield-registry";

export type LabCategory = "IDLE" | "YIELD_BEARING" | "SPECULATIVE";

export interface LabPosition {
  mint: string;
  symbol: string;
  name?: string;
  amount: number;          // human units (not lamports)
  decimals: number;
  priceUsd: number;
  valueUsd: number;
  category: LabCategory;
  /** If YIELD_BEARING: protocol name (e.g. "Jito") */
  protocol?: string;
  /** Current APY for this position; 0 for idle base assets */
  currentApy: number;
  riskTier?: RiskTier;
}

export interface LabRotation {
  /** What we'd move out of */
  from: { mint: string; symbol: string; valueUsd: number; currentApy: number };
  /** What we'd move into */
  to: {
    mint: string;
    symbol: string;
    protocol: string;
    apy: number;
    riskTier: RiskTier;
    aumUsd?: number;
  };
  /** Projected gain (USD) over the projection window */
  projectedDeltaUsd: number;
  /** Days to break even after assumed swap cost (default 0.30%) */
  breakEvenDays: number;
  /** Annualized vol of the destination (decimal, e.g. 0.18 = 18%) */
  vol: number;
  /** Risk-adjusted score (higher = better) used for ranking */
  score: number;
  /** Estimated liquidity exit time (hours) — heuristic from AUM */
  liquidityExitHours: number;
}

export interface LabMissedRotation extends LabRotation {
  /** Realized opportunity cost over the lookback window */
  realizedOppCostUsd: number;
  /** Window (days) the realization was computed over */
  windowDays: 30 | 90 | 365;
}

export type LabScenarioKind =
  | "sol_crash"
  | "usdc_depeg"
  | "lst_slashing"
  | "lst_liquidity_drain"
  | "validator_outage"
  | "custom";

export interface LabScenario {
  kind: LabScenarioKind;
  label: string;
  /** Free-form params; engine knows which it cares about */
  params: {
    asset?: string;      // mint or symbol
    movePct?: number;    // -40 = -40%
    windowHours?: number;
    depegPct?: number;
    slashingPct?: number;
    liquidityHaircutPct?: number;
  };
}

export interface LabStressResult {
  scenario: LabScenario;
  totalLossUsd: number;
  drawdownPct: number;
  worstAsset?: { symbol: string; lossUsd: number; pctOfPortfolio: number };
  recoveryDays: number;            // assume +10%/yr drift recovery
  perAsset: Array<{
    mint: string;
    symbol: string;
    beforeUsd: number;
    afterUsd: number;
    deltaUsd: number;
    deltaPct: number;
  }>;
  hardening: Array<{
    id: string;
    title: string;
    rationale: string;
    severity: "info" | "warn" | "critical";
    cta?: { kind: "rotate"; rotation: LabRotation } | { kind: "diversify"; into: string[] } | { kind: "cold_sweep" };
  }>;
}

export interface LabPlaybook {
  id: string;
  name: string;
  tagline: string;
  thesis: string;
  riskTier: RiskTier;
  /** Pseudo-DSL nodes; v1 = simple sequence */
  nodes: Array<
    | { type: "deposit"; asset: string; pctOfPortfolio: number }
    | { type: "stake"; into: string }
    | { type: "rotate_when_apy_below"; from: string; to: string; threshold: number }
    | { type: "sweep_yield_to"; destination: "cold_wallet" | "usdc_reserve" }
    | { type: "rebalance_quarterly"; targets: Record<string, number> }
  >;
  /** Capabilities this playbook composes — must exist in registry */
  capabilitiesUsed: string[];
}

export interface LabBacktestResult {
  playbookId: string;
  windowDays: number;
  startUsd: number;
  endUsdPlaybook: number;
  endUsdBaseline: number;
  deltaUsd: number;
  deltaPct: number;
  maxDrawdownPct: number;
  series: Array<{ t: number; playbook: number; baseline: number }>;
}
