"use client";

/**
 * AnomalyChips — flat row of anomaly badges over the existing KPI signals.
 * Pure derivation from props — no fetching, no LLM.
 */

import { Pill } from "@/components/app-shell/primitives";
import { TrendingUp, TrendingDown, AlertTriangle, Check } from "lucide-react";

interface Aggregates {
  feeUsd: number; yieldUsd: number; netUsd: number;
  monthlyBurnRate: number; monthlyInflow: number;
}
interface SnapshotStats { driftPctPerDay: number; volPctPerDay: number; samples: number }
interface ForesightSummary { depletionProbability: number }

interface Props {
  attribution: Aggregates | null;
  snapshotStats: SnapshotStats | null;
  foresight: ForesightSummary | null;
  vaultChange24h: number | null;
}

export function AnomalyChips({ attribution, snapshotStats, foresight, vaultChange24h }: Props) {
  const chips: { label: string; tone: "rose" | "amber" | "emerald" | "violet"; icon: any }[] = [];

  if (vaultChange24h != null && Math.abs(vaultChange24h) >= 5) {
    chips.push({
      label: `${vaultChange24h >= 0 ? "+" : ""}${vaultChange24h.toFixed(1)}% in 24h`,
      tone: vaultChange24h >= 0 ? "emerald" : "rose",
      icon: vaultChange24h >= 0 ? TrendingUp : TrendingDown,
    });
  }
  if (snapshotStats && snapshotStats.volPctPerDay >= 0.05) {
    chips.push({
      label: `Vol spike · ${(snapshotStats.volPctPerDay * 100).toFixed(1)}%/day`,
      tone: "amber",
      icon: AlertTriangle,
    });
  }
  if (attribution && attribution.monthlyBurnRate > attribution.monthlyInflow * 1.5 && attribution.monthlyBurnRate > 0) {
    chips.push({
      label: "Burn outpacing inflow",
      tone: "rose",
      icon: AlertTriangle,
    });
  }
  if (foresight && foresight.depletionProbability >= 0.25) {
    chips.push({
      label: `Depletion risk ${Math.round(foresight.depletionProbability * 100)}%`,
      tone: "rose",
      icon: AlertTriangle,
    });
  }
  if (attribution && attribution.netUsd > 0 && attribution.yieldUsd > attribution.feeUsd * 3 && attribution.yieldUsd > 0) {
    chips.push({
      label: "Yield > 3× fees",
      tone: "emerald",
      icon: Sparkles,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Anomalies</span>
      {chips.map((c, i) => {
        const Icon = c.icon;
        return (
          <Pill key={i} tone={c.tone}>
            <Icon className="h-3 w-3" />
            {c.label}
          </Pill>
        );
      })}
    </div>
  );
}
