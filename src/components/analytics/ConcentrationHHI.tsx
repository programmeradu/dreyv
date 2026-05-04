"use client";

/**
 * ConcentrationHHI (compact) — top-asset share + HHI as a horizontal share rail.
 * No donut (cockpit already owns the donut).
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CompactCard } from "./CompactCard";
import { SignalBadge } from "./SignalBadge";

interface Props { vaultTokens: any[] }

const VIOLET_RAMP = ["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

export function ConcentrationHHI({ vaultTokens }: Props) {
  const data = useMemo(() => {
    const list = (vaultTokens ?? []).filter((t: any) => (t?.value ?? 0) > 0);
    const total = list.reduce((s: number, t: any) => s + (t?.value ?? 0), 0);
    if (total <= 0) return null;
    const sorted = [...list].sort((a: any, b: any) => (b?.value ?? 0) - (a?.value ?? 0));
    const shares = sorted.map((t: any, i: number) => ({
      symbol: String(t.symbol ?? "—").toUpperCase(),
      sharePct: ((t.value ?? 0) / total) * 100,
      color: VIOLET_RAMP[i % VIOLET_RAMP.length],
    }));
    const hhi = Math.round(shares.reduce((s, x) => s + x.sharePct * x.sharePct, 0));
    const effective = hhi > 0 ? 10000 / hhi : 0;
    return { shares: shares.slice(0, 6), hhi, effective };
  }, [vaultTokens]);

  if (!data) {
    return (
      <CompactCard
        eyebrow="Concentration"
        headline="—"
        subline="Connect a wallet to measure HHI."
      />
    );
  }

  const severity = data.hhi >= 5000 ? 0.85 : data.hhi >= 2500 ? 0.55 : data.hhi >= 1500 ? 0.3 : 0.1;
  const top = data.shares[0];

  return (
    <CompactCard
      eyebrow="Concentration"
      badge={<SignalBadge severity={severity} label={data.hhi >= 5000 ? "High" : data.hhi >= 2500 ? "Watch" : "Stable"} />}
      headline={`${top.sharePct.toFixed(0)}% ${top.symbol}`}
      subline={`HHI ${data.hhi.toLocaleString()} · ${data.effective.toFixed(1)} effective positions`}
    >
      <div className="flex h-full w-full flex-col justify-end gap-1.5">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-violet-50">
          {data.shares.map((s, i) => (
            <motion.div
              key={`${s.symbol}-${i}`}
              initial={{ width: 0 }}
              animate={{ width: `${s.sharePct}%` }}
              transition={{ duration: 0.85, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
              style={{ backgroundColor: s.color }}
              className="h-full"
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-slate-500">
          {data.shares.slice(0, 4).map((s, i) => (
            <span key={`${s.symbol}-${i}`} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.symbol} {s.sharePct.toFixed(0)}%
            </span>
          ))}
        </div>
      </div>
    </CompactCard>
  );
}
