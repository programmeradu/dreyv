"use client";

/**
 * useTreasuryTrend — fetches a real composite USD trend from /api/treasury/trend
 * for the current vault's holdings. Refreshes every 60s.
 *
 * Falls back to a quiet zero-series so the chart still renders a baseline if
 * the user has no holdings or CoinGecko misbehaves.
 */

import { useEffect, useMemo, useState } from "react";
import { useVault } from "@/lib/contexts/VaultContext";

export interface TreasuryTrend {
  series: number[];
  changePct: number | null;
  loading: boolean;
  source: string | null;
}

export function useTreasuryTrend(range: "24h" | "7d" | "30d" = "7d"): TreasuryTrend {
  const { vaultTokens, vaultValue } = useVault();
  const [data, setData] = useState<{ series: number[]; changePct: number | null; source: string | null }>({
    series: [],
    changePct: null,
    source: null,
  });
  const [loading, setLoading] = useState(false);

  // Build a stable basket signature so we only refetch when allocations change.
  const basketKey = useMemo(() => {
    const total = vaultTokens.reduce((s, t) => s + (t.value ?? 0), 0);
    if (total <= 0) return "SOL:1";
    const parts = vaultTokens
      .filter((t) => (t.value ?? 0) > 0 && t.symbol)
      .map((t) => `${(t.symbol as string).toUpperCase()}:${((t.value ?? 0) / total).toFixed(4)}`)
      .sort();
    return parts.join(",") || "SOL:1";
  }, [vaultTokens]);

  useEffect(() => {
    let cancelled = false;
    const symbols = basketKey.split(",").map((p) => p.split(":")[0]).join(",");
    const weights = basketKey.split(",").map((p) => p.split(":")[1]).join(",");
    const totalValue = vaultValue ?? 0;

    const run = async () => {
      setLoading(true);
      try {
        const url = `/api/treasury/trend?symbols=${encodeURIComponent(symbols)}&weights=${encodeURIComponent(
          weights,
        )}&range=${range}&totalValue=${totalValue}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        setData({
          series: Array.isArray(json.series) ? json.series : [],
          changePct: typeof json.changePct === "number" ? json.changePct : null,
          source: json.source ?? null,
        });
      } catch {
        if (!cancelled) setData({ series: [], changePct: null, source: "error" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    const id = window.setInterval(run, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [basketKey, range, vaultValue]);

  return { ...data, loading };
}
