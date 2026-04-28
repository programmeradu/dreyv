"use client";

/**
 * useForesightFoundation — Phase 14 hook that ties together the three
 * foundation primitives feeding /app/analytics:
 *
 *   1. /api/treasury/snapshots  → real treasury value history (chart series
 *      replacing the synthetic sin-wave) plus realized drift/vol priors.
 *   2. /api/treasury/events     → USD attribution (inflow/outflow/yield/fee)
 *      and burn/inflow/yield priors fed back into the simulator.
 *   3. /api/foresight/simulate  → Monte Carlo bands (P10/P50/P90) for the
 *      current vault, optionally with what-if variables.
 *
 * Also auto-writes a snapshot row whenever the visible vault value drifts
 * by more than 0.5% (and at least 5 minutes have passed) so the chart
 * accumulates real data even before the Inngest cron is wired up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVault } from "@/lib/contexts/VaultContext";

interface SnapshotRow {
  id: string;
  capturedAt: string;
  totalUsd: string | number;
  stableUsd: string | number;
  volatileUsd: string | number;
  yieldUsd: string | number;
}
interface SnapshotsResponse {
  ok: boolean;
  snapshots: SnapshotRow[];
  stats: { driftPctPerDay: number; volPctPerDay: number; samples: number };
}
interface EventsResponse {
  ok: boolean;
  events: any[];
  aggregates: {
    inflowUsd: number;
    outflowUsd: number;
    yieldUsd: number;
    feeUsd: number;
    netUsd: number;
    monthlyBurnRate: number;
    monthlyInflow: number;
    annualYieldRate: number;
    sampleSize: number;
  };
}
interface ProjectionPoint {
  date: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}
interface ForesightResponse {
  projection: ProjectionPoint[];
  summary: {
    currentValue: number;
    p10: number;
    p50: number;
    p90: number;
    depletionProbability: number;
    medianDepletionMonths: number | null;
    riskFlags: string[];
  };
  metadata: {
    paths: number;
    timeframeMonths: number;
    granularity: string;
    usedPriors: boolean;
  };
}

const STABLES = new Set([
  "USDC","USDT","DAI","USDP","TUSD","FRAX","BUSD","PYUSD","LUSD","EURC",
]);

export function useForesightFoundation(opts?: {
  range?: "7d" | "30d" | "90d" | "all";
  timeframeMonths?: number;
  paths?: number;
}) {
  const range = opts?.range ?? "30d";
  const timeframeMonths = opts?.timeframeMonths ?? 12;
  const paths = opts?.paths ?? 200;

  const { activeVault, vaultValue, vaultTokens } = useVault();

  const [snapshots, setSnapshots] = useState<SnapshotsResponse | null>(null);
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [foresight, setForesight] = useState<ForesightResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const lastSnapshotValueRef = useRef<number | null>(null);
  const lastSnapshotAtRef = useRef<number>(0);

  // ── Fetch snapshots + events ────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!activeVault) return;
    setLoading(true);
    try {
      const [snapsRes, evtsRes] = await Promise.all([
        fetch(`/api/treasury/snapshots?wallet=${encodeURIComponent(activeVault)}&range=${range}`, { cache: "no-store" }),
        fetch(`/api/treasury/events?wallet=${encodeURIComponent(activeVault)}&range=${range}`, { cache: "no-store" }),
      ]);
      const snaps: SnapshotsResponse = await snapsRes.json().catch(() => ({ ok: false, snapshots: [], stats: { driftPctPerDay: 0, volPctPerDay: 0, samples: 0 } }));
      const evts: EventsResponse = await evtsRes.json().catch(() => ({ ok: false, events: [], aggregates: { inflowUsd: 0, outflowUsd: 0, yieldUsd: 0, feeUsd: 0, netUsd: 0, monthlyBurnRate: 0, monthlyInflow: 0, annualYieldRate: 0, sampleSize: 0 } }));
      setSnapshots(snaps);
      setEvents(evts);
    } finally {
      setLoading(false);
    }
  }, [activeVault, range]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Auto-write snapshot when vault value drifts ─────────────────────
  useEffect(() => {
    if (!activeVault || typeof vaultValue !== "number" || vaultValue <= 0) return;
    const last = lastSnapshotValueRef.current;
    const lastAt = lastSnapshotAtRef.current;
    const driftPct = last ? Math.abs((vaultValue - last) / last) : 1;
    const elapsed = Date.now() - lastAt;
    if (last && driftPct < 0.005 && elapsed < 5 * 60_000) return;

    const composition = (vaultTokens ?? []).map((t: any) => ({
      symbol: t.symbol,
      amount: t.amount ?? 0,
      priceUsd: t.price ?? 0,
      valueUsd: t.value ?? 0,
      isStable: STABLES.has(String(t.symbol ?? "").toUpperCase()),
    }));

    const ctrl = new AbortController();
    fetch("/api/treasury/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ wallet: activeVault, totalUsd: vaultValue, composition }),
    }).then(() => {
      lastSnapshotValueRef.current = vaultValue;
      lastSnapshotAtRef.current = Date.now();
    }).catch(() => { /* ignore */ });
    return () => ctrl.abort();
  }, [activeVault, vaultValue, vaultTokens]);

  // ── Derived: chart series ───────────────────────────────────────────
  const valueSeries = useMemo(() => {
    if (!snapshots?.snapshots?.length) return [] as { date: string; value: number }[];
    return snapshots.snapshots.map((s) => ({
      date: s.capturedAt,
      value: Number(s.totalUsd),
    }));
  }, [snapshots]);

  // ── Run Monte Carlo (baseline or with what-ifs) ─────────────────────
  const runForesight = useCallback(async (variables: any[] = []) => {
    if (!activeVault || !vaultTokens?.length) return null;
    const portfolio = vaultTokens
      .filter((t: any) => (t.amount ?? 0) > 0 && (t.price ?? 0) > 0)
      .map((t: any) => ({
        symbol: t.symbol,
        amount: t.amount,
        price: t.price,
        change24h: t.change24h ?? 0,
        isStable: STABLES.has(String(t.symbol ?? "").toUpperCase()),
        mint: t.mint,
      }));
    if (!portfolio.length) return null;

    setLoading(true);
    try {
      const res = await fetch("/api/foresight/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio,
          variables,
          timeframeMonths,
          granularity: "monthly",
          paths,
          priors: snapshots?.stats
            ? {
                driftPctPerDay: snapshots.stats.driftPctPerDay,
                volPctPerDay: snapshots.stats.volPctPerDay,
              }
            : undefined,
        }),
      });
      const json = (await res.json()) as ForesightResponse;
      setForesight(json);
      return json;
    } finally {
      setLoading(false);
    }
  }, [activeVault, vaultTokens, timeframeMonths, paths, snapshots]);

  // ── Auto-run a baseline projection once snapshots arrive ────────────
  useEffect(() => {
    if (!foresight && snapshots && vaultTokens?.length) runForesight([]).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, vaultTokens]);

  return {
    snapshots,
    events,
    foresight,
    valueSeries,
    loading,
    refresh,
    runForesight,
  };
}
