"use client";

/**
 * BaselineVsSimulated — flat overlay chart that draws the user's real
 * value series (solid violet) and the simulated trajectory from the
 * active scenario (dashed "ghost" violet) on a shared axis.
 *
 * Renders nothing when no scenario is active, so it cleanly disappears
 * the moment the user clears the overlay.
 */

import { useMemo } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { Surface, Pill, StreamingNumber } from "@/components/app-shell/primitives";

interface Props {
  /** Real treasury value series from snapshots */
  baseline: { date: string; value: number }[];
}

export function BaselineVsSimulated({ baseline }: Props) {
  const active = useSimulationStore((s) => s.active);
  const result = useSimulationStore((s) => s.result);

  const view = useMemo(() => {
    if (!active || !result) return null;
    const sim = result.projection.map((p) => ({ x: p.date, y: p.totalValue }));
    if (!sim.length) return null;

    const baseSeries = baseline.length >= 2
      ? baseline.map((b) => ({ x: b.date, y: b.value }))
      : sim.length
        ? [{ x: sim[0].x, y: result.summary.currentValue }]
        : [];

    const all = [...baseSeries.map((p) => p.y), ...sim.map((p) => p.y)];
    const minY = Math.min(...all);
    const maxY = Math.max(...all);
    const range = maxY - minY || 1;

    const w = 720, h = 200, padX = 12, padY = 16;
    const xBase = (i: number, n: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (w * 0.4 - 2 * padX));
    const xSim = (i: number, n: number) => w * 0.4 + (n <= 1 ? 0 : (i / (n - 1)) * (w * 0.6 - 2 * padX));
    const y = (v: number) => padY + (1 - (v - minY) / range) * (h - 2 * padY);

    const basePath = baseSeries.length
      ? "M " + baseSeries.map((p, i) => `${xBase(i, baseSeries.length)},${y(p.y)}`).join(" L ")
      : "";
    const simPath = "M " + sim.map((p, i) => `${xSim(i, sim.length)},${y(p.y)}`).join(" L ");
    const splitX = w * 0.4;

    return { w, h, basePath, simPath, splitX, sim, baseSeries };
  }, [active, result, baseline]);

  if (!active || !result || !view) return null;

  const s = result.summary;
  const tone = s.deltaPercent >= 0 ? "emerald" : "rose";

  return (
    <Surface className="p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
            Baseline vs simulated
          </p>
          <h3 className="mt-2 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
            Where the scenario lands
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={tone}>
            <StreamingNumber value={s.deltaPercent} suffix="%" decimals={1} duration={0.6} />
          </Pill>
          {s.runwayMonths != null && (
            <Pill tone="rose">~{s.runwayMonths} mo runway</Pill>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-violet-100 bg-white p-3">
        <svg viewBox={`0 0 ${view.w} ${view.h}`} className="h-48 w-full">
          {/* split marker — where "now" ends and the simulation starts */}
          <line
            x1={view.splitX} x2={view.splitX}
            y1={8} y2={view.h - 8}
            stroke="rgb(196 181 253)" strokeDasharray="3 4"
          />
          {/* baseline (real) */}
          {view.basePath && (
            <path
              d={view.basePath}
              stroke="rgb(124 58 237)"
              strokeWidth="2"
              fill="none"
            />
          )}
          {/* simulated (ghost) */}
          <path
            d={view.simPath}
            stroke="rgb(124 58 237)"
            strokeWidth="2"
            strokeDasharray="6 5"
            fill="none"
            opacity={0.85}
          />
        </svg>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center text-[11px]">
          <div>
            <div className="font-semibold uppercase tracking-wider text-slate-500">Baseline</div>
            <div className="font-manrope text-base font-semibold text-violet-700">
              ${Math.round(s.currentValue).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-slate-500">Simulated end</div>
            <div className="font-manrope text-base font-semibold text-slate-900">
              ${Math.round(s.projectedEndValue).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-slate-500">Δ value</div>
            <div className={`font-manrope text-base font-semibold ${s.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {s.delta >= 0 ? "+" : ""}${Math.round(s.delta).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {s.riskFlags?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {s.riskFlags.slice(0, 6).map((f) => (
            <Pill key={f} tone="rose">{f.replace(/_/g, " ").toLowerCase()}</Pill>
          ))}
        </div>
      )}
    </Surface>
  );
}
