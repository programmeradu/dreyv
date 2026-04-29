"use client";

/**
 * DashboardIRRenderer
 * ───────────────────
 * The deterministic, on-brand renderer for the Foresight IR. Same input
 * → same UI (screenshot-stable), no rogue dark surfaces, no fuchsia, no
 * arbitrary TSX. This replaces the iframe + Babel + sandboxed runtime
 * path entirely.
 *
 * Design rules (from mem://design/analytics-rules):
 *   • Flat surfaces — no shadows, no blur, no gradients, no rings.
 *   • Solid violet-600, ambient violet-200/100 accents only.
 *   • Manrope + tabular numerics for numbers.
 */

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Surface,
  Pill,
  StreamIn,
  StreamingNumber,
} from "@/components/app-shell/primitives";
import {
  useBindingResolver,
} from "./binding-context";
import type {
  DashboardIR,
  Metric,
  Visual,
} from "./ir";

// ─── Formatting ─────────────────────────────────────────────────────

function formatMetric(m: Metric, useSimulated = false): string {
  const v = useSimulated && m.simulated != null ? m.simulated : m.value;
  const d = m.decimals ?? (m.format === "currency" ? 0 : 1);
  switch (m.format) {
    case "currency":
      if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
      if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
      if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
      return `$${v.toFixed(d)}`;
    case "percent":
      return `${v.toFixed(d)}%`;
    case "months":
      return `${v.toFixed(d)} mo`;
    case "ratio":
      return v.toFixed(d);
    case "number":
    default:
      return v.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
  }
}

function toneClass(tone?: Metric["tone"], delta?: number): string {
  if (tone === "positive") return "text-emerald-700";
  if (tone === "negative") return "text-rose-700";
  if (tone === "warning") return "text-amber-700";
  if (delta != null) {
    if (delta > 0) return "text-emerald-700";
    if (delta < 0) return "text-rose-700";
  }
  return "text-slate-900";
}

// ─── Visual primitives ──────────────────────────────────────────────

function KpiStrip({ visual }: { visual: Visual }) {
  const metrics = visual.metrics ?? [];
  if (!metrics.length) return null;
  return (
    <div className={`grid gap-4 ${metrics.length >= 4 ? "md:grid-cols-4" : metrics.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      {metrics.map((m, i) => {
        const useSim = m.simulated != null;
        const main = formatMetric(m, useSim);
        return (
          <StreamIn key={m.id} delay={0.04 * i}>
            <Surface className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                {m.label}
              </div>
              <div className={`mt-2 font-manrope text-3xl font-semibold tracking-tight tabular-nums ${toneClass(m.tone, m.delta)}`}>
                {main}
              </div>
              {m.hint && (
                <div className="mt-1 text-[11px] text-slate-500">{m.hint}</div>
              )}
              {m.delta != null && m.delta !== 0 && (
                <div className="mt-3">
                  <Pill tone={m.delta >= 0 ? "emerald" : "rose"}>
                    {m.delta >= 0 ? "+" : ""}
                    {m.format === "currency"
                      ? formatMetric({ ...m, value: m.delta, simulated: undefined } as Metric)
                      : `${m.delta.toFixed(m.decimals ?? 1)}${m.format === "percent" ? "%" : ""}`}
                  </Pill>
                </div>
              )}
            </Surface>
          </StreamIn>
        );
      })}
    </div>
  );
}

interface SeriesPoint { x: string | number; y: number; yLow?: number; yHigh?: number }

function TimeSeries({ visual }: { visual: Visual }) {
  const resolver = useBindingResolver();
  const series = visual.series ?? [];

  const view = useMemo(() => {
    const resolved = series.map((s) => {
      const data: SeriesPoint[] =
        s.binding.source === "inline"
          ? (s.binding.data ?? [])
          : (resolver(s.binding.source, s.binding.bindingId) ?? []);
      return { ...s, data };
    });
    const all = resolved.flatMap((s) => s.data.map((p) => p.y));
    if (!all.length) return null;
    const minY = Math.min(...all);
    const maxY = Math.max(...all);
    const range = maxY - minY || 1;
    const w = 720, h = 200, padX = 12, padY = 14;
    const y = (v: number) => padY + (1 - (v - minY) / range) * (h - 2 * padY);
    const lines = resolved.map((s) => {
      const n = s.data.length;
      if (!n) return { ...s, path: "" };
      const x = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (w - 2 * padX));
      const path = "M " + s.data.map((p, i) => `${x(i)},${y(p.y)}`).join(" L ");
      return { ...s, path };
    });
    return { w, h, lines };
  }, [series, resolver]);

  if (!view) {
    return (
      <Surface className="p-7">
        {visual.title && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
            {visual.title}
          </p>
        )}
        <p className="mt-3 text-sm text-slate-500">No series data bound.</p>
      </Surface>
    );
  }

  return (
    <Surface className="p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {visual.title && (
            <h3 className="font-manrope text-xl font-semibold tracking-tight text-slate-900">
              {visual.title}
            </h3>
          )}
          {visual.subtitle && (
            <p className="mt-1 text-sm text-slate-600">{visual.subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          {view.lines.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-0.5 w-5 ${s.ghost ? "border-t-2 border-dashed border-violet-500" : "bg-violet-600"}`}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-white p-3">
        <svg viewBox={`0 0 ${view.w} ${view.h}`} className="h-48 w-full">
          {view.lines.map((s) => (
            <path
              key={s.id}
              d={s.path}
              stroke="rgb(124 58 237)"
              strokeWidth="2"
              strokeDasharray={s.ghost ? "6 5" : undefined}
              opacity={s.ghost ? 0.85 : 1}
              fill="none"
            />
          ))}
        </svg>
      </div>
    </Surface>
  );
}

function FanChart({ visual }: { visual: Visual }) {
  const resolver = useBindingResolver();
  const series = visual.series?.[0];

  const view = useMemo(() => {
    if (!series) return null;
    const data: SeriesPoint[] =
      series.binding.source === "inline"
        ? (series.binding.data ?? [])
        : (resolver(series.binding.source, series.binding.bindingId) ?? []);
    if (!data.length) return null;
    const lows = data.map((p) => p.yLow ?? p.y);
    const highs = data.map((p) => p.yHigh ?? p.y);
    const minY = Math.min(...lows);
    const maxY = Math.max(...highs);
    const range = maxY - minY || 1;
    const w = 720, h = 200, padX = 12, padY = 14;
    const x = (i: number) => padX + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (w - 2 * padX));
    const y = (v: number) => padY + (1 - (v - minY) / range) * (h - 2 * padY);
    const band =
      "M " + data.map((p, i) => `${x(i)},${y(p.yHigh ?? p.y)}`).join(" L ") +
      " L " + data.slice().reverse().map((p, i) => `${x(data.length - 1 - i)},${y(p.yLow ?? p.y)}`).join(" L ") +
      " Z";
    const median = "M " + data.map((p, i) => `${x(i)},${y(p.y)}`).join(" L ");
    return { w, h, band, median };
  }, [series, resolver]);

  if (!view) return null;
  return (
    <Surface className="p-7">
      {visual.title && (
        <h3 className="font-manrope text-xl font-semibold tracking-tight text-slate-900">
          {visual.title}
        </h3>
      )}
      <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-white p-3">
        <svg viewBox={`0 0 ${view.w} ${view.h}`} className="h-48 w-full">
          <path d={view.band} fill="rgb(124 58 237 / 0.18)" />
          <path d={view.median} stroke="rgb(124 58 237)" strokeWidth="2" fill="none" />
        </svg>
      </div>
    </Surface>
  );
}

function CalloutBlock({ visual }: { visual: Visual }) {
  const tone = visual.callout ?? "info";
  const Icon =
    tone === "risk" ? AlertTriangle :
    tone === "warning" ? AlertTriangle :
    tone === "success" ? CheckCircle2 :
    Info;
  const pillTone =
    tone === "risk" ? "rose" :
    tone === "warning" ? "amber" :
    tone === "success" ? "emerald" :
    "violet";
  return (
    <Surface className="p-6">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
        <Pill tone={pillTone as any}>
          <Icon className="h-3 w-3" /> {tone}
        </Pill>
        {visual.title && (
          <span className="text-slate-500">· {visual.title}</span>
        )}
      </div>
      {visual.body && (
        <pre className="mt-3 whitespace-pre-wrap font-manrope text-sm leading-relaxed text-slate-700">
          {visual.body}
        </pre>
      )}
    </Surface>
  );
}

function VisualBlock({ visual }: { visual: Visual }) {
  switch (visual.type) {
    case "kpi_strip":
      return <KpiStrip visual={visual} />;
    case "time_series":
      return <TimeSeries visual={visual} />;
    case "fan_chart":
      return <FanChart visual={visual} />;
    case "callout":
      return <CalloutBlock visual={visual} />;
    case "waterfall":
    case "donut":
    case "bar":
    case "table":
      // Phase-1 fallback: render as a callout listing the underlying metrics
      // so the IR contract holds even before each visual has bespoke art.
      return (
        <CalloutBlock
          visual={{
            ...visual,
            callout: "info",
            body: visual.metrics
              ? visual.metrics.map((m) => `• ${m.label}: ${formatMetric(m)}`).join("\n")
              : visual.body ?? "(no data)",
          }}
        />
      );
    default:
      return null;
  }
}

// ─── Top-level renderer ─────────────────────────────────────────────

export function DashboardIRRenderer({ ir }: { ir: DashboardIR }) {
  const conf = ir.scenario.confidence ?? null;
  const headlineVisual: Visual = {
    id: "ir_headline",
    type: "kpi_strip",
    metrics: ir.headline,
  };

  return (
    <div className="space-y-6">
      {/* Scenario header */}
      <Surface className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
              <Sparkles className="h-3.5 w-3.5" />
              Scenario · {ir.scenario.timeframeMonths}-month
            </div>
            <h2 className="mt-2 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
              {ir.scenario.title}
            </h2>
            {ir.scenario.description && (
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {ir.scenario.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {conf != null && (
              <Pill tone={conf < 0.4 ? "amber" : "violet"}>
                {Math.round(conf * 100)}% confidence
              </Pill>
            )}
            {ir.hash && (
              <Pill tone="slate">id {ir.hash.slice(0, 10)}</Pill>
            )}
          </div>
        </div>
        {ir.scenario.drivers.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {ir.scenario.drivers.map((d) => (
              <Pill key={d.id} tone="violet">
                <TrendingUp className="h-3 w-3" /> {d.label} {d.change}
              </Pill>
            ))}
          </div>
        )}
      </Surface>

      {/* Headline strip */}
      <KpiStrip visual={headlineVisual} />

      {/* Visuals */}
      {ir.visuals
        .filter((v) => v.id !== "kpi_strip") // already rendered as headline
        .map((v, i) => (
          <StreamIn key={v.id} delay={0.05 * i}>
            <VisualBlock visual={v} />
          </StreamIn>
        ))}

      {/* Rationale */}
      <Surface className="p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
          Rationale
        </p>
        <p className="mt-3 font-manrope text-base leading-relaxed text-slate-800">
          {ir.rationale.summary}
        </p>
        {ir.rationale.drivers && ir.rationale.drivers.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
            {ir.rationale.drivers.map((d, i) => (
              <li key={i}>{d.text}</li>
            ))}
          </ul>
        )}
        {ir.rationale.caveats && ir.rationale.caveats.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Caveats
            </div>
            <ul className="mt-2 space-y-1 text-sm text-amber-800">
              {ir.rationale.caveats.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
          </div>
        )}
        {ir.rationale.trust && ir.rationale.trust.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {ir.rationale.trust.map((t, i) => (
              <Pill key={i} tone={t.tone === "warning" ? "amber" : "slate"}>
                <span className="font-semibold">{t.label}:</span>&nbsp;{t.value}
              </Pill>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}

// Re-export helpers so consumers can import { DashboardIRRenderer, StreamingNumber } from one path
export { StreamingNumber };
