"use client";

import React, { useEffect, useState } from "react";
import { ArrowRightLeft, Download, FileText, Loader2 } from "lucide-react";
import { AdminMetricsPanel, MetricGrid, BreakdownList } from "./AdminMetricsPanel";
import { MetricCard } from "./MetricCard";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    Legend,
} from "recharts";

type Report = {
    rangeDays: number;
    generatedAt: string;
    totals: {
        onchain: { count: number; volume: number; fees?: number };
        dca: { count: number; volume: number };
        marketplace: { count: number; volume: number; fees?: number };
        allTxCount: number;
        allVolumeUsd: number;
        allFeesUsd: number;
    };
    byType: { type: string; count: number; volume: number }[];
    byChain: { chain: string; count: number; volume: number }[];
    byRouting: { programId: string; label: string; count: number; volume: number }[];
    monthly: { month: string; tx: number; txVol: number; dca: number; dcaVol: number; mp: number; mpVol: number }[];
};

const usd = (n: number) =>
    "$" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export function PlatformReportPanel() {
    const [range, setRange] = useState<7 | 30 | 90 | 365>(90);
    const [report, setReport] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);

    useEffect(() => {
        let cancel = false;
        setLoading(true);
        fetch(`/api/admin/platform-report?range=${range}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!cancel) setReport(j);
            })
            .finally(() => !cancel && setLoading(false));
        return () => {
            cancel = true;
        };
    }, [range]);

    const download = async (format: "csv" | "pdf") => {
        setDownloading(format);
        try {
            const res = await fetch(`/api/admin/platform-report?range=${range}&format=${format}`);
            if (!res.ok) throw new Error(await res.text());
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `dreyv-platform-report-${range}d.${format}`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setDownloading(null);
        }
    };

    return (
        <AdminMetricsPanel
            title="Transaction & volume report"
            icon={<ArrowRightLeft size={16} />}
            className="lg:col-span-4"
        >
            {/* controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="inline-flex rounded-xl border border-violet-200 bg-white p-1">
                    {[7, 30, 90, 365].map((d) => (
                        <button
                            key={d}
                            onClick={() => setRange(d as 7 | 30 | 90 | 365)}
                            className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition ${
                                range === d
                                    ? "bg-violet-600 text-white"
                                    : "text-slate-600 hover:text-violet-700"
                            }`}
                        >
                            {d === 365 ? "1y" : `${d}d`}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => download("csv")}
                        disabled={downloading !== null}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-violet-400 hover:text-violet-700 transition disabled:opacity-50"
                    >
                        {downloading === "csv" ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <Download size={12} />
                        )}
                        CSV
                    </button>
                    <button
                        onClick={() => download("pdf")}
                        disabled={downloading !== null}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50"
                    >
                        {downloading === "pdf" ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <FileText size={12} />
                        )}
                        Download PDF
                    </button>
                </div>
            </div>

            {loading && !report ? (
                <div className="py-10 flex items-center justify-center text-slate-500 text-[11px] uppercase tracking-[0.16em] font-semibold">
                    <Loader2 size={14} className="animate-spin mr-2 text-violet-600" />
                    Aggregating platform activity…
                </div>
            ) : !report ? (
                <div className="py-6 text-center text-[11px] text-slate-500">
                    Failed to load report.
                </div>
            ) : (
                <>
                    <MetricGrid cols={4}>
                        <MetricCard title="Total transactions" value={report.totals.allTxCount} />
                        <MetricCard
                            title="Total volume routed"
                            value={report.totals.allVolumeUsd}
                            formatter={(v) => usd(v)}
                        />
                        <MetricCard
                            title="Platform fees"
                            value={report.totals.allFeesUsd}
                            formatter={(v) => usd(v)}
                        />
                        <MetricCard
                            title="On-chain TXs"
                            value={report.totals.onchain.count}
                            trend={{
                                value: Math.round(report.totals.onchain.volume),
                                prefix: "$",
                                subtext: "volume",
                            }}
                        />
                    </MetricGrid>

                    {/* monthly chart */}
                    <div className="mt-3 p-4 rounded-2xl border border-violet-100 bg-white">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500">
                                Monthly volume routed (USD)
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                                last {range}d
                            </span>
                        </div>
                        <div className="h-[220px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={report.monthly}>
                                    <CartesianGrid stroke="#ede9fe" strokeDasharray="3 3" />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} />
                                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: number) => usd(v)} />
                                    <Tooltip
                                        formatter={(v: number) => usd(v)}
                                        contentStyle={{
                                            borderRadius: 12,
                                            border: "1px solid #ddd6fe",
                                            fontSize: 11,
                                        }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: 10 }} />
                                    <Line
                                        type="monotone"
                                        dataKey="txVol"
                                        name="On-chain"
                                        stroke="#7c3aed"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="dcaVol"
                                        name="DCA"
                                        stroke="#a78bfa"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="mpVol"
                                        name="Marketplace"
                                        stroke="#0ea5e9"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* breakdowns */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                By type
                            </span>
                            <BreakdownList
                                items={report.byType.slice(0, 6).map((r, i) => ({
                                    label: r.type,
                                    value: r.count,
                                    color: i === 0 ? "#7c3aed" : "#a78bfa",
                                }))}
                                valueFormatter={(v, item) => {
                                    const found = report.byType.find((x) => x.count === v);
                                    return `${v} · ${usd(found?.volume ?? 0)}`;
                                }}
                            />
                        </div>
                        <div className="p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                By chain
                            </span>
                            <BreakdownList
                                items={report.byChain.map((r) => ({
                                    label: r.chain,
                                    value: r.count,
                                    color: "#7c3aed",
                                }))}
                                valueFormatter={(v) => {
                                    const found = report.byChain.find((x) => x.count === v);
                                    return `${v} · ${usd(found?.volume ?? 0)}`;
                                }}
                            />
                        </div>
                        <div className="p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                By routing (top programs)
                            </span>
                            <BreakdownList
                                items={report.byRouting.slice(0, 6).map((r, i) => ({
                                    label: r.label,
                                    value: r.count,
                                    color: i === 0 ? "#7c3aed" : "#a78bfa",
                                }))}
                                valueFormatter={(v) => {
                                    const found = report.byRouting.find((x) => x.count === v);
                                    return `${v} · ${usd(found?.volume ?? 0)}`;
                                }}
                            />
                        </div>
                    </div>
                </>
            )}
        </AdminMetricsPanel>
    );
}
