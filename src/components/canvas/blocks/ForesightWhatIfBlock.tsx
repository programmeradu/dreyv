"use client";

/**
 * ForesightWhatIfBlock — interactive Monte Carlo what-if surface for the
 * /app/treasury canvas. Wires user-tunable variables (burn / inflow /
 * yield APY / SOL price shock) into useForesightFoundation.runForesight()
 * and renders the resulting P10/P50/P90 bands + streaming LLM narrative.
 *
 * Phase 14b — bridges the foresight foundation into the treasury canvas.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Play, RotateCcw } from "lucide-react";
import { BlockShell } from "@/components/canvas/BlockShell";
import { Pill, StreamingNumber } from "@/components/app-shell/primitives";
import { useForesightFoundation } from "@/lib/hooks/useForesightFoundation";
import type { CanvasBlock } from "@/lib/canvas/types";

interface SimVariable {
  id: string;
  label: string;
  type: "burn_rate" | "inflow" | "yield_apy" | "price_change";
  asset?: string;
  value: number;
  unit: "percent" | "usd";
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

const DEFAULT_VARS: SimVariable[] = [
  { id: "burn", label: "Monthly burn", type: "burn_rate", value: 0, unit: "usd" },
  { id: "inflow", label: "Monthly inflow", type: "inflow", value: 0, unit: "usd" },
  { id: "yield", label: "Yield APY on stables", type: "yield_apy", value: 0, unit: "percent" },
  { id: "sol", label: "SOL price shock", type: "price_change", asset: "SOL", value: 0, unit: "percent" },
];

export function ForesightWhatIfBlock({ block }: { block: CanvasBlock }) {
  const timeframeMonths = (typeof block.payload.timeframeMonths === "number" ? block.payload.timeframeMonths : 12) as number;
  const { foresight, events, runForesight, loading } = useForesightFoundation({ timeframeMonths });
  const [vars, setVars] = useState<SimVariable[]>(DEFAULT_VARS);
  const [running, setRunning] = useState(false);

  // Hydrate inflow/burn defaults from real attribution once available
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    if (!events?.aggregates) return;
    const a = events.aggregates;
    setVars((prev) => prev.map((v) => {
      if (v.id === "burn" && v.value === 0 && a.monthlyBurnRate) return { ...v, value: Math.round(a.monthlyBurnRate) };
      if (v.id === "inflow" && v.value === 0 && a.monthlyInflow) return { ...v, value: Math.round(a.monthlyInflow) };
      if (v.id === "yield" && v.value === 0 && a.annualYieldRate) return { ...v, value: Math.round(a.annualYieldRate * 100) / 100 };
      return v;
    }));
    hydrated.current = true;
  }, [events]);

  const projection = foresight?.projection ?? [];
  const summary = foresight?.summary ?? null;

  const chart = useMemo(() => {
    if (!projection.length) return null;
    const w = 600, h = 140, padX = 6, padY = 6;
    const minY = Math.min(...projection.map((p) => p.p10));
    const maxY = Math.max(...projection.map((p) => p.p90));
    const range = maxY - minY || 1;
    const x = (i: number) => padX + (i / (projection.length - 1)) * (w - 2 * padX);
    const y = (v: number) => padY + (1 - (v - minY) / range) * (h - 2 * padY);
    const bandPath =
      "M " + projection.map((p, i) => `${x(i)},${y(p.p90)}`).join(" L ") +
      " L " + projection.slice().reverse().map((p, i) => `${x(projection.length - 1 - i)},${y(p.p10)}`).join(" L ") + " Z";
    const medianPath = "M " + projection.map((p, i) => `${x(i)},${y(p.p50)}`).join(" L ");
    return { w, h, bandPath, medianPath };
  }, [projection]);

  const onRun = async () => {
    setRunning(true);
    try { await runForesight(vars.filter((v) => v.value !== 0)); }
    finally { setRunning(false); }
  };
  const onReset = () => setVars(DEFAULT_VARS.map((v) => ({ ...v })));

  const depletionPct = summary ? Math.round(summary.depletionProbability * 100) : null;
  const depletionTone: "rose" | "violet" | "emerald" =
    depletionPct == null ? "violet" : depletionPct >= 50 ? "rose" : depletionPct >= 20 ? "violet" : "emerald";

  return (
    <BlockShell block={block} accent="violet">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-violet-700">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">What-if · {timeframeMonths}-mo Monte Carlo</span>
          </div>
          {summary && (
            <div className="flex items-center gap-1.5">
              <Pill tone={depletionTone}>{depletionPct}% depletion risk</Pill>
              {summary.medianDepletionMonths != null && (
                <Pill tone="rose">~{summary.medianDepletionMonths} mo runway</Pill>
              )}
            </div>
          )}
        </div>

        {/* Variables */}
        <div className="grid gap-3 sm:grid-cols-2">
          {vars.map((v, i) => (
            <VariableSlider
              key={v.id}
              variable={v}
              onChange={(next) => setVars((prev) => prev.map((p, j) => j === i ? next : p))}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRun}
            disabled={running || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            {running || loading ? "Simulating…" : "Run scenario"}
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        {/* Bands */}
        {chart ? (
          <div className="overflow-hidden rounded-xl border border-violet-100 bg-violet-50/40 p-3">
            <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="h-32 w-full">
              <path d={chart.bandPath} fill="rgb(124 58 237 / 0.18)" />
              <path d={chart.medianPath} stroke="rgb(124 58 237)" strokeWidth="2" fill="none" />
            </svg>
            {summary && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <BandStat label="Worst 10%" value={summary.p10} tone="rose" />
                <BandStat label="Median" value={summary.p50} tone="violet" stream />
                <BandStat label="Best 10%" value={summary.p90} tone="emerald" />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-4 text-center text-xs text-slate-500">
            {loading ? "Running 200 projections…" : "Tweak a variable and run a scenario to see foresight bands."}
          </div>
        )}

        {summary?.riskFlags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {summary.riskFlags.map((f) => (
              <Pill key={f} tone="rose">{f.replace(/_/g, " ").toLowerCase()}</Pill>
            ))}
          </div>
        ) : null}
      </div>
    </BlockShell>
  );
}

function BandStat({ label, value, tone, stream }: { label: string; value: number; tone: "rose" | "violet" | "emerald"; stream?: boolean }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-violet-700";
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-manrope text-sm font-semibold ${color}`}>
        {stream ? <StreamingNumber value={value} prefix="$" decimals={0} /> : fmtCompact(value)}
      </div>
    </div>
  );
}

function VariableSlider({ variable, onChange }: { variable: SimVariable; onChange: (v: SimVariable) => void }) {
  const range = sliderRange(variable);
  const display = variable.unit === "usd" ? fmtCompact(variable.value) : `${variable.value > 0 ? "+" : ""}${variable.value.toFixed(1)}%`;
  return (
    <div className="rounded-lg border border-violet-100 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{variable.label}</span>
        <span className="font-manrope text-xs font-semibold text-violet-700">{display}</span>
      </div>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={variable.value}
        onChange={(e) => onChange({ ...variable, value: Number(e.target.value) })}
        className="mt-1.5 w-full accent-violet-600"
      />
    </div>
  );
}

function sliderRange(v: SimVariable): { min: number; max: number; step: number } {
  if (v.unit === "percent") {
    if (v.type === "yield_apy") return { min: 0, max: 20, step: 0.1 };
    return { min: -50, max: 50, step: 1 }; // price shock
  }
  // usd
  return { min: 0, max: 500_000, step: 500 };
}
