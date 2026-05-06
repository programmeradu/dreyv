"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Coins, ExternalLink, TrendingUp } from "lucide-react";
import { AdminMetricsPanel } from "./AdminMetricsPanel";

type Range = "24h" | "7d" | "30d" | "90d";

interface DailyRow { day: string; fees: number; volume: number; tx: number; }
interface PayerRow { wallet_address: string; fees: number; volume: number; tx: number; last_at: string; }
interface OpRow { operation: string; fees: number; tx: number; }
interface RecentRow {
  fee_signature: string; parent_signature: string; wallet_address: string;
  operation: string | null; fee_usd: number; value_usd: number | null;
  source: string; created_at: string;
}

const usd = (n: number, frac = 2) =>
  "$" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: frac });

const shortWallet = (w: string) => (w?.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w || "—");

export function ProtocolFeesPanel({ takeRateBps = 5 }: { takeRateBps?: number }) {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<{
    daily: DailyRow[]; topPayers: PayerRow[]; byOperation: OpRow[]; recent: RecentRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/protocol-fees?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => { if (!cancelled) setData(j); })
      .catch(() => { if (!cancelled) setData({ daily: [], topPayers: [], byOperation: [], recent: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  const daily = data?.daily ?? [];
  const maxFee = useMemo(() => Math.max(1e-9, ...daily.map((d) => d.fees)), [daily]);
  const totalFees = useMemo(() => daily.reduce((s, d) => s + d.fees, 0), [daily]);
  const totalVol = useMemo(() => daily.reduce((s, d) => s + d.volume, 0), [daily]);

  const RangeBtn = ({ r }: { r: Range }) => (
    <button
      onClick={() => setRange(r)}
      className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] rounded-full border transition-colors ${
        range === r
          ? "bg-violet-600 text-white border-violet-600"
          : "bg-white text-slate-600 border-violet-200 hover:border-violet-400 hover:text-violet-700"
      }`}
    >
      {r}
    </button>
  );

  return (
    <AdminMetricsPanel
      title="Protocol fees · Dreyv ledger"
      icon={<Coins size={16} />}
      className="lg:col-span-4"
      action={
        <div className="flex items-center gap-1.5">
          <RangeBtn r="24h" />
          <RangeBtn r="7d" />
          <RangeBtn r="30d" />
          <RangeBtn r="90d" />
        </div>
      }
    >
      {/* Executive strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ExecStat label={`Fees · ${range}`} value={usd(totalFees, 2)} accent />
        <ExecStat label={`Volume routed · ${range}`} value={usd(totalVol, 0)} />
        <ExecStat
          label="Effective take-rate"
          value={
            totalVol > 0
              ? `${((totalFees / totalVol) * 10_000).toFixed(2)} bps`
              : `${takeRateBps} bps`
          }
        />
        <ExecStat label="Unique payers" value={`${data?.topPayers.length ?? 0}`} />
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-violet-100 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500">
            Daily protocol fees
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700">
            <TrendingUp size={11} /> {daily.length} days
          </span>
        </div>
        {loading && !data ? (
          <div className="h-32 grid place-items-center text-[11px] text-slate-400">Loading…</div>
        ) : daily.length === 0 ? (
          <div className="h-32 grid place-items-center text-[11px] text-slate-400">
            No fees collected in this window yet.
          </div>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {daily.map((d) => {
              const h = Math.max(2, Math.round((d.fees / maxFee) * 100));
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group" title={`${d.day} · ${usd(d.fees, 4)} · ${d.tx} tx`}>
                  <div className="w-full rounded-t-md bg-violet-200 group-hover:bg-violet-500 transition-colors" style={{ height: `${h}%` }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top payers + by operation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-violet-100 bg-white p-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3">
            Top fee payers
          </div>
          {data?.topPayers.length ? (
            <div className="space-y-2">
              {data.topPayers.slice(0, 8).map((p) => (
                <div key={p.wallet_address} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-mono text-slate-700">{shortWallet(p.wallet_address)}</span>
                  <span className="text-slate-500">{p.tx} tx</span>
                  <span className="font-semibold text-violet-700 tabular-nums">{usd(p.fees, 4)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 py-4 text-center">No payers yet</div>
          )}
        </div>

        <div className="rounded-2xl border border-violet-100 bg-white p-4">
          <div className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3">
            Fees by operation
          </div>
          {data?.byOperation.length ? (
            <div className="space-y-2.5">
              {data.byOperation.map((o) => {
                const pct = totalFees > 0 ? Math.round((o.fees / totalFees) * 100) : 0;
                return (
                  <div key={o.operation} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-700 font-medium truncate">{o.operation}</span>
                      <span className="text-slate-900 font-semibold tabular-nums">{usd(o.fees, 4)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-violet-100 overflow-hidden">
                      <div className="h-full bg-violet-600" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 py-4 text-center">No operations yet</div>
          )}
        </div>
      </div>

      {/* Recent fees */}
      <div className="rounded-2xl border border-violet-100 bg-white p-4">
        <div className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3">
          Recent fee skims
        </div>
        {data?.recent.length ? (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {data.recent.map((r) => (
              <div key={r.fee_signature} className="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-violet-50 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-violet-700 text-[9px] font-semibold uppercase tracking-wider">
                    {r.operation || "—"}
                  </span>
                  <span className="font-mono text-slate-600 truncate">{shortWallet(r.wallet_address)}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {r.value_usd ? <span className="text-slate-500">{usd(r.value_usd, 0)}</span> : null}
                  <span className="font-semibold text-violet-700 tabular-nums">{usd(r.fee_usd, 4)}</span>
                  <a
                    href={`https://solscan.io/tx/${r.fee_signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-violet-700"
                    title="View on Solscan"
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 py-4 text-center">No recent fees</div>
        )}
      </div>
    </AdminMetricsPanel>
  );
}

function ExecStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${accent ? "border-violet-300 bg-violet-50/60" : "border-violet-100 bg-white"}`}>
      <div className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 truncate">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${accent ? "text-violet-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
