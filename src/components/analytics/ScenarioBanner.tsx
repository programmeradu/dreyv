"use client";

/**
 * ScenarioBanner — sticky-ish header that announces the active what-if
 * overlay on /analytics. Flat: white card + violet-200 border, no shadows.
 *
 * Shows: scenario title (derived from variables), baseline → simulated
 * delta on portfolio value, depletion-risk pill, and a Clear button that
 * returns the page to its default analytics mode.
 */

import { X, ArrowRight, Loader2 } from "lucide-react";
import { useSimulationStore, type SimulationVariable } from "@/lib/stores/simulation-store";
import { Pill, StreamingNumber } from "@/components/app-shell/primitives";

function describeVar(v: SimulationVariable): string {
  switch (v.type) {
    case "price_change": {
      const pct = Math.round(v.value * 100);
      const dir = pct === 0 ? "flat" : pct > 0 ? `+${pct}%` : `${pct}%`;
      return `${v.asset ?? "Market"} ${dir}`;
    }
    case "burn_rate":
      return `Burn $${Math.round(v.value).toLocaleString()}/mo`;
    case "inflow":
      return `Inflow $${Math.round(v.value).toLocaleString()}/mo`;
    case "yield_apy":
      return `Yield ${(v.value * 100).toFixed(1)}% APY`;
    case "custom":
      if (v.unit === "usd" && v.asset) return `${v.asset} → $${v.value}`;
      return v.label;
    default:
      return v.label;
  }
}

function fmt(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export function ScenarioBanner() {
  const active = useSimulationStore((s) => s.active);
  const loading = useSimulationStore((s) => s.loading);
  const error = useSimulationStore((s) => s.error);
  const variables = useSimulationStore((s) => s.variables);
  const result = useSimulationStore((s) => s.result);
  const timeframeMonths = useSimulationStore((s) => s.timeframeMonths);
  const clear = useSimulationStore((s) => s.clearSimulation);

  if (!active) return null;

  const summary = result?.summary ?? null;
  const deltaPct = summary?.deltaPercent ?? null;
  const deltaTone =
    deltaPct == null ? "violet" : deltaPct >= 0 ? "emerald" : "rose";

  return (
    <div className="rounded-3xl border border-violet-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <Sparkles className="h-3.5 w-3.5" />
            Scenario overlay · {timeframeMonths}-month
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {variables.slice(0, 4).map((v) => (
              <Pill key={v.id} tone="violet">{describeVar(v)}</Pill>
            ))}
            {variables.length > 4 && (
              <span className="text-[11px] text-slate-500">+{variables.length - 4} more</span>
            )}
          </div>
          {error && (
            <p className="mt-2 text-xs text-rose-600">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {loading && !summary && (
            <span className="inline-flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running 200 paths…
            </span>
          )}
          {summary && (
            <>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Baseline → simulated
                </div>
                <div className="font-manrope text-base font-semibold text-slate-900">
                  {fmt(summary.currentValue)} <ArrowRight className="inline h-3 w-3 text-slate-400" /> {fmt(summary.projectedEndValue)}
                </div>
              </div>
              <Pill tone={deltaTone}>
                <StreamingNumber
                  value={deltaPct ?? 0}
                  suffix="%"
                  decimals={1}
                  duration={0.6}
                />
              </Pill>
            </>
          )}
          <button
            onClick={clear}
            aria-label="Clear scenario overlay"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-violet-200 text-slate-500 hover:text-violet-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
