"use client";

/**
 * FeesBreakdown — flat fee analytics card.
 * Splits attribution.feeUsd into network vs protocol if metadata available
 * via events; falls back to total fees only. Animates the bar fills.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Surface, Pill, StreamingNumber, StreamIn } from "@/components/app-shell/primitives";

interface EventRow {
  category?: string;
  feeUsd?: number | string;
  amountUsd?: number | string;
  type?: string;
}

interface Props {
  events: EventRow[] | null;
  totalFeeUsd: number;
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function FeesBreakdown({ events, totalFeeUsd }: Props) {
  const split = useMemo(() => {
    if (!events || events.length === 0) {
      return { network: totalFeeUsd, protocol: 0, byCounterparty: [] as { name: string; usd: number }[] };
    }
    let network = 0;
    let protocol = 0;
    const map = new Map<string, number>();
    for (const e of events) {
      const fee = Number(e.feeUsd ?? 0);
      if (!Number.isFinite(fee) || fee <= 0) continue;
      const cat = String(e.category ?? "").toLowerCase();
      if (cat.includes("protocol") || cat.includes("swap") || cat.includes("bridge")) {
        protocol += fee;
      } else {
        network += fee;
      }
      const key = String(e.type ?? cat ?? "other");
      map.set(key, (map.get(key) ?? 0) + fee);
    }
    const byCounterparty = [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, usd]) => ({ name, usd }));
    if (network + protocol === 0 && totalFeeUsd > 0) network = totalFeeUsd;
    return { network, protocol, byCounterparty };
  }, [events, totalFeeUsd]);

  const total = split.network + split.protocol;
  const networkPct = total > 0 ? (split.network / total) * 100 : 0;
  const protocolPct = total > 0 ? (split.protocol / total) * 100 : 0;

  return (
    <Surface className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Fees · 30d</p>
          <h3 className="mt-1 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
            <StreamingNumber value={total} prefix="$" decimals={total < 100 ? 2 : 0} />
          </h3>
          <p className="mt-1 text-xs text-slate-500">All-in fee load on your treasury.</p>
        </div>
        {total === 0
          ? <Pill tone="emerald">No fees</Pill>
          : <Pill tone={total > 1000 ? "amber" : "violet"}>{networkPct.toFixed(0)}% network</Pill>}
      </div>

      {total > 0 && (
        <>
          <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-violet-50">
            <motion.div
              className="h-full bg-violet-500"
              style={{ float: "left" }}
              initial={{ width: 0 }}
              animate={{ width: `${networkPct}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              className="h-full bg-violet-300"
              initial={{ width: 0 }}
              animate={{ width: `${protocolPct}%` }}
              transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" />Network · {fmtUsd(split.network)}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-300 align-middle" />Protocol · {fmtUsd(split.protocol)}</span>
          </div>

          {split.byCounterparty.length > 0 && (
            <div className="mt-5 border-t border-violet-100 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top fee categories</p>
              <ul className="mt-2 space-y-1.5">
                {split.byCounterparty.map((c, i) => (
                  <StreamIn key={c.name} delay={0.05 * i}>
                    <li className="flex items-center justify-between text-xs">
                      <span className="text-slate-700">{c.name}</span>
                      <span className="font-medium text-slate-900">{fmtUsd(c.usd)}</span>
                    </li>
                  </StreamIn>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Surface>
  );
}
