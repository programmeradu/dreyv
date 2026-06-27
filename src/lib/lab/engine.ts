/**
 * Lab engine — pure functions over LabPosition / price history / yield rates.
 *
 * No I/O here. Inputs come from positions.ts + prices.ts.
 */

import type {
  LabPosition,
  LabRotation,
  LabMissedRotation,
  LabScenario,
  LabStressResult,
  LabPlaybook,
  LabBacktestResult,
} from "./types";
import { YIELD_MINTS, type YieldTokenMeta } from "@/lib/yield-registry";
import { realizedVol } from "./prices";

// ─── tunables ───────────────────────────────────────────────────────
const SWAP_COST_BPS = 30; // 0.30%
const FORESIGHT_HORIZON_DAYS = 90;
const RISK_PENALTY = { low: 0, medium: 0.15, high: 0.40 } as const;

// ─── shared helpers ────────────────────────────────────────────────
function topYieldCandidates(): Array<YieldTokenMeta & { mint: string }> {
  return Object.entries(YIELD_MINTS)
    .map(([mint, m]) => ({ mint, ...m }))
    .sort((a, b) => b.fallbackApy - a.fallbackApy);
}

function liquidityHoursFromAum(aumUsd: number | undefined): number {
  if (!aumUsd) return 24;
  if (aumUsd > 1_000_000_000) return 1;
  if (aumUsd > 100_000_000) return 4;
  if (aumUsd > 25_000_000) return 12;
  return 36;
}

function scoreRotation(
  projectedDeltaUsd: number,
  fromValueUsd: number,
  vol: number,
  riskTier: "low" | "medium" | "high",
): number {
  if (fromValueUsd <= 0) return 0;
  const expectedReturnPct = projectedDeltaUsd / fromValueUsd;
  // Reward expected return, penalize vol and risk tier
  return expectedReturnPct * 100 - vol * 8 - RISK_PENALTY[riskTier] * 5;
}

// ─── FORESIGHT ─────────────────────────────────────────────────────
export function computeForesight(
  positions: LabPosition[],
  liveApys: Record<string, number>,
  histories: Record<string, Array<[number, number]>>,
): LabRotation[] {
  const rotations: LabRotation[] = [];
  const candidates = topYieldCandidates();

  for (const pos of positions) {
    if (pos.valueUsd < 5) continue; // ignore dust
    // Eligible "from" = idle base assets (SOL/USDC/etc) or under-performing LSTs
    const isIdle = pos.category === "IDLE";
    const isWeakLst = pos.category === "YIELD_BEARING" && pos.currentApy < 5.5;
    if (!isIdle && !isWeakLst) continue;

    for (const cand of candidates) {
      if (cand.mint === pos.mint) continue;
      // SOL-denominated LSTs only swap-rotate from SOL; USDC stays USDC family.
      if (pos.symbol === "USDC" || pos.symbol === "USDT") continue;
      const apy = liveApys[cand.mint] ?? cand.fallbackApy;
      if (apy <= pos.currentApy + 0.3) continue; // need meaningful uplift

      const horizonYears = FORESIGHT_HORIZON_DAYS / 365;
      const apyDelta = (apy - pos.currentApy) / 100;
      const grossDelta = pos.valueUsd * apyDelta * horizonYears;
      const swapCost = pos.valueUsd * (SWAP_COST_BPS / 10_000);
      const projectedDeltaUsd = grossDelta - swapCost;
      if (projectedDeltaUsd <= 0) continue;

      const dailyDeltaUsd = (pos.valueUsd * apyDelta) / 365;
      const breakEvenDays = dailyDeltaUsd > 0 ? Math.ceil(swapCost / dailyDeltaUsd) : 9999;
      const vol = realizedVol(histories[cand.mint]);
      const score = scoreRotation(projectedDeltaUsd, pos.valueUsd, vol, cand.riskTier);

      rotations.push({
        from: {
          mint: pos.mint,
          symbol: pos.symbol,
          valueUsd: pos.valueUsd,
          currentApy: pos.currentApy,
        },
        to: {
          mint: cand.mint,
          symbol: cand.symbol,
          protocol: cand.protocol,
          apy,
          riskTier: cand.riskTier,
          aumUsd: cand.aumUsd,
        },
        projectedDeltaUsd,
        breakEvenDays,
        vol,
        score,
        liquidityExitHours: liquidityHoursFromAum(cand.aumUsd),
      });
    }
  }

  return rotations
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ─── HINDSIGHT ─────────────────────────────────────────────────────
/**
 * Computes opportunity cost: "had you been in the best alt at the start of
 * the window, how much more would you have? "
 *
 * Approximation: assume the position size at the start equals the current
 * size (positions API doesn't give us historical balance per-address without
 * indexer). This is conservative for growing portfolios, optimistic for
 * shrinking — and the UI labels it as "if you'd held the same amount."
 */
export function computeHindsight(
  positions: LabPosition[],
  liveApys: Record<string, number>,
  histories: Record<string, Array<[number, number]>>,
  windowDays: 30 | 90 | 365,
): LabMissedRotation[] {
  const rotations = computeForesight(positions, liveApys, histories);
  const yearFrac = windowDays / 365;
  const missed: LabMissedRotation[] = [];

  for (const r of rotations) {
    const fromHistory = histories[r.from.mint];
    const toHistory = histories[r.to.mint];

    // Price-return component (USDC vs SOL vs LST behave differently).
    let priceReturnDelta = 0;
    if (fromHistory && toHistory && fromHistory.length > 0 && toHistory.length > 0) {
      const fromStart = fromHistory[0][1];
      const fromEnd = fromHistory[fromHistory.length - 1][1];
      const toStart = toHistory[0][1];
      const toEnd = toHistory[toHistory.length - 1][1];
      if (fromStart > 0 && toStart > 0) {
        const fromReturn = (fromEnd - fromStart) / fromStart;
        const toReturn = (toEnd - toStart) / toStart;
        priceReturnDelta = r.from.valueUsd * (toReturn - fromReturn);
      }
    }

    // Yield component over the window
    const apyDelta = (r.to.apy - r.from.currentApy) / 100;
    const yieldDelta = r.from.valueUsd * apyDelta * yearFrac;
    const swapCost = r.from.valueUsd * (SWAP_COST_BPS / 10_000);
    const realizedOppCostUsd = priceReturnDelta + yieldDelta - swapCost;

    if (realizedOppCostUsd <= 0) continue;
    missed.push({ ...r, realizedOppCostUsd, windowDays });
  }

  return missed.sort((a, b) => b.realizedOppCostUsd - a.realizedOppCostUsd);
}

// ─── STRESS ────────────────────────────────────────────────────────
export function runStress(positions: LabPosition[], scenario: LabScenario): LabStressResult {
  const perAsset: LabStressResult["perAsset"] = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const p of positions) {
    if (p.valueUsd <= 0) continue;
    totalBefore += p.valueUsd;
    let after = p.valueUsd;

    const symMatch = (sym: string) =>
      scenario.params.asset &&
      (sym.toUpperCase() === scenario.params.asset.toUpperCase() ||
        scenario.params.asset.toUpperCase() === p.mint.toUpperCase());

    switch (scenario.kind) {
      case "sol_crash": {
        // affects SOL + all SOL-denominated LSTs
        const solFamily = ["SOL", "WSOL", "MSOL", "JITOSOL", "BSOL", "Staked SOL"];
        if (solFamily.some((s) => s.toUpperCase() === p.symbol.toUpperCase())) {
          const move = (scenario.params.movePct ?? -40) / 100;
          after = p.valueUsd * (1 + move);
        }
        break;
      }
      case "usdc_depeg": {
        if (p.symbol === "USDC") {
          const depeg = (scenario.params.depegPct ?? -8) / 100;
          after = p.valueUsd * (1 + depeg);
        }
        break;
      }
      case "lst_slashing": {
        if (p.category === "YIELD_BEARING" && p.symbol !== "Staked SOL") {
          const haircut = (scenario.params.slashingPct ?? -5) / 100;
          after = p.valueUsd * (1 + haircut);
        }
        break;
      }
      case "lst_liquidity_drain": {
        if (p.category === "YIELD_BEARING") {
          const haircut = (scenario.params.liquidityHaircutPct ?? -12) / 100;
          after = p.valueUsd * (1 + haircut);
        }
        break;
      }
      case "validator_outage": {
        // Native staking rewards forgone for the window; small mark
        if (p.symbol === "Staked SOL") after = p.valueUsd * 0.998;
        break;
      }
      case "custom": {
        if (symMatch(p.symbol)) {
          const move = (scenario.params.movePct ?? 0) / 100;
          after = p.valueUsd * (1 + move);
        }
        break;
      }
    }

    totalAfter += after;
    perAsset.push({
      mint: p.mint,
      symbol: p.symbol,
      beforeUsd: p.valueUsd,
      afterUsd: after,
      deltaUsd: after - p.valueUsd,
      deltaPct: p.valueUsd > 0 ? (after - p.valueUsd) / p.valueUsd : 0,
    });
  }

  const totalLossUsd = totalAfter - totalBefore;
  const drawdownPct = totalBefore > 0 ? totalLossUsd / totalBefore : 0;
  const worst = perAsset.slice().sort((a, b) => a.deltaUsd - b.deltaUsd)[0];
  const worstAsset =
    worst && totalBefore > 0
      ? { symbol: worst.symbol, lossUsd: worst.deltaUsd, pctOfPortfolio: worst.beforeUsd / totalBefore }
      : undefined;

  // Naive recovery assumption: portfolio drifts +10%/yr post-shock.
  const recoveryDays =
    drawdownPct < 0 ? Math.max(1, Math.ceil((Math.abs(drawdownPct) / 0.10) * 365)) : 0;

  const hardening = buildHardening(positions, scenario, totalBefore, perAsset);

  return {
    scenario,
    totalLossUsd,
    drawdownPct,
    worstAsset,
    recoveryDays,
    perAsset,
    hardening,
  };
}

function buildHardening(
  positions: LabPosition[],
  scenario: LabScenario,
  totalBefore: number,
  perAsset: LabStressResult["perAsset"],
): LabStressResult["hardening"] {
  const out: LabStressResult["hardening"] = [];
  if (totalBefore <= 0) return out;

  // Concentration warning
  const top = positions[0];
  if (top && top.valueUsd / totalBefore > 0.6) {
    out.push({
      id: "concentration",
      severity: "warn",
      title: `Reduce ${top.symbol} concentration`,
      rationale: `${((top.valueUsd / totalBefore) * 100).toFixed(0)}% of portfolio is in ${top.symbol}. Diversifying into low-correlated yield reduces single-asset shock.`,
      cta: { kind: "diversify", into: ["JitoSOL", "USDC", "mSOL"] },
    });
  }

  // USDC depeg: rotate part to USDT or T-bill stable
  if (scenario.kind === "usdc_depeg") {
    const usdc = positions.find((p) => p.symbol === "USDC");
    if (usdc && usdc.valueUsd / totalBefore > 0.2) {
      out.push({
        id: "stable-mix",
        severity: "critical",
        title: "Split stable exposure across USDC + USDT",
        rationale: "Single-issuer stablecoin exposure inherits issuer risk. A 60/40 split caps depeg losses materially.",
        cta: { kind: "diversify", into: ["USDC", "USDT"] },
      });
    }
  }

  // LST liquidity: prefer high-AUM LSTs
  if (scenario.kind === "lst_liquidity_drain") {
    const weakLst = perAsset.find((p) => p.deltaPct < -0.05);
    if (weakLst) {
      out.push({
        id: "rotate-to-jito",
        severity: "warn",
        title: `Rotate ${weakLst.symbol} → JitoSOL`,
        rationale: "JitoSOL has the deepest liquidity across major LSTs, reducing exit slippage during stress.",
      });
    }
  }

  // SOL crash: cold-sweep stable yield
  if (scenario.kind === "sol_crash") {
    out.push({
      id: "cold-sweep",
      severity: "info",
      title: "Sweep idle gains to a cold wallet",
      rationale: "Crash recovery is faster when realized yield is preserved off-chain in a high-trust signer.",
      cta: { kind: "cold_sweep" },
    });
  }

  return out;
}

// ─── PLAYBOOK BACKTEST ─────────────────────────────────────────────
/**
 * Backtests a playbook against the last 365d of real data using a baseline
 * of "hold current portfolio composition." Returns a daily series.
 *
 * Simplification (v1): playbooks resolve to a target allocation; we backtest
 * that allocation vs the baseline allocation using historical prices + a
 * constant-APY yield drip on YIELD_BEARING legs.
 */
export function backtestPlaybook(
  playbook: LabPlaybook,
  positions: LabPosition[],
  histories: Record<string, Array<[number, number]>>,
  liveApys: Record<string, number>,
  windowDays: 365,
): LabBacktestResult {
  const startUsd = positions.reduce((s, p) => s + p.valueUsd, 0);
  const playbookTarget = resolvePlaybookAllocation(playbook);
  const baselineTarget = currentAllocationFromPositions(positions);

  // Build a unified daily timeline using the most complete history we have.
  const refMint =
    Object.keys(histories).find((m) => histories[m]?.length >= 30) ||
    "So11111111111111111111111111111111111111112";
  const refSeries = histories[refMint] || [];
  const days = Math.min(refSeries.length, windowDays);
  const series: LabBacktestResult["series"] = [];

  let playbookCum = startUsd;
  let baselineCum = startUsd;
  let pbPeak = startUsd;
  let pbMaxDD = 0;

  for (let i = 1; i < days; i++) {
    const t = refSeries[i][0];
    const dayReturnPB = portfolioDayReturn(playbookTarget, histories, liveApys, i);
    const dayReturnBL = portfolioDayReturn(baselineTarget, histories, liveApys, i);
    playbookCum *= 1 + dayReturnPB;
    baselineCum *= 1 + dayReturnBL;
    pbPeak = Math.max(pbPeak, playbookCum);
    pbMaxDD = Math.max(pbMaxDD, (pbPeak - playbookCum) / pbPeak);
    series.push({ t, playbook: playbookCum, baseline: baselineCum });
  }

  const deltaUsd = playbookCum - baselineCum;
  const deltaPct = baselineCum > 0 ? deltaUsd / baselineCum : 0;

  return {
    playbookId: playbook.id,
    windowDays,
    startUsd,
    endUsdPlaybook: playbookCum,
    endUsdBaseline: baselineCum,
    deltaUsd,
    deltaPct,
    maxDrawdownPct: pbMaxDD,
    series,
  };
}

function portfolioDayReturn(
  target: Record<string, number>, // mint -> weight (0..1)
  histories: Record<string, Array<[number, number]>>,
  liveApys: Record<string, number>,
  dayIdx: number,
): number {
  let sum = 0;
  for (const [mint, w] of Object.entries(target)) {
    if (w <= 0) continue;
    const h = histories[mint];
    let dayRet = 0;
    if (h && h.length > dayIdx && h[dayIdx - 1]?.[1] > 0) {
      const prev = h[dayIdx - 1][1];
      const cur = h[dayIdx][1];
      dayRet = (cur - prev) / prev;
    }
    // Add yield drip (apy → daily)
    const apy = liveApys[mint] ?? 0;
    dayRet += apy / 100 / 365;
    sum += w * dayRet;
  }
  return sum;
}

function currentAllocationFromPositions(positions: LabPosition[]): Record<string, number> {
  const total = positions.reduce((s, p) => s + p.valueUsd, 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const p of positions) out[p.mint] = p.valueUsd / total;
  return out;
}

function symbolToMint(sym: string): string | null {
  const map: Record<string, string> = {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    BSOL: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  };
  return map[sym.toUpperCase()] ?? null;
}

function resolvePlaybookAllocation(pb: LabPlaybook): Record<string, number> {
  // v1: derive a target allocation from the playbook nodes.
  const out: Record<string, number> = {};
  for (const n of pb.nodes) {
    if (n.type === "deposit") {
      const m = symbolToMint(n.asset);
      if (m) out[m] = (out[m] ?? 0) + n.pctOfPortfolio / 100;
    } else if (n.type === "stake") {
      const m = symbolToMint(n.into);
      if (m) out[m] = (out[m] ?? 0) + 1.0;
    } else if (n.type === "rebalance_quarterly") {
      for (const [sym, w] of Object.entries(n.targets)) {
        const m = symbolToMint(sym);
        if (m) out[m] = (out[m] ?? 0) + w;
      }
    }
  }
  // Normalize
  const tot = Object.values(out).reduce((s, x) => s + x, 0);
  if (tot > 0) for (const k of Object.keys(out)) out[k] = out[k] / tot;
  return out;
}
