export const runtime = "edge";
/**
 * /api/foresight/simulate
 *
 * Monte Carlo wrapper around the deterministic projection engine in
 * /api/simulation. We run N stochastic paths (default 200) using a
 * Box-Muller normal noise per step, then return percentile bands
 * (P10/P50/P90) plus the original deterministic median trace.
 *
 * Realized drift/vol can be supplied via `priors` (typically pulled by the
 * client from /api/treasury/snapshots stats), which lets the simulation
 * anchor on the user's actual treasury behavior instead of pure 24h proxy.
 *
 * Phase 14 — foresight foundation.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface PortfolioToken {
  symbol: string;
  amount: number;
  price: number;
  change24h?: number;
  isStable?: boolean;
  mint?: string;
}

interface SimVariable {
  id: string;
  label: string;
  type: "price_change" | "burn_rate" | "inflow" | "outflow" | "yield_apy" | "custom";
  asset?: string;
  value: number;
  unit?: "percent" | "usd" | "tokens";
}

interface ForesightRequest {
  portfolio: PortfolioToken[];
  variables: SimVariable[];
  timeframeMonths: number;
  granularity?: "weekly" | "monthly";
  paths?: number;        // number of Monte Carlo paths, default 200
  seed?: number;         // optional seed for reproducible draws
  priors?: {             // realized drift / vol from treasury_snapshots
    driftPctPerDay?: number;
    volPctPerDay?: number;
  };
}

const STABLES = new Set([
  "USDC","USDT","BUSD","DAI","TUSD","USDP","FRAX","LUSD","PYUSD","GUSD","USDD","CUSD","SUSD","UST","EURC",
]);
const isStable = (t: PortfolioToken) =>
  t.isStable ?? STABLES.has((t.symbol || "").toUpperCase());

// ─── PRNG (Mulberry32) ────────────────────────────────────────────────
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number) {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Single stochastic projection path ────────────────────────────────
interface PathResult {
  totals: number[];   // length = totalPoints + 1
  depleted: number | null;  // step index of depletion or null
}

function runPath(req: ForesightRequest, rng: () => number): PathResult {
  const { portfolio, variables, timeframeMonths, granularity = "monthly", priors } = req;
  const pointsPerMonth = granularity === "weekly" ? 4 : 1;
  const totalPoints = timeframeMonths * pointsPerMonth;
  const stepMonths = 1 / pointsPerMonth;
  const stepDays = stepMonths * 30.44;

  // Parse variables into deltas
  const priceTargets: Record<string, number> = {};
  let monthlyBurn = 0, monthlyInflow = 0, annualYield = 0;
  const currentValue = portfolio.reduce((s, t) => s + t.amount * t.price, 0);

  for (const v of variables) {
    switch (v.type) {
      case "price_change":
        if (v.asset) priceTargets[v.asset.toUpperCase()] = (priceTargets[v.asset.toUpperCase()] || 0) + v.value;
        else for (const t of portfolio) if (!isStable(t)) {
          priceTargets[t.symbol.toUpperCase()] = (priceTargets[t.symbol.toUpperCase()] || 0) + v.value;
        }
        break;
      case "burn_rate":
      case "outflow":
        monthlyBurn += v.unit === "usd" ? v.value : v.value * currentValue;
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
            priceTargets[v.asset.toUpperCase()] =
              (priceTargets[v.asset.toUpperCase()] || 0) + (v.value - tok.price) / tok.price;
          }
        } else if (v.unit === "usd") monthlyBurn -= v.value;
        break;
    }
  }

  // Per-asset volatility — prefer prior if provided, else 24h proxy.
  const priorVolDaily = priors?.volPctPerDay ?? null;
  const vols: Record<string, number> = {};
  for (const t of portfolio) {
    if (isStable(t)) { vols[t.symbol] = 0; continue; }
    const proxyDaily = Math.abs(t.change24h ?? 0) / 100;
    const daily = priorVolDaily != null ? priorVolDaily : proxyDaily;
    vols[t.symbol] = Math.min(daily, 0.5); // cap at 50% daily
  }

  // Running state
  const amounts: Record<string, number> = {};
  const prices: Record<string, number> = {};
  for (const t of portfolio) { amounts[t.symbol] = t.amount; prices[t.symbol] = t.price; }

  const totals: number[] = [];
  let depleted: number | null = null;

  for (let i = 0; i <= totalPoints; i++) {
    // Update prices: drift toward target + gaussian shock scaled by sqrt(dt)
    for (const t of portfolio) {
      if (isStable(t)) continue;
      const sym = t.symbol;
      const target = priceTargets[sym.toUpperCase()] || 0;
      // linear drift toward target across full horizon
      const driftStep = target / totalPoints;
      const shock = gaussian(rng) * vols[sym] * Math.sqrt(stepDays);
      prices[sym] = Math.max(0, prices[sym] * (1 + driftStep + shock));
    }

    // Yield (compounded on yield-bearing tokens — stables + LSTs)
    const yieldStep = annualYield * stepMonths / 12;

    // Compute breakdown
    const breakdown: Record<string, number> = {};
    let pre = 0;
    for (const t of portfolio) {
      const yb = isStable(t) || /^(MSOL|JITOSOL|BSOL|STSOL|STETH|RETH|CBETH|WSTETH)$/i.test(t.symbol);
      const mult = yb && yieldStep > 0 ? Math.pow(1 + yieldStep, i) : 1;
      const v = amounts[t.symbol] * prices[t.symbol] * mult;
      breakdown[t.symbol] = Math.max(0, v);
      pre += breakdown[t.symbol];
    }

    // Apply burn (after step 0). Stables first, then volatile pro-rata.
    if (i > 0) {
      const stepBurn = (monthlyBurn - monthlyInflow) * stepMonths;
      if (stepBurn > 0) {
        let remain = stepBurn;
        for (const t of portfolio.filter(isStable)) {
          if (remain <= 0) break;
          const avail = breakdown[t.symbol] || 0;
          const take = Math.min(remain, avail);
          breakdown[t.symbol] = avail - take;
          if (prices[t.symbol] > 0) amounts[t.symbol] = Math.max(0, amounts[t.symbol] - take / prices[t.symbol]);
          remain -= take;
        }
        if (remain > 0) {
          const vols2 = portfolio.filter((t) => !isStable(t));
          const volTotal = vols2.reduce((s, t) => s + (breakdown[t.symbol] || 0), 0);
          if (volTotal > 0) for (const t of vols2) {
            const share = (breakdown[t.symbol] || 0) / volTotal;
            const take = remain * share;
            breakdown[t.symbol] = Math.max(0, (breakdown[t.symbol] || 0) - take);
            if (prices[t.symbol] > 0) amounts[t.symbol] = Math.max(0, amounts[t.symbol] - take / prices[t.symbol]);
          }
        }
      } else if (stepBurn < 0) {
        // net inflow → first stable
        const stable = portfolio.find(isStable) ?? portfolio[0];
        if (stable) {
          const p = prices[stable.symbol] || 1;
          amounts[stable.symbol] += Math.abs(stepBurn) / p;
          breakdown[stable.symbol] = (breakdown[stable.symbol] || 0) + Math.abs(stepBurn);
        }
      }
    }

    const total = Math.max(0, Object.values(breakdown).reduce((s, v) => s + v, 0));
    totals.push(total);
    if (depleted === null && total <= 0) depleted = i;
  }

  return { totals, depleted };
}

// ─── Aggregate paths into percentile bands ────────────────────────────
function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

export async function POST(req: NextRequest) {
  let body: ForesightRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Filter null / non-object entries so malformed agent input doesn't crash the simulator.
  if (Array.isArray(body.portfolio)) {
    body.portfolio = body.portfolio.filter(
      (t): t is PortfolioToken => t != null && typeof t === "object" && typeof (t as PortfolioToken).symbol === "string",
    );
  }
  if (Array.isArray(body.variables)) {
    body.variables = body.variables.filter((v) => v != null && typeof v === "object");
  }
  if (!body.portfolio?.length) return NextResponse.json({ error: "portfolio_required" }, { status: 400 });
  if (!Array.isArray(body.variables) || body.variables.length === 0) {
    return NextResponse.json({ error: "variables_required" }, { status: 400 });
  }
  if (!body.timeframeMonths || body.timeframeMonths < 1 || body.timeframeMonths > 120) {
    return NextResponse.json({ error: "timeframeMonths_1_to_120" }, { status: 400 });
  }
  const paths = Math.min(Math.max(body.paths ?? 200, 20), 500);
  const seed = (body.seed ?? Date.now()) >>> 0;

  const granularity = body.granularity ?? "monthly";
  const totalPoints = body.timeframeMonths * (granularity === "weekly" ? 4 : 1);

  // Collect per-step samples across all paths
  const buckets: number[][] = Array.from({ length: totalPoints + 1 }, () => []);
  let depletedCount = 0;
  const depletionSteps: number[] = [];

  for (let p = 0; p < paths; p++) {
    const rng = mulberry32(seed + p * 9973);
    const res = runPath(body, rng);
    for (let i = 0; i < res.totals.length; i++) buckets[i].push(res.totals[i]);
    if (res.depleted !== null) { depletedCount++; depletionSteps.push(res.depleted); }
  }

  const stepMonths = granularity === "weekly" ? 0.25 : 1;
  const now = new Date();
  const projection = buckets.map((bucket, i) => {
    const sorted = [...bucket].sort((a, b) => a - b);
    const date = new Date(now); date.setDate(date.getDate() + Math.round(i * stepMonths * 30.44));
    return {
      date: date.toISOString().split("T")[0],
      p10: Math.round(percentile(sorted, 0.10) * 100) / 100,
      p50: Math.round(percentile(sorted, 0.50) * 100) / 100,
      p90: Math.round(percentile(sorted, 0.90) * 100) / 100,
      mean: Math.round((bucket.reduce((s, v) => s + v, 0) / bucket.length) * 100) / 100,
    };
  });

  const currentValue = body.portfolio.reduce((s, t) => s + t.amount * t.price, 0);
  const endP50 = projection[projection.length - 1]?.p50 ?? currentValue;
  const endP10 = projection[projection.length - 1]?.p10 ?? currentValue;
  const endP90 = projection[projection.length - 1]?.p90 ?? currentValue;

  const depletionProb = paths > 0 ? depletedCount / paths : 0;
  const medianDepletionMonths = depletionSteps.length
    ? (depletionSteps.sort((a, b) => a - b)[Math.floor(depletionSteps.length / 2)] * stepMonths)
    : null;

  const riskFlags: string[] = [];
  if (depletionProb > 0.5) riskFlags.push("HIGH_DEPLETION_PROBABILITY");
  else if (depletionProb > 0.2) riskFlags.push("ELEVATED_DEPLETION_PROBABILITY");
  if (endP10 < currentValue * 0.5) riskFlags.push("WIDE_DOWNSIDE_BAND");
  if (endP90 - endP10 > currentValue * 0.8) riskFlags.push("HIGH_UNCERTAINTY");

  return NextResponse.json({
    projection,
    summary: {
      currentValue: Math.round(currentValue * 100) / 100,
      p10: endP10,
      p50: endP50,
      p90: endP90,
      depletionProbability: Math.round(depletionProb * 1000) / 1000,
      medianDepletionMonths: medianDepletionMonths != null ? Math.round(medianDepletionMonths * 10) / 10 : null,
      riskFlags,
    },
    metadata: {
      paths,
      seed,
      timeframeMonths: body.timeframeMonths,
      granularity,
      computedAt: Date.now(),
      usedPriors: !!(body.priors?.driftPctPerDay || body.priors?.volPctPerDay),
    },
  });
}
