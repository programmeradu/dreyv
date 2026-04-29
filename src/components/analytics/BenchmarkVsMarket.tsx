"use client";

/**
 * BenchmarkVsMarket — flat comparison of treasury value series vs SOL/BTC over the
 * snapshot window. Uses CoinGecko range endpoint (publishable, no key needed for
 * demo IDs) and falls back gracefully to a treasury-only line if the upstream
 * market call fails.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Surface, Pill, StreamIn } from "@/components/app-shell/primitives";

interface Point { date: string; value: number }
interface Props { valueSeries: Point[]; benchmark?: "SOL" | "BTC" }

export function BenchmarkVsMarket({ valueSeries, benchmark = "SOL" }: Props) {
  const [marketSeries, setMarketSeries] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!valueSeries || valueSeries.length < 2) return;
    const start = new Date(valueSeries[0].date).getTime();
    const end = new Date(valueSeries[valueSeries.length - 1].date).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const ctrl = new AbortController();
    setLoading(true);
    const id = benchmark === "BTC" ? "bitcoin" : "solana";
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(start / 1000)}&to=${Math.floor(end / 1000)}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.prices) { setMarketSeries(null); return; }
        const pts: Point[] = j.prices.map((p: [number, number]) => ({
          date: new Date(p[0]).toISOString(),
          value: p[1],
        }));
        setMarketSeries(pts);
      })
      .catch(() => setMarketSeries(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [valueSeries, benchmark]);

  const chart = useMemo(() => {
    if (!valueSeries || valueSeries.length < 2) return null;
    const w = 600, h = 160, padX = 6, padY = 8;
    // Normalize each series to its first value (% change)
    const norm = (pts: Point[]) => {
      const base = pts[0].value || 1;
      return pts.map((p) => ({ t: new Date(p.date).getTime(), n: (p.value / base - 1) * 100 }));
    };
    const t = norm(valueSeries);
    const m = marketSeries && marketSeries.length >= 2 ? norm(marketSeries) : null;
    const allN = m ? [...t.map((p) => p.n), ...m.map((p) => p.n)] : t.map((p) => p.n);
    const minY = Math.min(...allN);
    const maxY = Math.max(...allN);
    const range = maxY - minY || 1;
    const tMin = t[0].t;
    const tMax = t[t.length - 1].t;
    const tRange = tMax - tMin || 1;
    const x = (ts: number) => padX + ((ts - tMin) / tRange) * (w - 2 * padX);
    const y = (v: number) => padY + (1 - (v - minY) / range) * (h - 2 * padY);
    const path = (pts: { t: number; n: number }[]) =>
      "M " + pts.map((p) => `${x(p.t)},${y(p.n)}`).join(" L ");
    const zeroY = y(0);
    return {
      w, h,
      treasuryPath: path(t),
      marketPath: m ? path(m) : null,
      treasuryEnd: t[t.length - 1].n,
      marketEnd: m ? m[m.length - 1].n : null,
      zeroY,
    };
  }, [valueSeries, marketSeries]);

  if (!chart) {
    return (
      <Surface className="p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Benchmark · vs {benchmark}</p>
        <p className="mt-3 text-sm text-slate-400">
          Need at least 2 snapshots to benchmark.
        </p>
      </Surface>
    );
  }

  const tEnd = chart.treasuryEnd;
  const mEnd = chart.marketEnd;
  const verdict = mEnd != null
    ? (tEnd - mEnd >= 1 ? { label: `Beating ${benchmark}`, tone: "emerald" as const }
      : tEnd - mEnd <= -1 ? { label: `Trailing ${benchmark}`, tone: "rose" as const }
      : { label: `Tracking ${benchmark}`, tone: "violet" as const })
    : { label: "Treasury only", tone: "slate" as const };

  return (
    <Surface className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Benchmark · vs {benchmark}</p>
          <h3 className="mt-1 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
            {tEnd >= 0 ? "+" : ""}{tEnd.toFixed(2)}%
            {mEnd != null && (
              <span className="ml-3 text-base font-medium text-slate-400">
                vs {mEnd >= 0 ? "+" : ""}{mEnd.toFixed(2)}% {benchmark}
              </span>
            )}
          </h3>
        </div>
        <Pill tone={verdict.tone}>{loading ? "Loading…" : verdict.label}</Pill>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
        <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="h-40 w-full">
          <line x1={0} y1={chart.zeroY} x2={chart.w} y2={chart.zeroY} stroke="rgb(196 181 253)" strokeDasharray="3 3" strokeWidth="1" />
          {chart.marketPath && (
            <motion.path
              d={chart.marketPath}
              fill="none"
              stroke="rgb(148 163 184)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <motion.path
            d={chart.treasuryPath}
            fill="none"
            stroke="rgb(124 58 237)"
            strokeWidth="2.2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
      </div>
    </Surface>
  );
}
