"use client";
import { DreyvStar } from "@/components/studio/DreyvStar";

/**
 * ForesightPanel — renders Monte Carlo bands (P10/P50/P90), risk flags,
 * and a streaming LLM narrative for the current vault. Driven by
 * useForesightFoundation. Phase 14.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Surface, Pill, StreamingNumber } from "@/components/app-shell/primitives";

interface ProjectionPoint { date: string; p10: number; p50: number; p90: number; mean: number }
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
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function ForesightPanel({ projection, summary, attribution, timeframeMonths, loading }: Props) {
  const [narrative, setNarrative] = useState<string>("");
  const [streaming, setStreaming] = useState(false);
  const lastSummaryKey = useRef<string>("");

  // ── Stream narrative whenever the summary changes meaningfully ──────
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
          body: JSON.stringify({
            summary,
            timeframeMonths,
            attribution: attribution ?? undefined,
          }),
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
    if (!projection.length) return null;
    const w = 600, h = 180, padX = 6, padY = 8;
    const minY = Math.min(...projection.map((p) => p.p10));
    const maxY = Math.max(...projection.map((p) => p.p90));
    const range = maxY - minY || 1;
    const x = (i: number) => padX + (i / (projection.length - 1)) * (w - 2 * padX);
    const y = (v: number) => padY + (1 - (v - minY) / range) * (h - 2 * padY);

    const bandPath =
      "M " + projection.map((p, i) => `${x(i)},${y(p.p90)}`).join(" L ") +
      " L " + projection.slice().reverse().map((p, i) => `${x(projection.length - 1 - i)},${y(p.p10)}`).join(" L ") +
      " Z";
    const medianPath = "M " + projection.map((p, i) => `${x(i)},${y(p.p50)}`).join(" L ");

    return { w, h, bandPath, medianPath };
  }, [projection]);

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
  const depletionTone: "violet" | "amber" | "slate" = depletionPct >= 50 ? "amber" : depletionPct >= 20 ? "violet" : "slate";

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
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={depletionTone}>{depletionPct}% depletion risk</Pill>
          {summary.medianDepletionMonths != null && (
            <Pill tone="amber"><AlertTriangle className="mr-1 inline h-3 w-3" />~{summary.medianDepletionMonths} mo runway</Pill>
          )}
        </div>
      </div>

      {/* Bands chart */}
      {chart && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="h-44 w-full">
            <path d={chart.bandPath} fill="rgb(124 58 237 / 0.18)" />
            <path d={chart.medianPath} stroke="rgb(124 58 237)" strokeWidth="2" fill="none" />
          </svg>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Worst 10%</div>
              <div className="font-manrope text-lg font-semibold text-amber-700">{fmtCompact(summary.p10)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">Median</div>
              <div className="font-manrope text-lg font-semibold text-violet-700">
                <StreamingNumber value={summary.p50} prefix="$" decimals={0} />
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Best 10%</div>
              <div className="font-manrope text-lg font-semibold text-slate-900">{fmtCompact(summary.p90)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          {streaming ? "Narrating…" : "Insight"}
        </div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {narrative || (streaming ? "…" : "No narrative yet.")}
        </div>
      </div>

      {/* Risk flags */}
      {summary.riskFlags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.riskFlags.map((f) => (
            <Pill key={f} tone="rose">{f.replace(/_/g, " ").toLowerCase()}</Pill>
          ))}
        </div>
      )}
    </Surface>
  );
}
