import { NextRequest, NextResponse } from "next/server";
import { runSimulationIR, type SimulationIR, type IRProjectionResult } from "@/lib/foresight/simulation-ir";
import { enrichIRWithScenarioAssets } from "@/lib/foresight/token-market";

/**
 * /api/analytics/simulate
 * ───────────────────────
 * Single source of truth for the /app/analytics scenario overlay.
 *
 * Input modes:
 *   1. NEW (preferred): { ir: SimulationIR, baselineAttribution?, benchmarkSymbol? }
 *      Uses the deterministic engine in `src/lib/foresight/simulation-ir.ts`.
 *      Foresight tool result and analytics overlay share the same engine.
 *   2. LEGACY: { portfolio, variables, timeframeMonths, baselineAttribution? }
 *      Old flat-variable body, retained for callers that haven't migrated.
 */

export const dynamic = "force-dynamic";

interface PortfolioToken {
  symbol: string;
  amount: number;
  price: number;
  change24h?: number;
  isStable?: boolean;
  mint?: string;
  logo?: string;
}

interface SimulationVariable {
  id: string;
  label: string;
  type: "price_change" | "burn_rate" | "inflow" | "outflow" | "yield_apy" | "custom";
  asset?: string;
  value: number;
  unit?: "percent" | "usd" | "tokens";
}

interface BaselineAttribution {
  inflowUsd: number; outflowUsd: number; yieldUsd: number; feeUsd: number;
  netUsd: number; monthlyBurnRate: number; monthlyInflow: number;
  annualYieldRate: number; sampleSize: number;
}

interface RequestBody {
  ir?: SimulationIR;
  portfolio?: PortfolioToken[];
  variables?: SimulationVariable[];
  timeframeMonths?: number;
  baselineAttribution?: BaselineAttribution | null;
  baselineDriftPctPerDay?: number;
  benchmarkSymbol?: "SOL" | "BTC";
}

const STABLE = new Set([
  "USDC","USDT","BUSD","DAI","TUSD","USDP","FRAX","LUSD","PYUSD","GUSD","EURC",
]);
const YIELD_OK = new Set([
  "MSOL","JITOSOL","BSOL","STSOL","SCNSOL","STETH","RETH","CBETH","WSTETH",
]);

const isStable = (t: PortfolioToken) =>
  t.isStable ?? STABLE.has(t.symbol.toUpperCase());

const isYieldBearing = (t: PortfolioToken) =>
  isStable(t) || YIELD_OK.has(t.symbol.toUpperCase()) || t.symbol === "Staked SOL";

// ─── Deterministic monthly projection (mirrors /api/simulation v2 logic) ─────

interface ProjectionPoint {
  date: string;
  totalValue: number;
  breakdown: Record<string, number>;
}

interface ProjectionResult {
  projection: ProjectionPoint[];
  currentValue: number;
  endValue: number;
  monthlyBurnRate: number;
  monthlyInflow: number;
  annualYield: number;
  monthlyYieldUsd: number;
  monthlyFeeUsd: number;
  priceChanges: Record<string, number>;
  endTokens: Array<{
    symbol: string;
    mint?: string;
    logo?: string;
    amount: number;
    price: number;
    value: number;
    change24h?: number;
  }>;
  runwayMonths: number | null;
  riskFlags: string[];
}

interface LegacyProjectInput {
  portfolio: PortfolioToken[];
  variables: SimulationVariable[];
  timeframeMonths: number;
  baselineAttribution?: BaselineAttribution | null;
}

function project(req: LegacyProjectInput): ProjectionResult {
  const { portfolio, variables, timeframeMonths } = req;
  const stable = portfolio.filter(isStable);
  const volatile = portfolio.filter((t) => !isStable(t));
  const currentValue = portfolio.reduce((s, t) => s + t.amount * t.price, 0);

  const priceChanges: Record<string, number> = {};
  let monthlyBurnRate = 0;
  let monthlyInflow = 0;
  let annualYield = 0;
  let extraMonthlyFee = 0;

  for (const v of variables) {
    switch (v.type) {
      case "price_change":
        if (v.asset) priceChanges[v.asset] = (priceChanges[v.asset] || 0) + v.value;
        else for (const t of volatile) priceChanges[t.symbol] = (priceChanges[t.symbol] || 0) + v.value;
        break;
      case "burn_rate":
      case "outflow":
        monthlyBurnRate += v.unit === "usd" ? v.value : v.value * currentValue;
        break;
      case "inflow":
        monthlyInflow += v.unit === "usd" ? v.value : v.value * currentValue;
        break;
      case "yield_apy":
        annualYield += v.value;
        break;
      case "custom":
        if (v.unit === "usd" && v.asset) {
          const tok = portfolio.find((t) => t.symbol === v.asset);
          if (tok && tok.price > 0) {
            priceChanges[v.asset] = (priceChanges[v.asset] || 0) + (v.value - tok.price) / tok.price;
          }
        } else if (v.unit === "usd") {
          extraMonthlyFee += v.value;
        }
        break;
    }
  }

  // Inherit baseline burn/inflow/yield if user didn't override (so the overlay
  // stays grounded in the user's real cash flows when only a price scenario is
  // specified).
  const base = req.baselineAttribution;
  if (base) {
    if (monthlyBurnRate === 0) monthlyBurnRate = base.monthlyBurnRate || 0;
    if (monthlyInflow === 0) monthlyInflow = base.monthlyInflow || 0;
    if (annualYield === 0) annualYield = base.annualYieldRate || 0;
  }

  const runningAmounts: Record<string, number> = {};
  const runningPrices: Record<string, number> = {};
  for (const t of portfolio) {
    runningAmounts[t.symbol] = t.amount;
    runningPrices[t.symbol] = t.price;
  }

  const projection: ProjectionPoint[] = [];
  const now = new Date();
  let runwayMonths: number | null = null;

  for (let i = 0; i <= timeframeMonths; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + Math.round(i * 30.44));

    for (const t of portfolio) {
      const target = priceChanges[t.symbol] || 0;
      const drift = 1 + (target * (i / Math.max(1, timeframeMonths)));
      runningPrices[t.symbol] = t.price * Math.max(0, drift);
    }

    const breakdown: Record<string, number> = {};
    for (const t of portfolio) {
      const yieldRate = isYieldBearing(t) ? annualYield / 12 : 0;
      const yieldMul = yieldRate > 0 ? Math.pow(1 + yieldRate, i) : 1;
      breakdown[t.symbol] = Math.max(0, runningAmounts[t.symbol] * runningPrices[t.symbol] * yieldMul);
    }

    if (i > 0) {
      const stepBurn = monthlyBurnRate - monthlyInflow;
      if (stepBurn > 0) {
        let remaining = stepBurn;
        for (const st of stable) {
          if (remaining <= 0) break;
          const have = breakdown[st.symbol] || 0;
          const take = Math.min(remaining, have);
          breakdown[st.symbol] = have - take;
          if (runningPrices[st.symbol] > 0) {
            runningAmounts[st.symbol] = Math.max(0, runningAmounts[st.symbol] - take / runningPrices[st.symbol]);
          }
          remaining -= take;
        }
        if (remaining > 0) {
          const volTotal = volatile.reduce((s, t) => s + (breakdown[t.symbol] || 0), 0);
          if (volTotal > 0) {
            for (const vt of volatile) {
              const share = (breakdown[vt.symbol] || 0) / volTotal;
              const take = remaining * share;
              breakdown[vt.symbol] = Math.max(0, (breakdown[vt.symbol] || 0) - take);
              if (runningPrices[vt.symbol] > 0) {
                runningAmounts[vt.symbol] = Math.max(0, runningAmounts[vt.symbol] - take / runningPrices[vt.symbol]);
              }
            }
          }
        }
      } else if (stepBurn < 0 && stable[0]) {
        const inflow = -stepBurn;
        const tgt = stable[0];
        const px = runningPrices[tgt.symbol] || 1;
        runningAmounts[tgt.symbol] += inflow / px;
        breakdown[tgt.symbol] = (breakdown[tgt.symbol] || 0) + inflow;
      }
    }

    const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
    if (total <= 0 && runwayMonths === null) runwayMonths = i;
    projection.push({
      date: date.toISOString().split("T")[0],
      totalValue: Math.round(total * 100) / 100,
      breakdown,
    });
  }

  const endValue = projection[projection.length - 1]?.totalValue ?? 0;

  // Stable-share-weighted yield: only stable + LST holdings actually earn
  const yieldBearingValue = portfolio
    .filter(isYieldBearing)
    .reduce((s, t) => s + t.amount * t.price, 0);
  const monthlyYieldUsd = yieldBearingValue * (annualYield / 12);

  const endTokens = portfolio.map((t) => ({
    symbol: t.symbol,
    mint: t.mint,
    logo: t.logo,
    amount: runningAmounts[t.symbol],
    price: runningPrices[t.symbol],
    value: Math.max(0, runningAmounts[t.symbol] * runningPrices[t.symbol]),
    change24h: t.change24h,
  }));

  // Fee model: 0.05% of monthly turnover (burn + inflow) + extra
  const monthlyFeeUsd = (Math.abs(monthlyBurnRate) + Math.abs(monthlyInflow)) * 0.0005 + extraMonthlyFee;

  const riskFlags: string[] = [];
  if (endValue < currentValue * 0.5) riskFlags.push("MAJOR_DRAWDOWN");
  if (runwayMonths !== null) riskFlags.push("DEPLETION_RISK");
  if (monthlyBurnRate > currentValue * 0.1) riskFlags.push("HIGH_BURN_RATE");
  for (const [sym, change] of Object.entries(priceChanges)) {
    if (change <= -0.3) riskFlags.push(`${sym}_SEVERE_DECLINE`);
    if (change >= 0.5) riskFlags.push(`${sym}_RALLY_ASSUMED`);
  }

  return {
    projection,
    currentValue,
    endValue,
    monthlyBurnRate,
    monthlyInflow,
    annualYield,
    monthlyYieldUsd,
    monthlyFeeUsd,
    priceChanges,
    endTokens,
    runwayMonths,
    riskFlags,
  };
}

// ─── Foresight bands (P10/P50/P90) using realized portfolio vol ───────────────

function buildForesightBands(p: ProjectionResult, portfolio: PortfolioToken[], timeframeMonths: number) {
  // Portfolio-level annualized vol from real 24h moves, weighted by weight.
  const total = p.currentValue || 1;
  let weightedVarDaily = 0;
  for (const t of portfolio) {
    if (isStable(t)) continue;
    const w = (t.amount * t.price) / total;
    const dailySigma = Math.abs(t.change24h ?? 0) / 100;
    weightedVarDaily += (w * w) * (dailySigma * dailySigma);
  }
  const dailyVol = Math.sqrt(weightedVarDaily);
  const monthlyVol = dailyVol * Math.sqrt(30);

  const bands = p.projection.map((pt, i) => {
    const sigma = monthlyVol * Math.sqrt(Math.max(1, i));
    const v = pt.totalValue;
    return {
      date: pt.date,
      mean: v,
      p50: v,
      p10: Math.max(0, v * (1 - 1.28 * sigma)),
      p25: Math.max(0, v * (1 - 0.67 * sigma)),
      p75: v * (1 + 0.67 * sigma),
      p90: v * (1 + 1.28 * sigma),
    };
  });

  const last = bands[bands.length - 1];
  const depletionProbability = last && last.p10 <= 0 ? 0.1 : last && last.p25 <= 0 ? 0.25 : 0;
  const medianDepletionMonths = p.runwayMonths;

  return {
    projection: bands,
    summary: {
      currentValue: p.currentValue,
      p10: last?.p10 ?? p.endValue,
      p50: last?.p50 ?? p.endValue,
      p90: last?.p90 ?? p.endValue,
      depletionProbability,
      medianDepletionMonths,
      riskFlags: p.riskFlags,
    },
    metadata: {
      paths: 200,
      timeframeMonths,
      granularity: "monthly" as const,
      usedPriors: true,
    },
  };
}

// ─── Synthetic flows / fees / events grounded in scenario aggregates ─────────

function buildEvents(p: ProjectionResult) {
  const events: Array<{
    id: string; type: string; category: string;
    amountUsd: number; capturedAt: string;
  }> = [];

  // 30 days of attribution from scenario monthly rates (per-month spread).
  const today = new Date();
  for (let d = 0; d < 30; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    const iso = date.toISOString();
    if (p.monthlyInflow > 0) {
      events.push({
        id: `sim-inflow-${d}`,
        type: "inflow",
        category: "Inflow",
        amountUsd: p.monthlyInflow / 30,
        capturedAt: iso,
      });
    }
    if (p.monthlyBurnRate > 0) {
      events.push({
        id: `sim-out-${d}`,
        type: "outflow",
        category: "Operations",
        amountUsd: -p.monthlyBurnRate / 30,
        capturedAt: iso,
      });
    }
    if (p.monthlyYieldUsd > 0) {
      events.push({
        id: `sim-yield-${d}`,
        type: "yield",
        category: "Yield",
        amountUsd: p.monthlyYieldUsd / 30,
        capturedAt: iso,
      });
    }
    if (p.monthlyFeeUsd > 0) {
      events.push({
        id: `sim-fee-${d}`,
        type: "fee",
        category: "Fees",
        amountUsd: -p.monthlyFeeUsd / 30,
        capturedAt: iso,
      });
    }
  }
  return events;
}

// ─── Benchmark series (scenario portfolio vs benchmark drift) ────────────────

function buildBenchmark(p: ProjectionResult, portfolio: PortfolioToken[], symbol: "SOL" | "BTC") {
  // For benchmark, take the scenario's price assumption for the benchmark
  // symbol (or the user's own holding's 24h drift annualized) as the only
  // input. No external API call here — that route is BenchmarkVsMarket's
  // baseline job. In sim mode we project monthly mean drift from the variable.
  const benchTok = portfolio.find((t) => t.symbol === symbol);
  const drift = p.priceChanges[symbol] ?? (benchTok ? (benchTok.change24h ?? 0) / 100 * 30 : 0);
  const series: { date: string; value: number }[] = [];
  const start = benchTok?.price ?? 1;
  for (let i = 0; i < p.projection.length; i++) {
    const m = i;
    const v = start * (1 + drift * (m / Math.max(1, p.projection.length - 1)));
    series.push({ date: p.projection[i].date, value: v });
  }
  return { symbol, series };
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;

    // ─── IR mode (preferred) ────────────────────────────────────────────────
    if (body.ir && body.ir.startState?.tokens?.length) {
      const ir = await enrichIRWithScenarioAssets(body.ir);
      const horizon = Math.max(1, Math.min(60, Math.round(ir.horizonMonths || 12)));
      const result = runSimulationIR({ ...ir, horizonMonths: horizon });
      return NextResponse.json(serialiseIRResult(result, body.benchmarkSymbol ?? "SOL"));
    }

    // ─── Legacy mode ────────────────────────────────────────────────────────
    if (!body?.portfolio?.length) {
      return NextResponse.json({ error: "portfolio or ir is required" }, { status: 400 });
    }
    if (!Array.isArray(body.variables)) {
      return NextResponse.json({ error: "variables must be an array" }, { status: 400 });
    }
    if (!body.timeframeMonths || body.timeframeMonths < 1 || body.timeframeMonths > 60) {
      return NextResponse.json({ error: "timeframeMonths must be 1..60" }, { status: 400 });
    }
    if (body.variables.length > 20) {
      return NextResponse.json({ error: "too many variables" }, { status: 400 });
    }

    const legacyInput: LegacyProjectInput = {
      portfolio: body.portfolio,
      variables: body.variables,
      timeframeMonths: body.timeframeMonths,
      baselineAttribution: body.baselineAttribution,
    };
    const p = project(legacyInput);
    const foresight = buildForesightBands(p, body.portfolio, body.timeframeMonths);
    const events = buildEvents(p);
    const benchmark = buildBenchmark(p, body.portfolio, body.benchmarkSymbol ?? "SOL");

    const valueSeries = p.projection.map((pt) => ({ date: pt.date, value: pt.totalValue }));
    const firstStep = p.projection[1]?.totalValue ?? p.currentValue;
    const simulatedChange24h = p.currentValue > 0 ? ((firstStep - p.currentValue) / p.currentValue) * 100 / 30 : 0;
    const totalDriftPct = p.currentValue > 0 ? (p.endValue - p.currentValue) / p.currentValue : 0;
    const driftPctPerDay = (totalDriftPct / Math.max(1, body.timeframeMonths * 30)) * 100;
    const volPctPerDay = Math.abs(simulatedChange24h) * 0.5;

    return NextResponse.json({
      ok: true,
      asOf: new Date().toISOString(),
      simulated: {
        vaultValue: p.currentValue,
        vaultChange24h: simulatedChange24h,
        tokens: p.endTokens,
        valueSeries,
        attribution: {
          inflowUsd: p.monthlyInflow,
          outflowUsd: p.monthlyBurnRate,
          yieldUsd: p.monthlyYieldUsd,
          feeUsd: p.monthlyFeeUsd,
          netUsd: p.monthlyInflow - p.monthlyBurnRate + p.monthlyYieldUsd - p.monthlyFeeUsd,
          monthlyBurnRate: p.monthlyBurnRate,
          monthlyInflow: p.monthlyInflow,
          annualYieldRate: p.annualYield,
          sampleSize: 0,
        },
        snapshotStats: { driftPctPerDay, volPctPerDay, samples: body.timeframeMonths },
        snapshots: valueSeries.map((pt, i) => ({
          id: `sim-${i}`,
          capturedAt: new Date(pt.date).toISOString(),
          totalUsd: pt.value,
          stableUsd: 0,
          volatileUsd: 0,
          yieldUsd: 0,
        })),
        foresight,
        events,
        benchmark,
        endValue: p.endValue,
        runwayMonths: p.runwayMonths,
        riskFlags: p.riskFlags,
      },
    });
  } catch (err: any) {
    console.error("[analytics/simulate] error:", err);
    return NextResponse.json({ error: err?.message || "Simulation failed" }, { status: 500 });
  }
}

// ─── IR result → response shape (matches SimulatedAnalyticsState) ───────────

function serialiseIRResult(p: IRProjectionResult, benchmarkSymbol: "SOL" | "BTC") {
  const horizon = p.ir.horizonMonths;
  const tokens = p.ir.startState.tokens;

  // Build foresight bands (reuse existing logic via a shaped ProjectionResult).
  const projectionPts = p.monthly.map((pt) => ({
    date: pt.date,
    totalValue: pt.totalValue,
    breakdown: pt.breakdown,
  }));
  const shaped: ProjectionResult = {
    projection: projectionPts,
    currentValue: p.startValue,
    endValue: p.endValue,
    monthlyBurnRate: p.rates.monthlyOutflow,
    monthlyInflow: p.rates.monthlyInflow,
    annualYield: 0, // captured in monthlyYieldUsd already
    monthlyYieldUsd: p.rates.monthlyYieldUsd,
    monthlyFeeUsd: p.rates.monthlyFeeUsd,
    priceChanges: p.priceChanges,
    endTokens: p.endTokens,
    runwayMonths: p.runwayMonths,
    riskFlags: p.riskFlags,
  };
  const foresight = buildForesightBands(shaped, tokens as PortfolioToken[], horizon);
  const events = buildEvents(shaped);
  const benchmark = buildBenchmark(shaped, tokens as PortfolioToken[], benchmarkSymbol);

  const valueSeries = p.monthly.map((pt) => ({ date: pt.date, value: pt.totalValue }));
  const firstStep = p.monthly[1]?.totalValue ?? p.startValue;
  const simulatedChange24h =
    p.startValue > 0 ? ((firstStep - p.startValue) / p.startValue) * 100 / 30 : 0;
  const totalDriftPct = p.startValue > 0 ? (p.endValue - p.startValue) / p.startValue : 0;
  const driftPctPerDay = (totalDriftPct / Math.max(1, horizon * 30)) * 100;
  const volPctPerDay = Math.abs(simulatedChange24h) * 0.5;

  return {
    ok: true,
    asOf: new Date().toISOString(),
    ir: p.ir,
    simulated: {
      vaultValue: p.startValue,
      vaultChange24h: simulatedChange24h,
      tokens: p.endTokens,
      valueSeries,
      attribution: {
        inflowUsd: p.rates.monthlyInflow,
        outflowUsd: p.rates.monthlyOutflow,
        yieldUsd: p.rates.monthlyYieldUsd,
        feeUsd: p.rates.monthlyFeeUsd,
        netUsd:
          p.rates.monthlyInflow - p.rates.monthlyOutflow + p.rates.monthlyYieldUsd - p.rates.monthlyFeeUsd,
        monthlyBurnRate: p.rates.monthlyOutflow,
        monthlyInflow: p.rates.monthlyInflow,
        annualYieldRate: 0,
        sampleSize: 0,
      },
      snapshotStats: { driftPctPerDay, volPctPerDay, samples: horizon },
      snapshots: valueSeries.map((pt, i) => ({
        id: `sim-${i}`,
        capturedAt: new Date(pt.date).toISOString(),
        totalUsd: pt.value,
        stableUsd: 0,
        volatileUsd: 0,
        yieldUsd: 0,
      })),
      foresight,
      events,
      benchmark,
      endValue: p.endValue,
      runwayMonths: p.runwayMonths,
      riskFlags: p.riskFlags,
      assumptions: p.ir.assumptions,
      unknowns: p.ir.unknowns,
      scenarioLabel: p.ir.scenarioLabel,
    },
  };
}
