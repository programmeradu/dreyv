"use client";

/**
 * ConcentrationHHI — Herfindahl-Hirschman Index for treasury concentration.
 *
 * HHI = sum of squared market shares (in basis points). Renders a flat
 * radial gauge + the top-N positions ranked, with diversification verdict.
 * Pure presentational — derives from vaultTokens.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Surface, Pill, StreamIn } from "@/components/app-shell/primitives";

interface Props { vaultTokens: any[] }

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function ConcentrationHHI({ vaultTokens }: Props) {
  const data = useMemo(() => {
    const list = (vaultTokens ?? []).filter((t: any) => (t?.value ?? 0) > 0);
    const total = list.reduce((s: number, t: any) => s + (t?.value ?? 0), 0);
    if (total <= 0) return null;
    const sorted = [...list].sort((a: any, b: any) => (b?.value ?? 0) - (a?.value ?? 0));
    const shares = sorted.map((t: any) => ({
      symbol: String(t.symbol ?? "—").toUpperCase(),
      value: t.value ?? 0,
      sharePct: ((t.value ?? 0) / total) * 100,
    }));
    // HHI on a 0-10000 scale (sum of squared % shares)
    const hhi = Math.round(shares.reduce((s, x) => s + x.sharePct * x.sharePct, 0));
    // Effective number of positions: 10000 / HHI
    const effective = hhi > 0 ? 10000 / hhi : 0;
    return { shares: shares.slice(0, 6), total, hhi, effective };
  }, [vaultTokens]);

  if (!data) {
    return (
      <Surface className="p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Concentration · HHI</p>
        <p className="mt-3 text-sm text-slate-400">Connect a wallet to see concentration.</p>
      </Surface>
    );
  }

  const verdict =
    data.hhi >= 5000 ? { label: "Highly concentrated", tone: "rose" as const } :
    data.hhi >= 2500 ? { label: "Concentrated", tone: "amber" as const } :
    data.hhi >= 1500 ? { label: "Moderate", tone: "violet" as const } :
                       { label: "Diversified", tone: "emerald" as const };

  // Simple flat radial gauge: HHI/10000 → arc length
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, data.hhi / 10000);

  return (
    <Surface className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Concentration</p>
          <h3 className="mt-1 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
            HHI {data.hhi.toLocaleString()}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Effective positions: {data.effective.toFixed(1)}
          </p>
        </div>
        <Pill tone={verdict.tone}>{verdict.label}</Pill>
      </div>

      <div className="mt-5 flex items-center gap-6">
        <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
          <circle cx="70" cy="70" r={radius} stroke="rgb(237 233 254)" strokeWidth="10" fill="none" />
          <motion.circle
            cx="70" cy="70" r={radius}
            stroke="rgb(124 58 237)"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
            transform="rotate(-90 70 70)"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - fraction) }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
          <text x="70" y="68" textAnchor="middle" className="fill-slate-900 font-manrope" fontSize="22" fontWeight="600">
            {((data.shares[0]?.sharePct ?? 0)).toFixed(0)}%
          </text>
          <text x="70" y="86" textAnchor="middle" className="fill-slate-500" fontSize="10">
            top asset
          </text>
        </svg>

        <ul className="flex-1 space-y-2">
          {data.shares.map((s, i) => (
            <StreamIn key={s.symbol} delay={0.04 * i}>
              <li className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-xs font-medium text-slate-700">{s.symbol}</span>
                <div className="relative h-2 flex-1 rounded-full bg-violet-50">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-violet-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, s.sharePct)}%` }}
                    transition={{ duration: 0.9, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-xs font-medium text-slate-600">
                  {s.sharePct.toFixed(1)}%
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] text-slate-400">
                  {fmtUsd(s.value)}
                </span>
              </li>
            </StreamIn>
          ))}
        </ul>
      </div>
    </Surface>
  );
}
