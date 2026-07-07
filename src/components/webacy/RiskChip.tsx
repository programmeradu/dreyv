"use client";

import * as React from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Shield } from "lucide-react";
import type { RiskLevel, RiskScore } from "@/lib/webacy/types";

interface RiskChipProps {
  score?: RiskScore | null;
  level?: RiskLevel;
  flags?: string[];
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

const LABELS: Record<RiskLevel, string> = {
  safest: "Safest",
  safe: "Safe",
  medium: "Caution",
  high: "High risk",
  unknown: "Unscored",
};

const STYLES: Record<RiskLevel, string> = {
  // Solid violet-only for the trusted states, per brand core.
  safest: "bg-violet-100 text-violet-700 border-violet-200",
  safe: "bg-violet-50 text-violet-700 border-violet-200",
  // Cautions use amber/rose — never fuchsia/pink/gradient.
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  high: "bg-rose-50 text-rose-700 border-rose-200",
  unknown: "bg-slate-50 text-slate-600 border-slate-200",
};

const ICONS: Record<RiskLevel, React.ComponentType<{ className?: string }>> = {
  safest: ShieldCheck,
  safe: ShieldCheck,
  medium: ShieldAlert,
  high: ShieldAlert,
  unknown: ShieldQuestion,
};

export function RiskChip({ score, level, flags, size = "sm", showLabel = true, className = "" }: RiskChipProps) {
  const resolvedLevel: RiskLevel = level ?? score?.level ?? "unknown";
  const resolvedFlags = flags ?? score?.flags ?? [];
  const Icon = ICONS[resolvedLevel] ?? Shield;

  const sizeCls = size === "md" ? "text-sm px-2.5 py-1 gap-1.5" : "text-xs px-2 py-0.5 gap-1";
  const iconCls = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";

  const tooltip = [
    `${LABELS[resolvedLevel]} — powered by Webacy`,
    ...resolvedFlags.slice(0, 3).map((f) => `• ${f.replace(/_/g, " ")}`),
  ].join("\n");

  return (
    <span
      title={tooltip}
      aria-label={`Risk ${LABELS[resolvedLevel]}${resolvedFlags.length ? `: ${resolvedFlags.slice(0, 3).join(", ")}` : ""}`}
      className={`inline-flex items-center rounded-full border font-medium ${STYLES[resolvedLevel]} ${sizeCls} ${className}`}
    >
      <Icon className={iconCls} aria-hidden />
      {showLabel && <span className="whitespace-nowrap">{LABELS[resolvedLevel]}</span>}
    </span>
  );
}

export default RiskChip;
