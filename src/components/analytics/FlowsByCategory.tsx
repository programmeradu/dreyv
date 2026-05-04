"use client";

/**
 * FlowsByCategory (compact) — net flow + top categories as paired mini-bars.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CompactCard, EmptyMicro } from "./CompactCard";
import { SignalBadge, severityFromScore } from "./SignalBadge";

interface EventRow { category?: string; type?: string; amountUsd?: number | string }
interface Props { events: EventRow[] | null }

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

export function FlowsByCategory({ events }: Props) {
  const data = useMemo(() => {
    if (!events || events.length === 0) return null;
    const map = new Map<string, { inflow: number; outflow: number }>();
    let totalIn = 0, totalOut = 0;
    for (const e of events) {
      const cat = String(e.category ?? e.type ?? "other").toLowerCase();
      const amt = Number(e.amountUsd ?? 0);
      if (!Number.isFinite(amt)) continue;
      const cur = map.get(cat) ?? { inflow: 0, outflow: 0 };
      if (amt >= 0) { cur.inflow += amt; totalIn += amt; }
      else { cur.outflow += -amt; totalOut += -amt; }
      map.set(cat, cur);
    }
    const rows = [...map.entries()]
      .map(([name, v]) => ({ name, ...v, gross: v.inflow + v.outflow, net: v.inflow - v.outflow }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 3);
    return { rows, net: totalIn - totalOut };
  }, [events]);

  return (
    <CompactCard
      eyebrow="Flows · 30d"
      badge={data ? <SignalBadge severity={severityFromScore(data.net >= 0 ? 0.15 : 0.55)}>{data.net >= 0 ? "Net in" : "Net out"}</SignalBadge> : undefined}
      headline={data ? `${data.net >= 0 ? "+" : "-"}${fmtUsd(Math.abs(data.net))}` : "—"}
      subline={data ? `${data.rows.length} categories tracked` : "Tag events to group flows."}
    >
      {data ? (
        <ul className="flex h-full w-full flex-col justify-end gap-1.5">
          {data.rows.map((r, i) => {
            const max = Math.max(r.inflow, r.outflow, 1);
            return (
              <li key={r.name} className="flex items-center gap-2">
                <span className="w-14 truncate text-[10px] font-medium text-slate-700">{r.name}</span>
                <div className="grid flex-1 grid-cols-2 gap-1">
                  <div className="relative h-1.5 rounded-full bg-violet-50">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-violet-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${(r.inflow / max) * 100}%` }}
                      transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className="relative h-1.5 rounded-full bg-amber-50">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-amber-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${(r.outflow / max) * 100}%` }}
                      transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyMicro label="Awaiting tagged events" />
      )}
    </CompactCard>
  );
}
