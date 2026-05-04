"use client";

/**
 * SignalBadge — the unified severity chip for /app/analytics.
 *
 * Replaces the green/red emerald/rose pills that felt generic. Instead we
 * express severity tonally on a violet → amber → carbon scale, with a tiny
 * geometric mark (no dots, no traffic lights):
 *
 *   • good  → solid violet ink on violet-50  ▲ stable
 *   • watch → warm amber ink on amber-50/40   ◆ watch
 *   • risk  → carbon (slate-900) ink on white ▼ high  (subtle, serious)
 *
 * Use this everywhere a status/severity is shown across analytics so the
 * page reads as a single coherent system instead of stoplight chips.
 */

import { DreyvStar } from "@/components/studio/DreyvStar";
import { cn } from "@/lib/utils";

export type Severity = "good" | "watch" | "risk" | "neutral";

const TONES: Record<Severity, { wrap: string; mark: string; label: string }> = {
  good:    { wrap: "border-violet-200 bg-violet-50 text-violet-800",          mark: "text-violet-600",  label: "stable" },
  watch:   { wrap: "border-amber-200 bg-amber-50/70 text-amber-800",          mark: "text-amber-600",   label: "watch" },
  risk:    { wrap: "border-slate-900 bg-slate-900 text-white",                mark: "text-violet-300",  label: "high" },
  neutral: { wrap: "border-violet-100 bg-white text-slate-700",               mark: "text-violet-500",  label: "—" },
};

export function SignalBadge({
  severity,
  children,
  className,
  showStar = true,
}: {
  severity: Severity;
  children?: React.ReactNode;
  className?: string;
  showStar?: boolean;
}) {
  const t = TONES[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
        t.wrap,
        className,
      )}
    >
      {showStar && <DreyvStar size={9} className={t.mark} />}
      <span>{children ?? t.label}</span>
    </span>
  );
}

/** Severity → from a 0..1 score the rest of analytics already computes. */
export function severityFromScore(score: number): Severity {
  if (score >= 0.7) return "risk";
  if (score >= 0.4) return "watch";
  return "good";
}

/** Severity → from a signed delta (24h, PnL, vs benchmark). */
export function severityFromDelta(delta: number | null | undefined, big = 5): Severity {
  if (delta == null || !Number.isFinite(delta)) return "neutral";
  if (delta >= big) return "good";
  if (delta >= 0) return "good";
  if (delta >= -big) return "watch";
  return "risk";
}
