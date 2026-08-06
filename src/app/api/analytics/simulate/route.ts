import { NextRequest, NextResponse } from "next/server";
import { runSimulationIR, type SimulationIR, type IRProjectionResult } from "@/lib/foresight/simulation-ir";
import { enrichIRWithScenarioAssets } from "@/lib/foresight/token-market";
import { db } from "@/db";
import { treasurySnapshots } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
export const runtime = "edge";

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

interface PriorStats {
  volPctPerDay?: number; // std of daily fractional returns (e.g. 0.018 = 1.8%/day)
  driftPctPerDay?: number;
  samples?: number;
}

interface RequestBody {
  ir?: SimulationIR;
  portfolio?: PortfolioToken[];
  variables?: SimulationVariable[];
  timeframeMonths?: number;
  baselineAttribution?: BaselineAttribution | null;
  baselineDriftPctPerDay?: number;
  benchmarkSymbol?: "SOL" | "BTC";
  /** Optional priors derived from real treasury_snapshots history. */
  priors?: PriorStats;
  /** When provided (and priors omitted), the route fetches snapshot-derived vol/drift itself. */
  wallet?: string;
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

// Box-Muller standard normal sampler with a deterministic seed so two
// requests with identical inputs return identical bands (audit-friendly).
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const PATHS = 200;

function buildForesightBands(
  p: ProjectionResult,
  portfolio: PortfolioToken[],
  timeframeMonths: number,
  priors?: PriorStats,
) {
  // ─── Portfolio-level daily volatility ────────────────────────────────────
  // Source A — realized vol from treasury_snapshots (preferred when we have
  // enough samples). This is portfolio-level and already captures correlation.
  // Source B — weighted |change24h| across non-stable tokens (one-observation
  // proxy, floored at 1%/day per token). Used as a fallback or blended in
  // when snapshot history is thin.
  const total = p.currentValue || 1;
  let weighted24hVarDaily = 0;
  for (const t of portfolio) {
    if (isStable(t)) continue;
    const w = (t.amount * t.price) / total;
    const dailySigma = Math.max(0.01, Math.abs(t.change24h ?? 0) / 100);
    weighted24hVarDaily += (w * w) * (dailySigma * dailySigma);
  }
  const dailyVol24h = Math.sqrt(weighted24hVarDaily);

  const snapVol = priors?.volPctPerDay && priors.volPctPerDay > 0 ? priors.volPctPerDay : 0;
  const snapSamples = priors?.samples ?? 0;
  // Blend: <5 samples → 24h proxy; 5–19 → linear blend; ≥20 → snapshot-only.
  let dailyVol: number;
  let volSource: "snapshots" | "blended" | "24h";
  if (snapVol > 0 && snapSamples >= 20) {
    dailyVol = snapVol;
    volSource = "snapshots";
  } else if (snapVol > 0 && snapSamples >= 5) {
    const w = (snapSamples - 5) / 15; // 0 → 1 across [5..20]
    dailyVol = w * snapVol + (1 - w) * dailyVol24h;
    volSource = "blended";
  } else {
    dailyVol = dailyVol24h;
    volSource = "24h";
  }
  const monthlyVol = dailyVol * Math.sqrt(30);

  const steps = p.projection.length;
  // Seed: deterministic on (currentValue, endValue, vol, steps) so identical
  // inputs reproduce identical paths — but different scenarios get different
  // sample paths.
  const seed = Math.floor(
    Math.abs(p.currentValue) * 1000 + Math.abs(p.endValue) + monthlyVol * 1e6 + steps,
  );
  const rng = makeRng(seed || 1);

  // Per-step empirical distributions of total portfolio value across PATHS
  // samples. Path = mean trajectory * cumulative log-normal shock.
  const stepValues: number[][] = Array.from({ length: steps }, () => []);
  let depletedPaths = 0;
  const depletionMonthsList: number[] = [];

  for (let path = 0; path < PATHS; path++) {
    let logShock = 0;
    let depleted = false;
    let depletionMonth = -1;
    for (let i = 0; i < steps; i++) {
      const meanV = p.projection[i].totalValue;
      if (i > 0) {
        // GBM-style monthly shock with mean-zero drift on top of the
        // deterministic mean trajectory (which already encodes scenario drift).
        const z = gauss(rng);
        logShock += monthlyVol * z - 0.5 * monthlyVol * monthlyVol;
      }
      const v = Math.max(0, meanV * Math.exp(logShock));
      stepValues[i].push(v);
      if (v <= 0 && !depleted) {
        depleted = true;
        depletionMonth = i;
      }
    }
    if (depleted) {
      depletedPaths += 1;
      depletionMonthsList.push(depletionMonth);
    }
  }

  for (const arr of stepValues) arr.sort((a, b) => a - b);

  const bands = p.projection.map((pt, i) => {
    const s = stepValues[i];
    return {
      date: pt.date,
      mean: pt.totalValue,
      p50: quantile(s, 0.5),
      p10: quantile(s, 0.1),
      p25: quantile(s, 0.25),
      p75: quantile(s, 0.75),
      p90: quantile(s, 0.9),
    };
  });

  const last = bands[bands.length - 1];
  const depletionProbability = depletedPaths / PATHS;
  depletionMonthsList.sort((a, b) => a - b);
  const medianDepletionMonths =
    depletionMonthsList.length > 0
      ? depletionMonthsList[Math.floor(depletionMonthsList.length / 2)]
      : p.runwayMonths;

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
      paths: PATHS,
      timeframeMonths,
      granularity: "monthly" as const,
      monthlyVol,
      dailyVol,
      volSource,
      volSampleSize: snapSamples,
      seed,
      usedPriors: snapVol > 0,
      engine: "monte-carlo-gbm",
    },
  };
}

// ─── Snapshot-derived priors (portfolio-level realized vol/drift) ────────────

async function fetchPriorsForWallet(wallet: string): Promise<PriorStats | undefined> {
  try {
    if (!db) return undefined;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ capturedAt: treasurySnapshots.capturedAt, totalUsd: treasurySnapshots.totalUsd })
      .from(treasurySnapshots)
      .where(and(eq(treasurySnapshots.walletAddress, wallet), gte(treasurySnapshots.capturedAt, since)))
      .orderBy(treasurySnapshots.capturedAt);
    if (rows.length < 2) return { samples: rows.length };
    // Bucket to one observation per UTC day (last snapshot wins) so vol is
    // truly daily regardless of intra-day snapshot cadence.
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.capturedAt as any).toISOString().slice(0, 10);
      byDay.set(d, Number(r.totalUsd));
    }
    const series = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    if (series.length < 2) return { samples: series.length };
    const rets: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      if (prev > 0) rets.push((series[i] - prev) / prev);
    }
    if (!rets.length) return { samples: series.length };
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
    return {
      driftPctPerDay: mean,
      volPctPerDay: Math.sqrt(variance),
      samples: series.length,
    };
  } catch {
    return undefined;
  }
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

    // Resolve priors once (used by both modes for the Monte Carlo bands).
    const priors: PriorStats | undefined =
      body.priors ?? (body.wallet ? await fetchPriorsForWallet(body.wallet) : undefined);

    // ─── IR mode (preferred) ────────────────────────────────────────────────
    if (body.ir && body.ir.startState?.tokens?.length) {
      const ir = await enrichIRWithScenarioAssets(body.ir);
      const horizon = Math.max(1, Math.min(60, Math.round(ir.horizonMonths || 12)));
      const result = runSimulationIR({ ...ir, horizonMonths: horizon });
      return NextResponse.json(serialiseIRResult(result, body.benchmarkSymbol ?? "SOL", priors));
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
    const foresight = buildForesightBands(p, body.portfolio, body.timeframeMonths, priors);
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
        vaultValue: p.endValue,
        startValue: p.currentValue,
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

function serialiseIRResult(p: IRProjectionResult, benchmarkSymbol: "SOL" | "BTC", priors?: PriorStats) {
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
  const foresight = buildForesightBands(shaped, tokens as PortfolioToken[], horizon, priors);
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
      vaultValue: p.endValue,
      startValue: p.startValue,
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
