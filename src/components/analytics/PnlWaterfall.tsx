"use client";

/**
 * PnL waterfall — daily inflow / outflow / yield / fee bars across the
 * selected window. Reads /api/treasury/pnl-daily (MV-backed with raw
 * fallback). Stitch-light aesthetic, framer-motion stream-in.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Surface, StreamIn } from "@/components/app-shell/primitives";

interface DayRow {
  day: string;
  inflow_usd: number;
  outflow_usd: number;
  yield_usd: number;
  fee_usd: number;
  net_usd: number;
  event_count: number;
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function PnlWaterfall({ wallet, range = "30d" }: { wallet: string | null; range?: string }) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    fetch(`/api/treasury/pnl-daily?wallet=${encodeURIComponent(wallet)}&range=${range}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => setDays(Array.isArray(j?.days) ? j.days : []))
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [wallet, range]);

  if (!wallet) {
    return (
      <Surface className="p-7">
        <p className="text-sm text-slate-500">Connect a wallet to see your daily PnL.</p>
      </Surface>
    );
  }

  if (!loading && days.length === 0) {
    return (
      <Surface className="p-7">
        <p className="text-sm text-slate-500">
          No treasury events tagged yet. Record an inflow or outflow on the treasury page to start
          building your daily PnL waterfall.
        </p>
      </Surface>
    );
  }

  // Find the largest absolute bar height across all days for scaling.
  const maxAbs = Math.max(
    1,
    ...days.map((d) => Math.max(d.inflow_usd, d.outflow_usd, d.yield_usd, d.fee_usd, Math.abs(d.net_usd))),
  );

  const totalInflow = days.reduce((s, d) => s + d.inflow_usd, 0);
  const totalOutflow = days.reduce((s, d) => s + d.outflow_usd, 0);
  const totalYield = days.reduce((s, d) => s + d.yield_usd, 0);
  const totalFee = days.reduce((s, d) => s + d.fee_usd, 0);
  const totalNet = totalInflow - totalOutflow + totalYield - totalFee;

  return (
    <Surface className="p-7">
      <div className="flex items-baseline justify-between">
        <h3 className="font-manrope text-lg font-semibold text-slate-900">Daily PnL</h3>
        <span className="text-xs text-slate-500">{days.length} days · last {range}</span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 text-[11px] uppercase tracking-[0.16em]">
        <Stat tone="violet" label="Inflow" value={fmtCompact(totalInflow)} />
        <Stat tone="amber" label="Outflow" value={fmtCompact(totalOutflow)} />
        <Stat tone="ink" label="Yield" value={fmtCompact(totalYield)} />
        <Stat tone="slate" label="Fees" value={fmtCompact(totalFee)} />
      </div>

      <div className="mt-6 flex h-44 items-end gap-[3px] overflow-x-auto pb-2">
        {days.map((d, i) => {
          const total = d.inflow_usd + d.outflow_usd + d.yield_usd + d.fee_usd;
          if (total === 0) return <div key={d.day} className="w-2 flex-shrink-0" />;
          const inH = (d.inflow_usd / maxAbs) * 100;
          const outH = (d.outflow_usd / maxAbs) * 100;
          const yH = (d.yield_usd / maxAbs) * 100;
          const fH = (d.fee_usd / maxAbs) * 100;
          return (
            <div
              key={d.day}
              title={`${d.day}\nInflow: ${fmtCompact(d.inflow_usd)}\nOutflow: ${fmtCompact(d.outflow_usd)}\nYield: ${fmtCompact(d.yield_usd)}\nFees: ${fmtCompact(d.fee_usd)}`}
              className="flex w-2 flex-shrink-0 flex-col-reverse items-stretch gap-px"
            >
              {d.inflow_usd > 0 && <Bar h={inH} color="bg-violet-600" delay={i * 0.012} />}
              {d.yield_usd > 0 && <Bar h={yH} color="bg-slate-900" delay={i * 0.012 + 0.04} />}
              {d.outflow_usd > 0 && <Bar h={outH} color="bg-amber-400" delay={i * 0.012 + 0.08} />}
              {d.fee_usd > 0 && <Bar h={fH} color="bg-slate-300" delay={i * 0.012 + 0.12} />}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t border-violet-100 pt-4">
        <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Net over window</span>
        <span
          className={`font-manrope text-xl font-semibold tabular-nums ${
            totalNet >= 0 ? "text-violet-700" : "text-amber-700"
          }`}
        >
          {totalNet >= 0 ? "+" : ""}
          {fmtCompact(totalNet)}
        </span>
      </div>
    </Surface>
  );
}

function Bar({ h, color, delay }: { h: number; color: string; delay: number }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: `${Math.max(2, h)}%`, opacity: 1 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`${color} w-full rounded-[2px]`}
    />
  );
}

function Stat({ tone, label, value }: { tone: "emerald" | "rose" | "violet" | "slate"; label: string; value: string }) {
  const map: Record<string, string> = {
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    violet: "text-violet-700",
    slate: "text-slate-600",
  };
  return (
    <StreamIn>
      <div className="rounded-lg border border-violet-100 bg-white p-3">
        <div className={`text-[10px] font-semibold ${map[tone]}`}>{label}</div>
        <div className="mt-1 font-manrope text-base font-semibold tabular-nums text-slate-900">
          {value}
        </div>
      </div>
    </StreamIn>
  );
}
