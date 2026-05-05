/**
 * SimulationIR — Single source of truth for every what-if scenario.
 *
 * Both the Foresight capability (`foresight_simulation` in `intel.ts`) and the
 * Analytics overlay endpoint (`/api/analytics/simulate`) consume IR through
 * the same deterministic engine, so the Foresight card and the full /analytics
 * regeneration cannot drift apart.
 *
 * The IR is produced by either:
 *   - The LLM planner (`/api/foresight/plan`) for free-form questions, or
 *   - A small preset adapter for the legacy named scenarios
 *     (runway_projection, market_shock, variable_impact, yield_forecast).
 *
 * The engine itself is dependency-free so it can run in Node (API routes) and
 * in any future edge runtime without adjustment.
 */

export interface IRToken {
  symbol: string;
  amount: number;
  price: number;
  /** Optional 24h % change carried from live data (used for vol bands). */
  change24h?: number;
  isStable?: boolean;
  mint?: string;
  logo?: string;
}

export interface IRShock {
  /** Token symbol the shock applies to. Use "*" for portfolio-wide shock. */
  symbol: string;
  /** Signed % change as a fraction. -0.3 = drop 30%, +0.5 = rally 50%. */
  pctChange: number;
  /** Month index (0 = today, 1 = end of month 1). Defaults to 1. */
  atMonth?: number;
  /** Spread the shock linearly until horizon (default true) or apply instant. */
  linear?: boolean;
}

export interface IRFlow {
  /** Semantic kind for narration; engine treats inflow/outflow generically. */
  kind: "inflow" | "outflow" | "hire" | "yield" | "fee" | "deposit";
  /** USD value per cadence period. Mutually exclusive with `sol`. */
  usd?: number;
  /** SOL units per cadence period (converted via current SOL price). */
  sol?: number;
  /** Token symbol for non-SOL token flows. */
  symbol?: string;
  cadence: "monthly" | "weekly" | "one_time";
  startMonth?: number;
  endMonth?: number;
  label?: string;
}

export interface IRRebalance {
  atMonth: number;
  /** Target allocation as { SYMBOL: percent }. Percentages may sum to ≠100; engine normalises. */
  targetAllocationPct: Record<string, number>;
  label?: string;
}

export interface IRYield {
  /** Token symbol earning yield. Use "*" for the whole portfolio. */
  symbol: string;
  /** APY as a fraction. 0.08 = 8%. */
  apy: number;
  /** Fraction of the symbol's holding that earns yield (0..1). Default 1. */
  principalPct?: number;
}

export interface SimulationIR {
  horizonMonths: number;
  /** Treasury at t=0. The engine never invents a starting balance. */
  startState: { tokens: IRToken[]; usd: number };
  shocks: IRShock[];
  flows: IRFlow[];
  rebalances: IRRebalance[];
  yields: IRYield[];
  /** Things the planner inferred (default APY, average burn, etc). */
  assumptions: string[];
  /** Things the planner could not determine. Non-empty → caller should clarify. */
  unknowns: string[];
  /** Free-form one-line description for narration & telemetry. */
  scenarioLabel?: string;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface IRProjectionPoint {
  month: number;
  date: string;
  totalValue: number;
  breakdown: Record<string, number>;
}

export interface IRProjectionResult {
  ir: SimulationIR;
  startValue: number;
  endValue: number;
  monthly: IRProjectionPoint[];
  endTokens: Array<{
    symbol: string;
    mint?: string;
    logo?: string;
    amount: number;
    price: number;
    value: number;
    change24h?: number;
  }>;
  /** Aggregate per-month rates (USD/mo) — used for fees/flows narration. */
  rates: {
    monthlyInflow: number;
    monthlyOutflow: number;
    monthlyYieldUsd: number;
    monthlyFeeUsd: number;
  };
  priceChanges: Record<string, number>;
  runwayMonths: number | null;
  riskFlags: string[];
}

const STABLE = new Set([
  "USDC","USDT","BUSD","DAI","TUSD","USDP","FRAX","LUSD","PYUSD","GUSD","EURC",
]);

function isStable(t: { symbol: string; isStable?: boolean }): boolean {
  return t.isStable ?? STABLE.has(t.symbol.toUpperCase());
}

function normaliseAllocation(alloc: Record<string, number>): Record<string, number> {
  const sum = Object.values(alloc).reduce((a, b) => a + (Number(b) || 0), 0);
  if (sum <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(alloc)) {
    out[k.toUpperCase()] = (Number(v) || 0) / sum;
  }
  return out;
}

/** Run an IR through the deterministic engine. Pure function. */
export function runSimulationIR(ir: SimulationIR): IRProjectionResult {
  const horizon = Math.max(1, Math.min(60, Math.round(ir.horizonMonths || 12)));
  const tokens = ir.startState.tokens.map((t) => ({ ...t, symbol: t.symbol.toUpperCase() }));
  const startValue = tokens.reduce((s, t) => s + (t.amount || 0) * (t.price || 0), 0);

  const solPrice = tokens.find((t) => t.symbol === "SOL" || t.symbol === "WSOL")?.price ?? 0;

  // Per-symbol target final % price drift over horizon.
  const priceDriftBySym: Record<string, number> = {};
  for (const sh of ir.shocks) {
    const sym = sh.symbol.toUpperCase();
    if (sym === "*") {
      for (const t of tokens) {
        if (isStable(t)) continue;
        priceDriftBySym[t.symbol] = (priceDriftBySym[t.symbol] || 0) + sh.pctChange;
      }
    } else {
      priceDriftBySym[sym] = (priceDriftBySym[sym] || 0) + sh.pctChange;
    }
  }

  // Convert flows to monthly USD aggregates.
  let monthlyInflow = 0;
  let monthlyOutflow = 0;
  let monthlyYieldHint = 0;
  let monthlyFee = 0;
  const oneTimeAtMonth: Array<{ month: number; signedUsd: number; symbol?: string }> = [];

  for (const f of ir.flows) {
    const usd =
      typeof f.usd === "number"
        ? f.usd
        : typeof f.sol === "number"
        ? f.sol * solPrice
        : 0;
    if (!Number.isFinite(usd) || usd === 0) continue;

    const signed =
      f.kind === "inflow" || f.kind === "yield" || f.kind === "deposit"
        ? Math.abs(usd)
        : -Math.abs(usd);

    if (f.cadence === "one_time") {
      oneTimeAtMonth.push({ month: f.startMonth ?? 1, signedUsd: signed, symbol: f.symbol });
      continue;
    }
    const perMonth = f.cadence === "weekly" ? Math.abs(usd) * 4.345 : Math.abs(usd);
    if (signed > 0) {
      if (f.kind === "yield") monthlyYieldHint += perMonth;
      else monthlyInflow += perMonth;
    } else {
      if (f.kind === "fee") monthlyFee += perMonth;
      else monthlyOutflow += perMonth;
    }
  }

  // Per-symbol APY map. "*" applies to all yield-bearing holdings.
  const apyBySym: Record<string, number> = {};
  for (const y of ir.yields) {
    const sym = y.symbol.toUpperCase();
    apyBySym[sym] = (apyBySym[sym] || 0) + y.apy * (y.principalPct ?? 1);
  }

  // Rebalances applied at month boundary.
  const rebalances = [...ir.rebalances]
    .map((r) => ({ ...r, targetAllocationPct: normaliseAllocation(r.targetAllocationPct) }))
    .sort((a, b) => a.atMonth - b.atMonth);

  const runningAmount: Record<string, number> = {};
  const runningPrice: Record<string, number> = {};
  for (const t of tokens) {
    runningAmount[t.symbol] = t.amount;
    runningPrice[t.symbol] = t.price;
  }

  const monthly: IRProjectionPoint[] = [];
  const now = new Date();
  let runwayMonths: number | null = null;

  for (let i = 0; i <= horizon; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + Math.round(i * 30.44));

    // Apply linear price drift up to month i.
    for (const t of tokens) {
      const target = priceDriftBySym[t.symbol] || 0;
      const factor = 1 + target * (i / horizon);
      runningPrice[t.symbol] = Math.max(0, t.price * factor);
    }

    // Apply rebalances scheduled at <= i (idempotent within the loop).
    for (const r of rebalances) {
      if (r.atMonth > i) continue;
      // Compute current portfolio value at running prices.
      const totalNow = tokens.reduce(
        (s, t) => s + (runningAmount[t.symbol] || 0) * (runningPrice[t.symbol] || 0),
        0,
      );
      if (totalNow <= 0) continue;
      const targetsArePriced = Object.keys(r.targetAllocationPct).every((sym) => (runningPrice[sym] || 0) > 0);
      if (!targetsArePriced) continue;
      for (const t of tokens) {
        if (!(t.symbol in r.targetAllocationPct)) runningAmount[t.symbol] = 0;
      }
      for (const sym of Object.keys(r.targetAllocationPct)) {
        const targetUsd = totalNow * r.targetAllocationPct[sym];
        const px = runningPrice[sym] || 0;
        // If we have no price for the target symbol, skip silently — engine
        // never invents prices.
        if (px <= 0) continue;
        runningAmount[sym] = targetUsd / px;
      }
      // A rebalance target is the simulated post-trade portfolio: assets not
      // named in the allocation are sold down instead of leaking into totals.
      // Mark rebalance as applied by bumping its month past horizon.
      r.atMonth = horizon + 1;
    }

    // Apply yields per month (compounded).
    if (i > 0) {
      for (const t of tokens) {
        const apy = apyBySym[t.symbol] ?? apyBySym["*"] ?? 0;
        if (apy <= 0) continue;
        const monthly = apy / 12;
        runningAmount[t.symbol] = (runningAmount[t.symbol] || 0) * (1 + monthly);
      }
    }

    // Apply one-time flows for this month BEFORE recurring net.
    for (const ot of oneTimeAtMonth) {
      if (ot.month !== i) continue;
      applyDeltaUSD(ot.signedUsd, tokens, runningAmount, runningPrice, ot.symbol);
    }

    // Apply recurring net inflow/outflow per month (skip i=0).
    if (i > 0) {
      const stepNet = monthlyInflow + monthlyYieldHint - monthlyOutflow - monthlyFee;
      if (stepNet !== 0) {
        applyDeltaUSD(stepNet, tokens, runningAmount, runningPrice);
      }
    }

    const breakdown: Record<string, number> = {};
    for (const t of tokens) {
      breakdown[t.symbol] = Math.max(
        0,
        (runningAmount[t.symbol] || 0) * (runningPrice[t.symbol] || 0),
      );
    }
    const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
    if (total <= 0 && runwayMonths === null && i > 0) runwayMonths = i;

    monthly.push({
      month: i,
      date: date.toISOString().split("T")[0],
      totalValue: Math.round(total * 100) / 100,
      breakdown,
    });
  }

  const endValue = monthly[monthly.length - 1]?.totalValue ?? startValue;

  // Compute realised yield USD per month from the apy map against weighted holdings.
  const monthlyYieldUsd =
    monthlyYieldHint > 0
      ? monthlyYieldHint
      : tokens.reduce((s, t) => {
          const apy = apyBySym[t.symbol] ?? apyBySym["*"] ?? 0;
          if (apy <= 0) return s;
          return s + (t.amount || 0) * (t.price || 0) * (apy / 12);
        }, 0);

  // Default fee model: 5 bps of recurring turnover (only when the planner
  // didn't already supply explicit fee flows).
  const monthlyFeeUsd =
    monthlyFee > 0 ? monthlyFee : (monthlyInflow + monthlyOutflow) * 0.0005;

  const endTokens = tokens.map((t) => ({
    symbol: t.symbol,
    mint: t.mint,
    logo: t.logo,
    amount: runningAmount[t.symbol] || 0,
    price: runningPrice[t.symbol] || 0,
    value: Math.max(0, (runningAmount[t.symbol] || 0) * (runningPrice[t.symbol] || 0)),
    change24h: t.change24h,
  }));

  const riskFlags: string[] = [];
  if (endValue < startValue * 0.5) riskFlags.push("MAJOR_DRAWDOWN");
  if (runwayMonths !== null) riskFlags.push("DEPLETION_RISK");
  if (monthlyOutflow > startValue * 0.1) riskFlags.push("HIGH_BURN_RATE");
  for (const [sym, change] of Object.entries(priceDriftBySym)) {
    if (change <= -0.3) riskFlags.push(`${sym}_SEVERE_DECLINE`);
    if (change >= 0.5) riskFlags.push(`${sym}_RALLY_ASSUMED`);
  }

  return {
    ir,
    startValue,
    endValue,
    monthly,
    endTokens,
    rates: {
      monthlyInflow,
      monthlyOutflow,
      monthlyYieldUsd,
      monthlyFeeUsd,
    },
    priceChanges: priceDriftBySym,
    runwayMonths,
    riskFlags,
  };
}

/**
 * Apply a signed USD delta to the portfolio. Positive → adds to first stable
 * (or to `symbol` if specified). Negative → drains stables first then volatiles
 * proportionally. Engine never goes below zero.
 */
function applyDeltaUSD(
  signedUsd: number,
  tokensTpl: IRToken[],
  amount: Record<string, number>,
  price: Record<string, number>,
  preferSymbol?: string,
) {
  if (signedUsd === 0) return;
  if (signedUsd > 0) {
    const target =
      (preferSymbol && tokensTpl.find((t) => t.symbol === preferSymbol.toUpperCase())) ||
      tokensTpl.find(isStable) ||
      tokensTpl[0];
    if (!target) return;
    const px = price[target.symbol] || 0;
    if (px <= 0) return;
    amount[target.symbol] = (amount[target.symbol] || 0) + signedUsd / px;
    return;
  }
  let remaining = -signedUsd;
  const stables = tokensTpl.filter(isStable);
  for (const st of stables) {
    if (remaining <= 0) break;
    const px = price[st.symbol] || 0;
    if (px <= 0) continue;
    const haveUsd = (amount[st.symbol] || 0) * px;
    const take = Math.min(remaining, haveUsd);
    amount[st.symbol] = Math.max(0, (amount[st.symbol] || 0) - take / px);
    remaining -= take;
  }
  if (remaining <= 0) return;
  const volatiles = tokensTpl.filter((t) => !isStable(t));
  const totalVolUsd = volatiles.reduce(
    (s, t) => s + (amount[t.symbol] || 0) * (price[t.symbol] || 0),
    0,
  );
  if (totalVolUsd <= 0) return;
  for (const v of volatiles) {
    const px = price[v.symbol] || 0;
    if (px <= 0) continue;
    const haveUsd = (amount[v.symbol] || 0) * px;
    const share = haveUsd / totalVolUsd;
    const take = remaining * share;
    amount[v.symbol] = Math.max(0, (amount[v.symbol] || 0) - take / px);
  }
}

// ─── Preset adapters: legacy named scenarios → IR ────────────────────────────

export interface PresetInput {
  scenario: string;
  variables: Record<string, unknown>;
  timeframeMonths: number;
  tokens: IRToken[];
}

export function presetScenarioToIR(input: PresetInput): SimulationIR | null {
  const { scenario, variables, timeframeMonths, tokens } = input;
  const usd = tokens.reduce((s, t) => s + t.amount * t.price, 0);
  const startState = { tokens, usd };
  const horizon = timeframeMonths || 12;
  const sym = (s: string) => s.toUpperCase();

  if (scenario === "runway_projection") {
    const monthlyBurn = Number(variables.monthlyBurn);
    if (!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) return null;
    return {
      horizonMonths: horizon,
      startState,
      shocks: [],
      flows: [{ kind: "outflow", usd: monthlyBurn, cadence: "monthly", label: "Monthly burn" }],
      rebalances: [],
      yields: [],
      assumptions: [],
      unknowns: [],
      scenarioLabel: `Runway @ $${monthlyBurn.toLocaleString()}/mo burn`,
    };
  }

  if (scenario === "market_shock") {
    const rawSol = Number(variables.solDrop ?? 0);
    const solDrop = rawSol > 1 ? rawSol / 100 : rawSol;
    const rawDe = Number(variables.usdcDepeg ?? 0);
    const depeg = rawDe > 1 ? rawDe / 100 : rawDe;
    const monthlyBurn = Number(variables.monthlyBurn) || 0;
    const shocks: IRShock[] = [];
    if (solDrop) shocks.push({ symbol: "SOL", pctChange: -solDrop, atMonth: horizon, linear: true });
    if (depeg) shocks.push({ symbol: "USDC", pctChange: -depeg, atMonth: horizon, linear: true });
    return {
      horizonMonths: horizon,
      startState,
      shocks,
      flows: monthlyBurn > 0 ? [{ kind: "outflow", usd: monthlyBurn, cadence: "monthly" }] : [],
      rebalances: [],
      yields: [],
      assumptions: monthlyBurn === 0 ? ["No monthly burn supplied"] : [],
      unknowns: [],
      scenarioLabel: `Market shock: SOL ${solDrop ? `-${(solDrop * 100).toFixed(0)}%` : "flat"}${depeg ? `, USDC -${(depeg * 100).toFixed(1)}%` : ""}`,
    };
  }

  if (scenario === "yield_forecast") {
    const apy = Number(variables.apy);
    if (!Number.isFinite(apy) || apy <= 0) return null;
    return {
      horizonMonths: horizon,
      startState,
      shocks: [],
      flows: [],
      rebalances: [],
      yields: [{ symbol: "*", apy, principalPct: 1 }],
      assumptions: [],
      unknowns: [],
      scenarioLabel: `Yield @ ${(apy * 100).toFixed(1)}% APY`,
    };
  }

  if (scenario === "variable_impact") {
    const newHires = Number(variables.newHires) || 0;
    const costSOL = Number(variables.costPerHireSOL) || 0;
    const costUSD = Number(variables.costPerHire) || 0;
    const monthlyBurn = Number(variables.monthlyBurn) || 0;
    const depositSOL = Number(variables.depositSOL) || 0;
    const depositUSD = Number(variables.depositUSD) || 0;
    const flows: IRFlow[] = [];
    if (monthlyBurn > 0) flows.push({ kind: "outflow", usd: monthlyBurn, cadence: "monthly", label: "Existing burn" });
    if (newHires > 0) {
      if (costSOL > 0) flows.push({ kind: "hire", sol: costSOL * newHires, cadence: "monthly", label: `${newHires} hire(s)` });
      else if (costUSD > 0) flows.push({ kind: "hire", usd: costUSD * newHires, cadence: "monthly", label: `${newHires} hire(s)` });
    }
    if (depositSOL > 0) flows.push({ kind: "deposit", sol: depositSOL, cadence: "one_time", startMonth: 0, label: "SOL deposit" });
    if (depositUSD > 0) flows.push({ kind: "deposit", usd: depositUSD, cadence: "one_time", startMonth: 0, label: "USD deposit" });
    if (flows.length === 0) return null;
    return {
      horizonMonths: horizon,
      startState,
      shocks: [],
      flows,
      rebalances: [],
      yields: [],
      assumptions: monthlyBurn === 0 && newHires > 0 ? ["No existing burn supplied; modelling new hires only"] : [],
      unknowns: [],
      scenarioLabel: `Variable impact: ${newHires} hire(s), $${monthlyBurn.toLocaleString()}/mo`,
    };
  }

  // Free-form scenarios with structured shapes
  const ta = (variables.targetAllocation || variables.allocation || variables.targets) as
    | Record<string, number>
    | undefined;
  if (ta && typeof ta === "object") {
    return {
      horizonMonths: horizon,
      startState,
      shocks: [],
      flows: [],
      rebalances: [{ atMonth: 0, targetAllocationPct: ta, label: "User-defined rebalance" }],
      yields: [],
      assumptions: [],
      unknowns: [],
      scenarioLabel: `Diversification → ${Object.entries(ta).map(([k, v]) => `${Math.round(Number(v))}% ${sym(k)}`).join(" / ")}`,
    };
  }

  const ps = variables.priceShocks as Record<string, number> | undefined;
  if (ps && typeof ps === "object") {
    return {
      horizonMonths: horizon,
      startState,
      shocks: Object.entries(ps).map(([s, p]) => ({
        symbol: s,
        pctChange: Math.abs(p) > 1 ? p / 100 : p,
        atMonth: horizon,
        linear: true,
      })),
      flows: [],
      rebalances: [],
      yields: [],
      assumptions: [],
      unknowns: [],
      scenarioLabel: "Multi-asset shock",
    };
  }

  return null;
}

/** Convert SimulationIR → flat SimulationVariable[] used by /api/analytics/simulate legacy contract. */
export interface FlatSimVariable {
  id: string;
  label: string;
  type: "price_change" | "burn_rate" | "inflow" | "outflow" | "yield_apy" | "custom";
  asset?: string;
  value: number;
  unit: "percent" | "usd" | "tokens";
}

export function irToFlatVariables(ir: SimulationIR): FlatSimVariable[] {
  const out: FlatSimVariable[] = [];
  for (const sh of ir.shocks) {
    out.push({
      id: `shock-${sh.symbol}`,
      label: `${sh.symbol} price ${sh.pctChange >= 0 ? "+" : ""}${(sh.pctChange * 100).toFixed(1)}%`,
      type: "price_change",
      asset: sh.symbol,
      value: sh.pctChange,
      unit: "percent",
    });
  }
  for (const f of ir.flows) {
    const usd =
      typeof f.usd === "number"
        ? f.usd
        : typeof f.sol === "number"
        ? f.sol * (ir.startState.tokens.find((t) => t.symbol.toUpperCase() === "SOL")?.price ?? 0)
        : 0;
    if (usd === 0) continue;
    const monthlyUsd = f.cadence === "weekly" ? usd * 4.345 : usd;
    if (f.kind === "inflow" || f.kind === "deposit" || f.kind === "yield") {
      out.push({ id: `flow-${out.length}`, label: f.label || f.kind, type: "inflow", value: monthlyUsd, unit: "usd" });
    } else {
      out.push({ id: `flow-${out.length}`, label: f.label || f.kind, type: "outflow", value: monthlyUsd, unit: "usd" });
    }
  }
  for (const y of ir.yields) {
    out.push({ id: `yield-${y.symbol}`, label: `Yield ${y.symbol} ${(y.apy * 100).toFixed(1)}% APY`, type: "yield_apy", value: y.apy, unit: "percent", asset: y.symbol === "*" ? undefined : y.symbol });
  }
  return out;
}
