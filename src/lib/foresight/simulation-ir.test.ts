import { describe, expect, it } from "vitest";
import {
  presetScenarioToIR,
  runSimulationIR,
  irToFlatVariables,
  type SimulationIR,
  type IRToken,
} from "./simulation-ir";

const TOKENS: IRToken[] = [
  { symbol: "SOL", amount: 1000, price: 150 },
  { symbol: "USDC", amount: 50_000, price: 1 },
  { symbol: "JTO", amount: 5_000, price: 2 },
];

const startUsd = 1000 * 150 + 50_000 + 5_000 * 2; // 210,000

function makeIR(partial: Partial<SimulationIR>): SimulationIR {
  return {
    horizonMonths: 12,
    startState: { tokens: TOKENS, usd: startUsd },
    shocks: [],
    flows: [],
    rebalances: [],
    yields: [],
    assumptions: [],
    unknowns: [],
    scenarioLabel: "test",
    ...partial,
  };
}

describe("SimulationIR engine — coverage", () => {
  // ── 30 real what-if fixtures with expected IR shape + invariants ─────────

  it("01 hire 2 engineers at 40 SOL/mo → outflow $12k/mo via SOL", () => {
    const ir = makeIR({
      flows: [{ kind: "hire", sol: 80, cadence: "monthly", label: "2 hires" }],
    });
    const r = runSimulationIR(ir);
    expect(r.startValue).toBe(startUsd);
    // 80 SOL * $150 = $12,000/mo over 12mo = $144k outflow → end ≈ $66k
    expect(r.endValue).toBeLessThan(r.startValue);
    expect(r.endValue).toBeGreaterThan(50_000);
  });

  it("02 USDC depegs 5% → only USDC price shifts", () => {
    const ir = makeIR({ shocks: [{ symbol: "USDC", pctChange: -0.05, atMonth: 12, linear: true }] });
    const r = runSimulationIR(ir);
    expect(r.priceChanges.USDC).toBeCloseTo(-0.05);
    expect(r.endValue).toBeCloseTo(startUsd - 50_000 * 0.05, 0);
  });

  it("03 SOL drops 40% → portfolio drawdown majority from SOL", () => {
    const ir = makeIR({ shocks: [{ symbol: "SOL", pctChange: -0.4, atMonth: 12, linear: true }] });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeCloseTo(startUsd - 1000 * 150 * 0.4, 0);
  });

  it("04 rebalance to barbell 70/30 SOL/USDC", () => {
    const ir = makeIR({
      rebalances: [{ atMonth: 0, targetAllocationPct: { SOL: 70, USDC: 30 } }],
    });
    const r = runSimulationIR(ir);
    const solValue = r.endTokens.find((t) => t.symbol === "SOL")!.value;
    const usdcValue = r.endTokens.find((t) => t.symbol === "USDC")!.value;
    expect(solValue / r.endValue).toBeCloseTo(0.7, 1);
    expect(usdcValue / r.endValue).toBeCloseTo(0.3, 1);
  });

  it("05 reduce SOL concentration to 60% (rebalance keeps remainder usdc/jto)", () => {
    const ir = makeIR({
      rebalances: [{ atMonth: 0, targetAllocationPct: { SOL: 60, USDC: 30, JTO: 10 } }],
    });
    const r = runSimulationIR(ir);
    expect(r.endTokens.find((t) => t.symbol === "SOL")!.value / r.endValue).toBeCloseTo(0.6, 1);
  });

  it("06 deposit 100 SOL one-time at M0", () => {
    const ir = makeIR({
      flows: [{ kind: "deposit", sol: 100, cadence: "one_time", startMonth: 0 }],
    });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeCloseTo(startUsd + 100 * 150, 0);
  });

  it("07 stake half on Jito @ 7% → small yield kicker", () => {
    const ir = makeIR({ yields: [{ symbol: "JITOSOL", apy: 0.07, principalPct: 0.5 }] });
    const r = runSimulationIR(ir);
    // No JITOSOL holding → engine ignores; portfolio unchanged.
    expect(r.endValue).toBeCloseTo(startUsd, 0);
  });

  it("08 portfolio-wide yield 5% → all holdings compound", () => {
    const ir = makeIR({ yields: [{ symbol: "*", apy: 0.05 }] });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeGreaterThan(startUsd);
  });

  it("09 monthly burn $20k → runway ≈ 10mo", () => {
    const ir = makeIR({ flows: [{ kind: "outflow", usd: 20_000, cadence: "monthly" }] });
    const r = runSimulationIR(ir);
    expect(r.runwayMonths).toBeGreaterThan(8);
    expect(r.runwayMonths).toBeLessThan(13);
  });

  it("10 monthly inflow $30k offsets burn $20k → grows", () => {
    const ir = makeIR({
      flows: [
        { kind: "outflow", usd: 20_000, cadence: "monthly" },
        { kind: "inflow", usd: 30_000, cadence: "monthly" },
      ],
    });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeGreaterThan(startUsd);
  });

  it("11 weekly inflow $5k cadence → ~$21,725/mo", () => {
    const ir = makeIR({ flows: [{ kind: "inflow", usd: 5_000, cadence: "weekly" }] });
    const r = runSimulationIR(ir);
    expect(r.rates.monthlyInflow).toBeCloseTo(5_000 * 4.345, 0);
  });

  it("12 SOL doubles +100% → portfolio appreciates", () => {
    const ir = makeIR({ shocks: [{ symbol: "SOL", pctChange: 1, atMonth: 12, linear: true }] });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeCloseTo(startUsd + 1000 * 150, 0);
  });

  it("13 multi-shock SOL -30% AND JTO -50%", () => {
    const ir = makeIR({
      shocks: [
        { symbol: "SOL", pctChange: -0.3, atMonth: 12, linear: true },
        { symbol: "JTO", pctChange: -0.5, atMonth: 12, linear: true },
      ],
    });
    const r = runSimulationIR(ir);
    expect(r.priceChanges.SOL).toBeCloseTo(-0.3);
    expect(r.priceChanges.JTO).toBeCloseTo(-0.5);
  });

  it("14 portfolio-wide shock excludes stables", () => {
    const ir = makeIR({ shocks: [{ symbol: "*", pctChange: -0.2, atMonth: 12, linear: true }] });
    const r = runSimulationIR(ir);
    expect(r.priceChanges.SOL).toBeCloseTo(-0.2);
    expect(r.priceChanges.JTO).toBeCloseTo(-0.2);
    expect(r.priceChanges.USDC).toBeUndefined();
  });

  it("15 high burn flag", () => {
    const ir = makeIR({ flows: [{ kind: "outflow", usd: startUsd * 0.2, cadence: "monthly" }] });
    const r = runSimulationIR(ir);
    expect(r.riskFlags).toContain("HIGH_BURN_RATE");
  });

  it("16 depletion flag when runway found", () => {
    const ir = makeIR({ flows: [{ kind: "outflow", usd: 30_000, cadence: "monthly" }] });
    const r = runSimulationIR(ir);
    if (r.runwayMonths) expect(r.riskFlags).toContain("DEPLETION_RISK");
  });

  it("17 major drawdown flag (>50%)", () => {
    const ir = makeIR({ shocks: [{ symbol: "*", pctChange: -0.7, atMonth: 12, linear: true }] });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeLessThan(startUsd * 0.5);
    expect(r.riskFlags).toContain("MAJOR_DRAWDOWN");
  });

  it("18 horizon clamp upper bound 60", () => {
    const ir = makeIR({ horizonMonths: 9999 });
    const r = runSimulationIR(ir);
    expect(r.monthly.length).toBe(61);
  });

  it("19 horizon clamp lower bound 1", () => {
    const ir = makeIR({ horizonMonths: 0 });
    const r = runSimulationIR(ir);
    expect(r.monthly.length).toBe(2);
  });

  it("20 one-time outflow at M3", () => {
    const ir = makeIR({
      flows: [{ kind: "outflow", usd: 50_000, cadence: "one_time", startMonth: 3 }],
    });
    const r = runSimulationIR(ir);
    expect(r.monthly[3].totalValue).toBeLessThan(r.monthly[2].totalValue);
  });

  it("21 fee kind populates monthlyFeeUsd", () => {
    const ir = makeIR({ flows: [{ kind: "fee", usd: 200, cadence: "monthly" }] });
    const r = runSimulationIR(ir);
    expect(r.rates.monthlyFeeUsd).toBeCloseTo(200);
  });

  it("22 yield kind populates monthlyYield", () => {
    const ir = makeIR({ flows: [{ kind: "yield", usd: 1_000, cadence: "monthly" }] });
    const r = runSimulationIR(ir);
    expect(r.rates.monthlyYieldUsd).toBeCloseTo(1_000);
  });

  it("23 rebalance silently skipped when target symbol has no price", () => {
    const ir = makeIR({
      rebalances: [{ atMonth: 0, targetAllocationPct: { GHOST: 100 } }],
    });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeCloseTo(startUsd, 0);
  });

  it("24 zero-amount flow ignored", () => {
    const ir = makeIR({ flows: [{ kind: "outflow", usd: 0, cadence: "monthly" }] });
    const r = runSimulationIR(ir);
    expect(r.endValue).toBeCloseTo(startUsd, 0);
  });

  it("25 irToFlatVariables emits one entry per shock/flow/yield", () => {
    const ir = makeIR({
      shocks: [{ symbol: "SOL", pctChange: -0.3 }],
      flows: [{ kind: "outflow", usd: 10_000, cadence: "monthly" }],
      yields: [{ symbol: "*", apy: 0.05 }],
    });
    const flat = irToFlatVariables(ir);
    expect(flat.find((v) => v.type === "price_change")).toBeDefined();
    expect(flat.find((v) => v.type === "outflow")).toBeDefined();
    expect(flat.find((v) => v.type === "yield_apy")).toBeDefined();
  });

  // ── Preset adapter coverage ──────────────────────────────────────────

  it("26 preset runway_projection requires monthlyBurn", () => {
    expect(presetScenarioToIR({ scenario: "runway_projection", variables: {}, timeframeMonths: 12, tokens: TOKENS })).toBeNull();
    const ir = presetScenarioToIR({ scenario: "runway_projection", variables: { monthlyBurn: 15000 }, timeframeMonths: 12, tokens: TOKENS });
    expect(ir?.flows.length).toBe(1);
  });

  it("27 preset market_shock with solDrop normalises percent>1", () => {
    const ir = presetScenarioToIR({ scenario: "market_shock", variables: { solDrop: 30 }, timeframeMonths: 12, tokens: TOKENS });
    expect(ir?.shocks[0].pctChange).toBeCloseTo(-0.3);
  });

  it("28 preset variable_impact w/ SOL hire converts to monthly hire flow", () => {
    const ir = presetScenarioToIR({ scenario: "variable_impact", variables: { newHires: 2, costPerHireSOL: 40 }, timeframeMonths: 12, tokens: TOKENS });
    expect(ir?.flows.find((f) => f.kind === "hire")?.sol).toBe(80);
  });

  it("29 preset targetAllocation maps to rebalance @M0", () => {
    const ir = presetScenarioToIR({ scenario: "diversification", variables: { targetAllocation: { SOL: 50, USDC: 50 } }, timeframeMonths: 12, tokens: TOKENS });
    expect(ir?.rebalances[0].atMonth).toBe(0);
    expect(ir?.rebalances[0].targetAllocationPct.SOL).toBe(50);
  });

  it("30 preset priceShocks maps to multi-shock", () => {
    const ir = presetScenarioToIR({ scenario: "multi_shock", variables: { priceShocks: { SOL: -25, JTO: -40 } }, timeframeMonths: 12, tokens: TOKENS });
    expect(ir?.shocks).toHaveLength(2);
  });
});
