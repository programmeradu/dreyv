"use client";

/**
 * FeesBreakdown (compact) — total fee load + network/protocol split bar.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CompactCard, EmptyMicro } from "./CompactCard";
import { SignalBadge } from "./SignalBadge";

interface EventRow {
  category?: string; feeUsd?: number | string; type?: string;
}
interface Props { events: EventRow[] | null; totalFeeUsd: number }

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`;
  return `$${abs.toFixed(2)}`;
}

export function FeesBreakdown({ events, totalFeeUsd }: Props) {
  const split = useMemo(() => {
    if (!events || events.length === 0) {
      return { network: totalFeeUsd, protocol: 0 };
    }
    let network = 0, protocol = 0;
    for (const e of events) {
      const fee = Number(e.feeUsd ?? 0);
      if (!Number.isFinite(fee) || fee <= 0) continue;
      const cat = String(e.category ?? "").toLowerCase();
      if (cat.includes("protocol") || cat.includes("swap") || cat.includes("bridge")) protocol += fee;
      else network += fee;
    }
    if (network + protocol === 0 && totalFeeUsd > 0) network = totalFeeUsd;
    return { network, protocol };
  }, [events, totalFeeUsd]);

  const total = split.network + split.protocol;
  const networkPct = total > 0 ? (split.network / total) * 100 : 0;
  const protocolPct = total > 0 ? (split.protocol / total) * 100 : 0;

  return (
    <CompactCard
      eyebrow="Fees · 30d"
      badge={total === 0 ? <SignalBadge severity={0} label="Quiet" /> : <SignalBadge severity={severityFromScore(total > 1000 ? 0.6 : 0.25)}>{total > 1000 ? "Heavy" : "Light"}</SignalBadge>}
      headline={fmtUsd(total)}
      subline={total > 0 ? `${networkPct.toFixed(0)}% network · ${protocolPct.toFixed(0)}% protocol` : "Awaiting on-chain events."}
    >
      {total > 0 ? (
        <div className="flex h-full w-full flex-col justify-end gap-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-violet-50">
            <motion.div
              className="h-full bg-violet-600"
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
          <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
            <span>Network · {fmtUsd(split.network)}</span>
            <span>Protocol · {fmtUsd(split.protocol)}</span>
          </div>
        </div>
      ) : (
        <EmptyMicro label="No fees this window" />
      )}
    </CompactCard>
  );
}
