"use client";

/**
 * SimulatedAnalyticsContext
 * ─────────────────────────
 * When the user runs a what-if/foresight prompt from the CommandBar, the
 * simulation store flips `active=true` and stores parsed variables. This hook
 * watches that store + the live vault, calls /api/analytics/simulate (the
 * single endpoint that recomputes EVERY analytics card under the scenario),
 * and exposes a `SimulatedAnalyticsState` consumed by the page.
 *
 * The page passes simulated values into the same components used for the live
 * baseline — no separate "scenario" components — so nothing on the page is
 * static when a sim is active. Exit reverts to live in one click.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useVault } from "@/lib/contexts/VaultContext";

const STABLE = new Set([
  "USDC","USDT","DAI","BUSD","TUSD","USDP","FRAX","PYUSD","EURC",
]);

export interface SimAttribution {
  inflowUsd: number; outflowUsd: number; yieldUsd: number; feeUsd: number;
  netUsd: number; monthlyBurnRate: number; monthlyInflow: number;
  annualYieldRate: number; sampleSize: number;
}

export interface SimSnapshotRow {
  id: string; capturedAt: string;
  totalUsd: number; stableUsd: number; volatileUsd: number; yieldUsd: number;
}

export interface SimForesightSummary {
  currentValue: number; p10: number; p50: number; p90: number;
  depletionProbability: number; medianDepletionMonths: number | null;
  riskFlags: string[];
}

export interface SimulatedAnalyticsState {
  vaultValue: number;
  vaultChange24h: number;
  tokens: any[];
  valueSeries: { date: string; value: number }[];
  attribution: SimAttribution;
  snapshotStats: { driftPctPerDay: number; volPctPerDay: number; samples: number };
  snapshots: SimSnapshotRow[];
  foresight: {
    projection: Array<{ date: string; p10: number; p25: number; p50: number; p75: number; p90: number; mean: number }>;
    summary: SimForesightSummary;
    metadata: any;
  };
  events: Array<{ id: string; type: string; category: string; amountUsd: number; capturedAt: string }>;
  benchmark: { symbol: string; series: { date: string; value: number }[] };
  endValue: number;
  runwayMonths: number | null;
  riskFlags: string[];
  asOf: string;
}

interface ContextValue {
  /** True only when a sim is active AND data has resolved. */
  active: boolean;
  /** True while the request is in flight. */
  loading: boolean;
  error: string | null;
  state: SimulatedAnalyticsState | null;
  /** Exit simulation overlay → revert page to live data. */
  exit: () => void;
}

const Ctx = createContext<ContextValue>({
  active: false, loading: false, error: null, state: null, exit: () => {},
});

export function SimulatedAnalyticsProvider({
  children,
  baselineAttribution,
  baselineDriftPctPerDay,
}: {
  children: ReactNode;
  baselineAttribution: SimAttribution | null;
  baselineDriftPctPerDay?: number;
}) {
  const { vaultTokens } = useVault();
  const active = useSimulationStore((s) => s.active);
  const variables = useSimulationStore((s) => s.variables);
  const ir = useSimulationStore((s) => s.ir);
  const timeframeMonths = useSimulationStore((s) => s.timeframeMonths);
  const setError = useSimulationStore((s) => s.setError);
  const clear = useSimulationStore((s) => s.clearSimulation);

  const [state, setState] = useState<SimulatedAnalyticsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setLocalError] = useState<string | null>(null);
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!active) {
      setState(null);
      setLocalError(null);
      lastKey.current = "";
      return;
    }
    const tokens = (vaultTokens ?? []).filter((t: any) => (t?.amount ?? 0) > 0 && (t?.price ?? 0) > 0);
    if (!tokens.length) {
      setLocalError("Connect a wallet to simulate against your treasury.");
      setError("Connect a wallet to simulate against your treasury.");
      return;
    }

    const portfolio = tokens.map((t: any) => ({
      symbol: String(t.symbol ?? "SPL").toUpperCase(),
      amount: Number(t.amount ?? 0),
      price: Number(t.price ?? 0),
      change24h: Number(t.change24h ?? 0),
      isStable: STABLE.has(String(t.symbol ?? "").toUpperCase()),
      mint: t.mint,
      logo: t.logo ?? t.logoURI,
    }));

    const key = JSON.stringify({ ir: ir ? { h: ir.horizonMonths, s: ir.shocks, f: ir.flows, r: ir.rebalances, y: ir.yields } : null, variables, timeframeMonths, n: portfolio.length, v: portfolio.map((p) => p.symbol + p.amount.toFixed(4)) });
    if (key === lastKey.current) return;
    lastKey.current = key;

    const ctrl = new AbortController();
    setLoading(true);
    setLocalError(null);
    (async () => {
      try {
        const res = await fetch("/api/analytics/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify(
            ir
              ? { ir: { ...ir, startState: { tokens: portfolio, usd: portfolio.reduce((s, t) => s + t.amount * t.price, 0) } }, baselineAttribution, baselineDriftPctPerDay, benchmarkSymbol: "SOL" }
              : { portfolio, variables, timeframeMonths, baselineAttribution, baselineDriftPctPerDay, benchmarkSymbol: "SOL" },
          ),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Simulation failed (${res.status})`);
        }
        const json = await res.json();
        setState({ ...json.simulated, asOf: json.asOf });
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setLocalError(err?.message || "Simulation failed");
        setError(err?.message || "Simulation failed");
      } finally {
        setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [active, ir, variables, timeframeMonths, vaultTokens, baselineAttribution, baselineDriftPctPerDay, setError]);

  const value = useMemo<ContextValue>(
    () => ({
      active: active && !!state,
      loading: active && loading,
      error,
      state,
      exit: () => {
        clear();
        setState(null);
        setLocalError(null);
      },
    }),
    [active, loading, error, state, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSimulatedAnalytics() {
  return useContext(Ctx);
}
