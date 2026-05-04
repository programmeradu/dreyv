"use client";

/**
 * BenchmarkVsMarket (compact) — treasury % change vs SOL/BTC over the snapshot
 * window. Mini dual-line with zero baseline; flat surface, fixed height.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CompactCard, EmptyMicro } from "./CompactCard";
import { SignalBadge } from "./SignalBadge";

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
    const w = 320, h = 80, padX = 4, padY = 6;
    const norm = (pts: Point[]) => {
      const base = pts[0].value || 1;
      return pts.map((p) => ({ t: new Date(p.date).getTime(), n: (p.value / base - 1) * 100 }));
    };
    const t = norm(valueSeries);
    const m = marketSeries && marketSeries.length >= 2 ? norm(marketSeries) : null;
    const allN = m ? [...t.map((p) => p.n), ...m.map((p) => p.n), 0] : [...t.map((p) => p.n), 0];
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
    return {
      w, h,
      treasuryPath: path(t),
      marketPath: m ? path(m) : null,
      treasuryEnd: t[t.length - 1].n,
      marketEnd: m ? m[m.length - 1].n : null,
      zeroY: y(0),
    };
  }, [valueSeries, marketSeries]);

  if (!chart) {
    return (
      <CompactCard
        eyebrow={`Benchmark · vs ${benchmark}`}
        headline="—"
        subline="Need ≥ 2 snapshots to benchmark."
      >
        <EmptyMicro label="Accumulating snapshots" />
      </CompactCard>
    );
  }

  const { treasuryEnd: tEnd, marketEnd: mEnd } = chart;
  const delta = mEnd != null ? tEnd - mEnd : null;
  const severity = delta == null ? 0.3 : delta >= 1 ? 0.1 : delta <= -1 ? 0.7 : 0.35;
  const label = loading ? "Loading" : delta == null ? "Treasury only" : delta >= 1 ? `Beating ${benchmark}` : delta <= -1 ? `Trailing ${benchmark}` : `Tracking ${benchmark}`;

  return (
    <CompactCard
      eyebrow={`Benchmark · vs ${benchmark}`}
      badge={<SignalBadge severity={severity} label={label} />}
      headline={`${tEnd >= 0 ? "+" : ""}${tEnd.toFixed(2)}%`}
      subline={mEnd != null ? `vs ${mEnd >= 0 ? "+" : ""}${mEnd.toFixed(2)}% ${benchmark}` : "Treasury-only line"}
    >
      <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="h-full w-full" preserveAspectRatio="none">
        <line x1={0} y1={chart.zeroY} x2={chart.w} y2={chart.zeroY} stroke="#ede9fe" strokeDasharray="3 3" strokeWidth="1" />
        {chart.marketPath && (
          <motion.path
            d={chart.marketPath}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.4"
            strokeDasharray="3 3"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
        <motion.path
          d={chart.treasuryPath}
          fill="none"
          stroke="#7c3aed"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
    </CompactCard>
  );
}
