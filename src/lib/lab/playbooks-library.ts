import type { LabPlaybook } from "./types";

/**
 * Curated v1 playbook library.
 * Each playbook composes capabilities that already exist in our registry
 * — they can be forked into a DACS subagent without writing new code.
 */
export const PLAYBOOK_LIBRARY: LabPlaybook[] = [
  {
    id: "safe-yield-anchor",
    name: "Safe Yield Anchor",
    tagline: "Park idle SOL into the highest-liquidity LST and sweep yield to USDC.",
    thesis:
      "Idle SOL earns nothing. JitoSOL gives MEV-boosted staking with deepest liquidity, and quarterly yield-sweeping into USDC compounds risk-free capital.",
    riskTier: "low",
    nodes: [
      { type: "deposit", asset: "SOL", pctOfPortfolio: 80 },
      { type: "deposit", asset: "USDC", pctOfPortfolio: 20 },
      { type: "stake", into: "JITOSOL" },
      { type: "sweep_yield_to", destination: "usdc_reserve" },
    ],
    capabilitiesUsed: ["jupiter_swap", "dreyv_economy_action_code_request"],
  },
  {
    id: "balanced-treasury",
    name: "Balanced Treasury",
    tagline: "Quarterly-rebalanced 40/40/20 across JitoSOL, mSOL, and USDC.",
    thesis:
      "Diversifying staking exposure across two top LSTs hedges slashing/operator risk while a 20% USDC reserve absorbs SOL drawdowns.",
    riskTier: "low",
    nodes: [
      { type: "rebalance_quarterly", targets: { JITOSOL: 0.40, MSOL: 0.40, USDC: 0.20 } },
    ],
    capabilitiesUsed: ["jupiter_swap"],
  },
  {
    id: "yield-rotator",
    name: "APY Rotator",
    tagline: "Auto-rotate from mSOL to JitoSOL when Jito APY leads by >0.4%.",
    thesis:
      "LST APYs drift. Programmatically chasing the best yield within the top-tier LSTs captures 30-80 bps/yr of extra return without taking new risk.",
    riskTier: "medium",
    nodes: [
      { type: "stake", into: "MSOL" },
      { type: "rotate_when_apy_below", from: "MSOL", to: "JITOSOL", threshold: 6.0 },
    ],
    capabilitiesUsed: ["jupiter_swap", "dreyv_economy_action_code_request"],
  },
  {
    id: "cold-sweep-discipline",
    name: "Cold Sweep Discipline",
    tagline: "Stake 70% in JitoSOL, sweep all realized yield to cold wallet weekly.",
    thesis:
      "Compounding stays on hot wallet (productive) while realized yield migrates to cold custody — caps how much capital is ever exposed to a single key compromise.",
    riskTier: "low",
    nodes: [
      { type: "deposit", asset: "SOL", pctOfPortfolio: 70 },
      { type: "deposit", asset: "USDC", pctOfPortfolio: 30 },
      { type: "stake", into: "JITOSOL" },
      { type: "sweep_yield_to", destination: "cold_wallet" },
    ],
    capabilitiesUsed: ["jupiter_swap", "dreyv_economy_wallet_promote"],
  },
];
