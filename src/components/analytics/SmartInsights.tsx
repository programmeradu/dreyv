"use client";

/**
 * SmartInsights — the always-on "smart/reactive/suggestive" layer for /analytics.
 *
 *   • "What changed since yesterday" — streams a markdown narrative anchored
 *     on real day-over-day deltas computed from snapshots + attribution.
 *   • "Ask next" — 3 streamed, on-data questions (no hardcoded prompts).
 *
 * Flat surface only (no shadow / blur / gradient / ring). Streams via SSE
 * from /api/analytics/insights so the layout never blocks.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, ArrowUpRight, MessagesSquare } from "lucide-react";
import { Surface, Pill, StreamIn } from "@/components/app-shell/primitives";

interface SnapshotRow { capturedAt: string; totalUsd: string | number; yieldUsd: string | number }
interface Aggregates {
  inflowUsd: number; outflowUsd: number; yieldUsd: number; feeUsd: number; netUsd: number;
  monthlyBurnRate: number; monthlyInflow: number; annualYieldRate: number; sampleSize: number;
}
interface SnapshotStats { driftPctPerDay: number; volPctPerDay: number; samples: number }
interface ForesightSummary { depletionProbability: number; medianDepletionMonths: number | null }

interface Props {
  vaultValue: number | null;
  vaultChange24h: number | null;
  vaultTokens: any[];
  attribution: Aggregates | null;
  snapshots: SnapshotRow[];
  snapshotStats: SnapshotStats | null;
  foresight: ForesightSummary | null;
  /** Called when the user clicks a suggested question (host pipes it into CommandBar) */
  onAskQuestion?: (question: string) => void;
}

export function SmartInsights({
  vaultValue, vaultChange24h, vaultTokens, attribution,
  snapshots, snapshotStats, foresight, onAskQuestion,
}: Props) {
  const [narrative, setNarrative] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const lastKey = useRef<string>("");

  // ── Build day-over-day diff from snapshots ────────────────────
  const diff = useMemo(() => {
    if (!snapshots || snapshots.length < 2) return null;
    const sorted = [...snapshots].sort(
      (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
    );
    const today = sorted[sorted.length - 1];
    // Find the snapshot closest to 24h before today
    const dayMs = 24 * 60 * 60 * 1000;
    const targetT = new Date(today.capturedAt).getTime() - dayMs;
    const yesterday = sorted.reduce((best, s) => {
      const dt = Math.abs(new Date(s.capturedAt).getTime() - targetT);
      return dt < Math.abs(new Date(best.capturedAt).getTime() - targetT) ? s : best;
    }, sorted[0]);
    const todayVal = Number(today.totalUsd);
    const yVal = Number(yesterday.totalUsd);
    const valueDeltaPct = yVal > 0 ? ((todayVal - yVal) / yVal) * 100 : null;
    const todayYield = Number(today.yieldUsd ?? 0);
    const yYield = Number(yesterday.yieldUsd ?? 0);
    const yieldDeltaPct = yYield !== 0 ? ((todayYield - yYield) / Math.abs(yYield)) * 100 : null;

    // Concentration delta (today vs none — best-effort from current tokens)
    let concentrationDeltaPct: number | null = null;
    if (Array.isArray(vaultTokens) && vaultTokens.length > 0) {
      const total = vaultTokens.reduce((s, t: any) => s + (t?.value ?? 0), 0);
      if (total > 0) {
        const sortedT = [...vaultTokens].sort((a: any, b: any) => (b?.value ?? 0) - (a?.value ?? 0));
        const todayShare = ((sortedT[0]?.value ?? 0) / total) * 100;
        // No yesterday composition snapshot stored at this layer — emit as null.
        concentrationDeltaPct = null;
        void todayShare;
      }
    }

    return {
      valueDeltaPct,
      feeDeltaPct: null,
      burnDeltaPct: null,
      yieldDeltaPct,
      concentrationDeltaPct,
    };
  }, [snapshots, vaultTokens]);

  // ── Top asset ────────────────────────────────────────────────
  const topAsset = useMemo(() => {
    if (!Array.isArray(vaultTokens) || vaultTokens.length === 0) return null;
    const total = vaultTokens.reduce((s, t: any) => s + (t?.value ?? 0), 0);
    if (total <= 0) return null;
    const sorted = [...vaultTokens].sort((a: any, b: any) => (b?.value ?? 0) - (a?.value ?? 0));
    return {
      symbol: String(sorted[0]?.symbol ?? "—"),
      sharePct: ((sorted[0]?.value ?? 0) / total) * 100,
    };
  }, [vaultTokens]);

  // ── Stream insights when inputs change meaningfully ──────────
  useEffect(() => {
    if (!vaultValue || vaultValue <= 0) return;
    const key = JSON.stringify({
      v: Math.round(vaultValue),
      a: attribution?.sampleSize ?? 0,
      f: foresight?.depletionProbability ?? null,
      d: diff?.valueDeltaPct ?? null,
    });
    if (key === lastKey.current) return;
    lastKey.current = key;

    const ctrl = new AbortController();
    setNarrative("");
    setSuggestions([]);
    setStreaming(true);

    (async () => {
      try {
        const res = await fetch("/api/analytics/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            vaultValue,
            vaultChange24h,
            topAsset,
            attribution,
            snapshotStats,
            foresight,
            diff,
          }),
        });
        if (!res.ok || !res.body) {
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let raw = "";
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
            if (data === "[DONE]") break;
            try {
              const j = JSON.parse(data);
              const delta = j.choices?.[0]?.delta?.content as string | undefined;
              if (!delta) continue;
              raw += delta;
              // Parse sentinels
              const narrIdx = raw.indexOf("<<NARRATIVE>>");
              const suggIdx = raw.indexOf("<<SUGGESTIONS>>");
              const endIdx = raw.indexOf("<<END>>");
              if (narrIdx >= 0) {
                const narrEnd = suggIdx >= 0 ? suggIdx : raw.length;
                setNarrative(raw.slice(narrIdx + "<<NARRATIVE>>".length, narrEnd).trim());
              }
              if (suggIdx >= 0) {
                const suggEnd = endIdx >= 0 ? endIdx : raw.length;
                const block = raw.slice(suggIdx + "<<SUGGESTIONS>>".length, suggEnd).trim();
                const lines = block.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3);
                setSuggestions(lines);
              }
            } catch {
              // ignore partial json
            }
          }
        }
        setStreaming(false);
      } catch (e: any) {
        if (e?.name !== "AbortError") setStreaming(false);
      }
    })();

    return () => ctrl.abort();
  }, [vaultValue, vaultChange24h, topAsset, attribution, snapshotStats, foresight, diff]);

  if (!vaultValue || vaultValue <= 0) return null;

  return (
    <div className="grid gap-5 md:grid-cols-5">
      {/* What changed since yesterday */}
      <StreamIn className="md:col-span-3">
        <Surface className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-violet-700">
              <Sparkles className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                What changed since yesterday
              </span>
            </div>
            {streaming && <Pill tone="violet">Reading…</Pill>}
          </div>
          <div className="mt-3 min-h-[5.5rem] whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {narrative || (streaming
              ? "Reading your treasury…"
              : "No movement worth reporting yet. Check back as snapshots accumulate.")}
            {streaming && narrative && (
              <span className="ml-1 inline-block h-3 w-[2px] animate-pulse bg-violet-500 align-middle" />
            )}
          </div>
        </Surface>
      </StreamIn>

      {/* Suggested next questions */}
      <StreamIn delay={0.05} className="md:col-span-2">
        <Surface className="p-6">
          <div className="flex items-center gap-2 text-violet-700">
            <MessagesSquare className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Ask next</span>
          </div>
          <ul className="mt-3 space-y-2">
            {suggestions.length === 0 && (
              <li className="text-sm text-slate-400">
                {streaming ? "Composing questions about your data…" : "—"}
              </li>
            )}
            {suggestions.map((q, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onAskQuestion?.(q)}
                  className="group flex w-full items-start justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-4 py-3 text-left text-sm text-slate-800 transition-colors hover:border-violet-300 hover:bg-violet-50"
                >
                  <span className="flex-1 leading-snug">{q}</span>
                  <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-violet-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </Surface>
      </StreamIn>
    </div>
  );
}
