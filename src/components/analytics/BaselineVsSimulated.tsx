"use client";

/**
 * BaselineVsSimulated — premium overlay chart that compares the user's real
 * value series (solid violet) against the active scenario's median trajectory
 * (dashed violet) plus P10–P90 confidence bands and the inflection split
 * marker between "now" and the projection.
 *
 * Renders nothing when no scenario is active, so it cleanly disappears
 * the moment the user clears the overlay.
 */

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useSimulatedAnalytics } from "@/lib/foresight/SimulatedAnalyticsContext";
import { Surface, Pill, StreamingNumber } from "@/components/app-shell/primitives";

interface Props {
  /** Real treasury value series from snapshots */
  baseline: { date: string; value: number }[];
}

type Row = {
  date: string;
  label: string;
  phase: "baseline" | "simulated";
  baseline?: number;
  median?: number;
  p10?: number;
  p90?: number;
  bandLow?: number;
  bandSpan?: number;
};

const fmtUsd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}k`
      : `$${n.toFixed(2)}`;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function BaselineVsSimulated({ baseline }: Props) {
  const active = useSimulationStore((s) => s.active);
  const result = useSimulationStore((s) => s.result);
  const sim = useSimulatedAnalytics();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const view = useMemo(() => {
    if (!active || !result) return null;
    const median = result.projection.map((p) => ({ x: p.date, y: p.totalValue }));
    if (!median.length) return null;

    const bands = sim.state?.foresight?.projection ?? [];
    const bandByDate = new Map(bands.map((b) => [b.date, b]));

    const baseSeries: { x: string; y: number }[] = baseline.length >= 2
      ? baseline.map((b) => ({ x: b.date, y: b.value }))
      : [{ x: median[0].x, y: result.summary.currentValue }];

    const splitDate = median[0].x;

    const baseRows: Row[] = baseSeries.map((p) => ({
      date: p.x,
      label: fmtDate(p.x),
      phase: "baseline",
      baseline: p.y,
    }));

    const simRows: Row[] = median.map((p, i) => {
      const b = bandByDate.get(p.x);
      const lo = b?.p10 ?? p.y;
      const hi = b?.p90 ?? p.y;
      return {
        date: p.x,
        label: fmtDate(p.x),
        phase: "simulated",
        median: p.y,
        p10: lo,
        p90: hi,
        bandLow: lo,
        bandSpan: Math.max(0, hi - lo),
        // bridge baseline → projection at the split point so the solid line meets the dashed
        baseline: i === 0 ? result.summary.currentValue : undefined,
      };
    });

    const rows: Row[] = [...baseRows, ...simRows];

    const allValues = rows.flatMap((r) =>
      [r.baseline, r.median, r.p10, r.p90].filter((v): v is number => typeof v === "number"),
    );
    const minY = Math.min(...allValues, 0);
    const maxY = Math.max(...allValues);

    return { rows, splitDate, minY, maxY };
  }, [active, result, baseline, sim.state]);

  if (!active || !result || !view) return null;

  const s = result.summary;
  const tone: "violet" | "amber" = s.deltaPercent >= 0 ? "violet" : "amber";
  const hovered = hoverIdx != null ? view.rows[hoverIdx] : null;

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
          <p className="mt-1 text-xs text-slate-500">
            Solid = your live value · dashed = scenario median · band = P10–P90 confidence
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={tone}>
            <StreamingNumber value={s.deltaPercent} suffix="%" decimals={1} duration={0.6} />
          </Pill>
          {s.runwayMonths != null && (
            <Pill tone="slate">~{s.runwayMonths} mo runway</Pill>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-violet-100 bg-white">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={view.rows}
              margin={{ top: 16, right: 24, bottom: 8, left: 8 }}
              onMouseMove={(state: any) => {
                if (state?.activeTooltipIndex != null) setHoverIdx(state.activeTooltipIndex);
              }}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <defs>
                <linearGradient id="bvs-band" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(124 58 237)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="rgb(124 58 237)" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="bvs-base" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(124 58 237)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="rgb(124 58 237)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgb(237 233 254)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "rgb(100 116 139)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "rgb(237 233 254)" }}
                minTickGap={24}
              />
              <YAxis
                domain={[Math.min(0, view.minY), (max: any) => Number(max) * 1.05]}
                tick={{ fill: "rgb(100 116 139)", fontSize: 11 }}
                tickFormatter={(v: any) => fmtUsd(Number(v))}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              {/* Shade the projection region */}
              <ReferenceArea
                x1={view.splitDate ? fmtDate(view.splitDate) : undefined}
                x2={view.rows[view.rows.length - 1]?.label}
                fill="rgb(245 243 255)"
                fillOpacity={0.6}
              />
              <ReferenceLine
                x={view.splitDate ? fmtDate(view.splitDate) : undefined}
                stroke="rgb(167 139 250)"
                strokeDasharray="3 4"
                label={{
                  value: "now",
                  position: "insideTopRight",
                  fill: "rgb(124 58 237)",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              {/* P10–P90 band: invisible base + visible span */}
              <Area
                type="monotone"
                dataKey="bandLow"
                stackId="band"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="bandSpan"
                stackId="band"
                stroke="none"
                fill="url(#bvs-band)"
                isAnimationActive={false}
              />
              {/* Baseline area + line */}
              <Area
                type="monotone"
                dataKey="baseline"
                stroke="rgb(124 58 237)"
                strokeWidth={2.5}
                fill="url(#bvs-base)"
                connectNulls
                dot={false}
                activeDot={{ r: 4, fill: "rgb(124 58 237)", stroke: "white", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {/* Simulated median */}
              <Line
                type="monotone"
                dataKey="median"
                stroke="rgb(124 58 237)"
                strokeWidth={2.5}
                strokeDasharray="6 5"
                dot={false}
                activeDot={{ r: 4, fill: "white", stroke: "rgb(124 58 237)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Tooltip
                cursor={{ stroke: "rgb(196 181 253)", strokeWidth: 1 }}
                content={({ active: a, payload, label }) => {
                  if (!a || !payload?.length) return null;
                  const row = payload[0]?.payload as Row | undefined;
                  if (!row) return null;
                  const isSim = row.phase === "simulated";
                  return (
                    <div className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs shadow-lg">
                      <div className="mb-1 font-semibold uppercase tracking-wider text-[10px] text-violet-600">
                        {isSim ? "Simulated" : "Live"} · {label}
                      </div>
                      {row.baseline != null && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Baseline</span>
                          <span className="font-manrope font-semibold text-violet-700">{fmtUsd(row.baseline)}</span>
                        </div>
                      )}
                      {row.median != null && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Median</span>
                          <span className="font-manrope font-semibold text-slate-900">{fmtUsd(row.median)}</span>
                        </div>
                      )}
                      {row.p10 != null && row.p90 != null && (
                        <div className="mt-1 flex items-center justify-between gap-4 border-t border-violet-50 pt-1 text-[11px]">
                          <span className="text-slate-400">P10–P90</span>
                          <span className="font-manrope text-slate-600">
                            {fmtUsd(row.p10)} — {fmtUsd(row.p90)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-violet-50 px-5 py-3 text-[11px] sm:grid-cols-4">
          <Stat label="Baseline" value={fmtUsd(s.currentValue)} accent="violet" />
          <Stat
            label={hovered?.phase === "simulated" ? `At ${hovered.label}` : "Simulated end"}
            value={fmtUsd(hovered?.median ?? s.projectedEndValue)}
          />
          <Stat
            label="Δ value"
            value={`${s.delta >= 0 ? "+" : ""}${fmtUsd(Math.abs(s.delta))}`}
            accent={s.delta >= 0 ? "violet" : "amber"}
          />
          <Stat
            label="Δ %"
            value={`${s.deltaPercent >= 0 ? "+" : ""}${s.deltaPercent.toFixed(1)}%`}
            accent={s.deltaPercent >= 0 ? "violet" : "amber"}
          />
        </div>
      </div>

      {s.riskFlags?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {s.riskFlags.slice(0, 6).map((f) => (
            <Pill key={f} tone="amber">{f.replace(/_/g, " ").toLowerCase()}</Pill>
          ))}
        </div>
      )}
    </Surface>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "violet" | "amber" }) {
  const tone =
    accent === "amber"
      ? "text-amber-700"
      : accent === "violet"
        ? "text-violet-700"
        : "text-slate-900";
  return (
    <div className="text-center">
      <div className="font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-manrope text-base font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
