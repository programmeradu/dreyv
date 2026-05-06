"use client";
import { DreyvStar } from "@/components/studio/DreyvStar";

/**
 * ForesightPanel — Monte Carlo fan chart with meaningful encodings:
 *  - x-axis: time (today → +N months) with month ticks
 *  - y-axis: USD value with axis labels (current, +/- bands)
 *  - bands: P10–P90 outer fan + P25–P75 inner band for true uncertainty shape
 *  - markers: TODAY anchor, MEDIAN endpoint, depletion floor ($0) when relevant
 *  - hover crosshair → date + median + range tooltip
 *  - footer stats use SignalBadge tone system (no amber/emerald stoplights)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Surface } from "@/components/app-shell/primitives";
import { SignalBadge, severityFromScore } from "@/components/analytics/SignalBadge";

interface ProjectionPoint { date: string; p10: number; p50: number; p90: number; mean: number; p25?: number; p75?: number }
interface Summary {
  currentValue: number;
  p10: number;
  p50: number;
  p90: number;
  depletionProbability: number;
  medianDepletionMonths: number | null;
  riskFlags: string[];
}
interface Aggregates {
  inflowUsd: number; outflowUsd: number; yieldUsd: number; feeUsd: number;
  monthlyBurnRate: number; monthlyInflow: number; annualYieldRate: number; sampleSize: number;
}

interface Props {
  projection: ProjectionPoint[];
  summary: Summary | null;
  attribution: Aggregates | null;
  timeframeMonths: number;
  loading: boolean;
  vaultTokens?: any[];
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  if (abs >= 1) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtMonth(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short" });
  } catch {
    return "";
  }
}

export function ForesightPanel({ projection, summary, attribution, timeframeMonths, loading }: Props) {
  const [narrative, setNarrative] = useState<string>("");
  const [streaming, setStreaming] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const lastSummaryKey = useRef<string>("");

  useEffect(() => {
    if (!summary) return;
    const key = `${summary.p50.toFixed(0)}|${summary.p10.toFixed(0)}|${summary.p90.toFixed(0)}|${summary.depletionProbability}`;
    if (key === lastSummaryKey.current) return;
    lastSummaryKey.current = key;

    const ctrl = new AbortController();
    setNarrative("");
    setStreaming(true);

    (async () => {
      try {
        const res = await fetch("/api/foresight/narrative", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ summary, timeframeMonths, attribution: attribution ?? undefined }),
        });
        if (!res.ok || !res.body) {
          setNarrative("Foresight narrator is unavailable right now.");
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") { setStreaming(false); return; }
            try {
              const j = JSON.parse(data);
              const delta = j.choices?.[0]?.delta?.content as string | undefined;
              if (delta) setNarrative((s) => s + delta);
            } catch {
              buf = line + "\n" + buf;
              break;
            }
          }
        }
        setStreaming(false);
      } catch (e: any) {
        if (e?.name !== "AbortError") setNarrative("Foresight narrator failed.");
        setStreaming(false);
      }
    })();

    return () => ctrl.abort();
  }, [summary, attribution, timeframeMonths]);

  const chart = useMemo(() => {
    if (!projection.length || !summary) return null;
    const w = 720, h = 260;
    const padL = 56, padR = 16, padT = 18, padB = 32;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    // include current value as anchor at index -1 (today)
    const series = [
      { date: "today", p10: summary.currentValue, p25: summary.currentValue, p50: summary.currentValue, p75: summary.currentValue, p90: summary.currentValue, mean: summary.currentValue },
      ...projection.map((p) => ({
        ...p,
        p25: p.p25 ?? p.p10 + (p.p50 - p.p10) * 0.5,
        p75: p.p75 ?? p.p50 + (p.p90 - p.p50) * 0.5,
      })),
    ];

    const minY = Math.min(0, ...series.map((p) => p.p10));
    const maxY = Math.max(...series.map((p) => p.p90), summary.currentValue);
    const range = maxY - minY || 1;

    const x = (i: number) => padL + (i / (series.length - 1)) * innerW;
    const y = (v: number) => padT + (1 - (v - minY) / range) * innerH;

    const buildBand = (lo: (p: typeof series[number]) => number, hi: (p: typeof series[number]) => number) =>
      "M " + series.map((p, i) => `${x(i)},${y(hi(p))}`).join(" L ") +
      " L " + series.slice().reverse().map((p, i) => `${x(series.length - 1 - i)},${y(lo(p))}`).join(" L ") +
      " Z";

    const outerBand = buildBand((p) => p.p10, (p) => p.p90);
    const innerBand = buildBand((p) => p.p25!, (p) => p.p75!);
    const medianPath = "M " + series.map((p, i) => `${x(i)},${y(p.p50)}`).join(" L ");

    // y-axis ticks (4)
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const v = minY + range * t;
      return { v, y: y(v) };
    });

    // x-axis ticks (every ~quarter)
    const tickEvery = Math.max(1, Math.round(series.length / 5));
    const xTicks: { i: number; x: number; label: string }[] = [];
    for (let i = 0; i < series.length; i += tickEvery) {
      xTicks.push({
        i,
        x: x(i),
        label: i === 0 ? "today" : fmtMonth(series[i].date),
      });
    }

    return {
      w, h, padL, padR, padT, padB, innerW, innerH,
      series, x, y, outerBand, innerBand, medianPath, yTicks, xTicks,
      minY, maxY,
      zeroY: minY < 0 ? null : y(0),
      todayY: y(summary.currentValue),
    };
  }, [projection, summary]);

  if (!summary) {
    return (
      <Surface className="p-7">
        <div className="flex items-center gap-2 text-violet-700">
          <DreyvStar size={12} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Foresight</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {loading ? "Running 200 projections of your treasury…" : "Connect a wallet to see your foresight bands."}
        </p>
      </Surface>
    );
  }

  const depletionPct = Math.round(summary.depletionProbability * 100);
  const depletionSeverity = severityFromScore(summary.depletionProbability);
  const upside = summary.currentValue > 0 ? ((summary.p90 - summary.currentValue) / summary.currentValue) * 100 : 0;
  const downside = summary.currentValue > 0 ? ((summary.p10 - summary.currentValue) / summary.currentValue) * 100 : 0;
  const expected = summary.currentValue > 0 ? ((summary.p50 - summary.currentValue) / summary.currentValue) * 100 : 0;

  const hp = hover != null && chart ? chart.series[hover] : null;

  return (
    <Surface className="p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-700">
            <DreyvStar size={12} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Foresight · {timeframeMonths}-month outlook</span>
          </div>
          <h3 className="mt-2 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
            Where your treasury could land
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            200 Monte Carlo paths · shaded band = 80% confidence · inner band = 50% · line = median
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SignalBadge severity={depletionSeverity}>{depletionPct}% depletion risk</SignalBadge>
          {summary.medianDepletionMonths != null && (
            <SignalBadge severity="watch">~{summary.medianDepletionMonths} mo runway</SignalBadge>
          )}
        </div>
      </div>

      {/* Fan chart */}
      {chart && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-violet-100 bg-white p-4">
          <svg
            viewBox={`0 0 ${chart.w} ${chart.h}`}
            className="h-[260px] w-full"
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = ((e.clientX - rect.left) / rect.width) * chart.w;
              let best = 0; let bestD = Infinity;
              chart.series.forEach((_, i) => {
                const d = Math.abs(chart.x(i) - px);
                if (d < bestD) { bestD = d; best = i; }
              });
              setHover(best);
            }}
          >
            {/* y gridlines + labels */}
            {chart.yTicks.map((t, i) => (
              <g key={i}>
                <line
                  x1={chart.padL}
                  x2={chart.w - chart.padR}
                  y1={t.y}
                  y2={t.y}
                  stroke="#ede9fe"
                  strokeDasharray="2 4"
                />
                <text
                  x={chart.padL - 8}
                  y={t.y + 3}
                  textAnchor="end"
                  fontSize="10"
                  className="fill-slate-400"
                >
                  {fmtCompact(t.v)}
                </text>
              </g>
            ))}

            {/* zero / depletion floor */}
            {chart.zeroY != null && (
              <g>
                <line
                  x1={chart.padL}
                  x2={chart.w - chart.padR}
                  y1={chart.zeroY}
                  y2={chart.zeroY}
                  stroke="#0f172a"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                  strokeDasharray="4 3"
                />
                <text
                  x={chart.w - chart.padR - 4}
                  y={chart.zeroY - 4}
                  textAnchor="end"
                  fontSize="9"
                  className="fill-slate-700"
                  fontWeight={600}
                >
                  depletion floor
                </text>
              </g>
            )}

            {/* today line */}
            <line
              x1={chart.padL}
              x2={chart.w - chart.padR}
              y1={chart.todayY}
              y2={chart.todayY}
              stroke="#7c3aed"
              strokeOpacity={0.35}
              strokeDasharray="3 4"
            />
            <text
              x={chart.padL + 4}
              y={chart.todayY - 4}
              fontSize="9"
              className="fill-violet-700"
              fontWeight={600}
            >
              today · {fmtCompact(summary.currentValue)}
            </text>

            {/* outer + inner bands */}
            <path d={chart.outerBand} fill="#7c3aed" fillOpacity={0.10} />
            <path d={chart.innerBand} fill="#7c3aed" fillOpacity={0.22} />
            <path d={chart.medianPath} stroke="#5b21b6" strokeWidth={2} fill="none" strokeLinecap="round" />

            {/* endpoint markers */}
            {(() => {
              const last = chart.series[chart.series.length - 1];
              const lx = chart.x(chart.series.length - 1);
              return (
                <g>
                  <circle cx={lx} cy={chart.y(last.p50)} r={4} fill="#5b21b6" />
                  <circle cx={lx} cy={chart.y(last.p90)} r={2.5} fill="#a78bfa" />
                  <circle cx={lx} cy={chart.y(last.p10)} r={2.5} fill="#a78bfa" />
                </g>
              );
            })()}

            {/* x-axis labels */}
            {chart.xTicks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={chart.h - 12}
                textAnchor="middle"
                fontSize="10"
                className="fill-slate-500"
              >
                {t.label}
              </text>
            ))}

            {/* hover crosshair + tooltip */}
            {hp && hover != null && (
              <g>
                <line
                  x1={chart.x(hover)}
                  x2={chart.x(hover)}
                  y1={chart.padT}
                  y2={chart.h - chart.padB}
                  stroke="#7c3aed"
                  strokeOpacity={0.4}
                />
                <circle cx={chart.x(hover)} cy={chart.y(hp.p50)} r={4.5} fill="#7c3aed" />
                <circle cx={chart.x(hover)} cy={chart.y(hp.p50)} r={9} fill="#7c3aed" fillOpacity={0.18} />
              </g>
            )}
          </svg>

          {/* Hover readout (or default) */}
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat
              label={hp ? `${hp.date === "today" ? "today" : fmtMonth(hp.date)} · worst 10%` : "Worst 10%"}
              value={fmtCompact(hp ? hp.p10 : summary.p10)}
              tone="muted"
              delta={hp ? null : downside}
            />
            <Stat
              label={hp ? `${hp.date === "today" ? "today" : fmtMonth(hp.date)} · median` : "Median"}
              value={fmtCompact(hp ? hp.p50 : summary.p50)}
              tone="primary"
              delta={hp ? null : expected}
            />
            <Stat
              label={hp ? `${hp.date === "today" ? "today" : fmtMonth(hp.date)} · best 10%` : "Best 10%"}
              value={fmtCompact(hp ? hp.p90 : summary.p90)}
              tone="muted"
              delta={hp ? null : upside}
            />
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="mt-6 rounded-2xl border border-violet-100 bg-white p-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          <DreyvStar size={9} />
          <span>{streaming ? "Narrating…" : "Insight"}</span>
        </div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {narrative || (streaming ? "…" : "No narrative yet.")}
        </div>
      </div>

      {/* Risk flags */}
      {summary.riskFlags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.riskFlags.map((f) => (
            <SignalBadge key={f} severity="watch">{f.replace(/_/g, " ").toLowerCase()}</SignalBadge>
          ))}
        </div>
      )}
    </Surface>
  );
}

function Stat({
  label,
  value,
  tone,
  delta,
}: {
  label: string;
  value: string;
  tone: "primary" | "muted";
  delta: number | null;
}) {
  return (
    <div className="rounded-xl border border-violet-100 bg-white px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-manrope text-lg font-semibold ${tone === "primary" ? "text-violet-700" : "text-slate-900"}`}>
        {value}
      </div>
      {delta != null && Number.isFinite(delta) && (
        <div className="mt-0.5 text-[10px] font-medium text-slate-500">
          {delta >= 0 ? "▲" : "▼"} {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% vs today
        </div>
      )}
    </div>
  );
}
