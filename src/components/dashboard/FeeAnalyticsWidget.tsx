"use client";

import { useEffect, useState } from "react";
import { Receipt, TrendingDown, ArrowRight, Sparkles } from "lucide-react";
import { useVault } from "@/lib/contexts/VaultContext";
import { AppEventBus } from "@/lib/events";

interface FeeBreakdown {
    type: string;
    totalFees: number;
    count: number;
}

interface FeeAnalytics {
    address: string;
    months: number;
    transactionCount: number;
    totalFeeUsd: number;
    avgFeePerTx: number;
    byType: FeeBreakdown[];
    highestFee?: {
        feeUsd: number;
        type: string;
    } | null;
}

function formatUsd(n: number): string {
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
    if (n >= 1) return `$${n.toFixed(2)}`;
    if (n > 0) return `$${n.toFixed(4)}`;
    return "$0";
}

function prettyType(t: string): string {
    if (!t || t === "UNKNOWN") return "Other";
    return t
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FeeAnalyticsWidget() {
    const { activeVault } = useVault();
    const [data, setData] = useState<FeeAnalytics | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!activeVault) {
            setData(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const res = await fetch(
                    `/api/analytics/fees?address=${encodeURIComponent(activeVault)}&months=12`,
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (!cancelled) setData(json);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load fee history");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeVault]);

    if (!activeVault) {
        return (
            <div className="rounded-2xl border border-violet-100 bg-white p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                    <Receipt className="h-3.5 w-3.5" />
                    Historical Fees
                </div>
                <p className="mt-3 text-sm text-slate-500">
                    Connect a vault address to see how much you've spent on fees in the last year — and where Dreyv can save you money.
                </p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-2xl border border-violet-100 bg-white p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                    <Receipt className="h-3.5 w-3.5" />
                    Historical Fees
                </div>
                <p className="mt-3 text-sm text-slate-500">Analysing the last 12 months of transactions…</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">
                    <Receipt className="h-3.5 w-3.5" />
                    Historical Fees
                </div>
                <p className="mt-3 text-sm text-rose-600">{error ?? "No fee data available."}</p>
            </div>
        );
    }

    const top5 = data.byType.slice(0, 5);
    const totalFees = data.totalFeeUsd;
    const txCount = data.transactionCount;

    return (
        <div className="rounded-2xl border border-violet-100 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                        <Receipt className="h-3.5 w-3.5" />
                        Fees · last 12 months
                    </div>
                    <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 tabular-nums">
                        {formatUsd(totalFees)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                        across <span className="font-semibold text-slate-700">{txCount.toLocaleString()}</span> transactions
                        {" · "}avg {formatUsd(data.avgFeePerTx)}/tx
                    </p>
                </div>
                <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                    <TrendingDown className="h-5 w-5" />
                </div>
            </div>

            {top5.length > 0 && (
                <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Top fee categories
                    </p>
                    <ul className="mt-2 space-y-1.5">
                        {top5.map((row) => {
                            const pct = totalFees > 0 ? (row.totalFees / totalFees) * 100 : 0;
                            return (
                                <li key={row.type} className="flex items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            <span className="truncate font-semibold text-slate-700">{prettyType(row.type)}</span>
                                            <span className="tabular-nums text-slate-500">
                                                {formatUsd(row.totalFees)}
                                                <span className="ml-1 text-[10px] text-slate-400">({row.count})</span>
                                            </span>
                                        </div>
                                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                                            <div
                                                className="h-full rounded-full bg-violet-400"
                                                style={{ width: `${Math.min(100, pct)}%` }}
                                            />
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <button
                onClick={() =>
                    AppEventBus.emit("AGENT_COMMAND", {
                        command: `Analyse the ${formatUsd(totalFees)} I spent on fees over the last 12 months and show me where I can save by routing through Dreyv.`,
                        source: "FeeAnalyticsWidget",
                    })
                }
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
            >
                <Sparkles className="h-3.5 w-3.5" />
                Use Dreyv to minimize your next fees
                <ArrowRight className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
