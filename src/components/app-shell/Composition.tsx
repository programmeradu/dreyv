"use client";

/**
 * Treasury composition + 7-day shape — the user-facing answer to
 * "what do I own and how is it moving?". No tables, no addresses,
 * no chrome — just shape, share, and a soft trend line.
 */

import { motion } from "framer-motion";
import { Surface, StreamingNumber } from "./primitives";

export interface Holding {
  symbol: string;
  label: string;
  share: number; // 0..1
  value: number;
}

export function CompositionStrip({ holdings }: { holdings: Holding[] }) {
  const total = holdings.reduce((s, h) => s + h.value, 0) || 1;
  return (
    <Surface className="p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-manrope text-lg font-semibold text-slate-900">Composition</h3>
        <span className="text-xs text-slate-500">Live shape of your treasury</span>
      </div>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-violet-50 ring-1 ring-violet-100">
        {holdings.map((h, i) => {
          const pct = (h.value / total) * 100;
          const tones = ["bg-violet-600", "bg-violet-400", "bg-violet-300", "bg-violet-200", "bg-violet-100"];
          return (
            <motion.div
              key={h.symbol}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.9, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className={`${tones[i % tones.length]} h-full`}
            />
          );
        })}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
        {holdings.map((h, i) => {
          const tones = ["bg-violet-600", "bg-violet-400", "bg-violet-300", "bg-violet-200", "bg-violet-100"];
          return (
            <div key={h.symbol} className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${tones[i % tones.length]}`} />
              <div className="flex flex-1 items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{h.label}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {((h.value / total) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

export function TrendCurve({
  values,
  label = "Last 7 days",
  changePct,
}: {
  values: number[];
  label?: string;
  changePct?: number | null;
}) {
  const w = 600;
  const h = 160;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 16) - 8}`)
    .join(" ");
  const area = `M0,${h} L${points} L${w},${h} Z`;
  const line = `M${points}`;
  const positive = (changePct ?? 0) >= 0;

  return (
    <Surface className="p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-manrope text-lg font-semibold text-slate-900">{label}</h3>
        {typeof changePct === "number" && (
          <span
            className={`text-xs font-semibold ${positive ? "text-emerald-600" : "text-rose-600"}`}
          >
            {positive ? "+" : ""}
            {changePct.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="mt-4">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full">
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={area}
            fill="url(#trendFill)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="#7c3aed"
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
      </div>
    </Surface>
  );
}

export function HeadlineValue({
  label,
  value,
  prefix = "$",
  decimals = 2,
  hint,
}: {
  label: string;
  value: number | null;
  prefix?: string;
  decimals?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
        {label}
      </p>
      <div className="font-manrope text-5xl font-semibold tracking-tight text-slate-900 md:text-6xl">
        <StreamingNumber value={value} prefix={prefix} decimals={decimals} />
      </div>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
