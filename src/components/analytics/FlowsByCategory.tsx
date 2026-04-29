"use client";

/**
 * FlowsByCategory — flat category breakdown of inflows vs outflows
 * derived from /api/treasury/events.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Surface, Pill, StreamIn } from "@/components/app-shell/primitives";

interface EventRow {
  category?: string;
  type?: string;
  amountUsd?: number | string;
}
interface Props { events: EventRow[] | null }

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function FlowsByCategory({ events }: Props) {
  const rows = useMemo(() => {
    if (!events || events.length === 0) return null;
    const map = new Map<string, { inflow: number; outflow: number }>();
    for (const e of events) {
      const cat = String(e.category ?? e.type ?? "other").toLowerCase();
      const amt = Number(e.amountUsd ?? 0);
      if (!Number.isFinite(amt)) continue;
      const cur = map.get(cat) ?? { inflow: 0, outflow: 0 };
      if (amt >= 0) cur.inflow += amt;
      else cur.outflow += -amt;
      map.set(cat, cur);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v, net: v.inflow - v.outflow, gross: v.inflow + v.outflow }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 6);
  }, [events]);

  return (
    <Surface className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Flows · by category</p>
          <h3 className="mt-1 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
            Where money moved
          </h3>
        </div>
        {rows && <Pill tone="slate">{rows.length} categories</Pill>}
      </div>

      {!rows || rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          Tag your first treasury events to see them grouped here.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((r, i) => {
            const max = Math.max(r.inflow, r.outflow, 1);
            return (
              <StreamIn key={r.name} delay={0.05 * i}>
                <li>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    <span className={r.net >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {r.net >= 0 ? "+" : "-"}{fmtUsd(Math.abs(r.net))}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <div className="relative h-2 rounded-full bg-emerald-50" title={`Inflow ${fmtUsd(r.inflow)}`}>
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${(r.inflow / max) * 100}%` }}
                        transition={{ duration: 0.8, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                    <div className="relative h-2 rounded-full bg-rose-50" title={`Outflow ${fmtUsd(r.outflow)}`}>
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full bg-rose-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${(r.outflow / max) * 100}%` }}
                        transition={{ duration: 0.8, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>
                </li>
              </StreamIn>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
