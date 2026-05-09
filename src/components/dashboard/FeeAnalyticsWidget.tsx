"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { useVault } from "@/lib/contexts/VaultContext";

interface FeeBreakdown {
    type: string;
    totalFees: number;
    count: number;
}

interface DailyFee {
    date: string;
    totalFees: number;
}

interface FeeAnalytics {
    address: string;
    months: number;
    transactionCount: number;
    totalFeeUsd: number;
    avgFeePerTx: number;
    byType: FeeBreakdown[];
    daily?: DailyFee[];
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

/** Soft sparkline of monthly fees — used as the micro-viz so the card matches
 * the analytics CompactCard family. SVG only, no chart library. */
function FeeSparkline({ daily }: { daily: DailyFee[] }) {
    const points = useMemo(() => {
        if (!daily?.length) return [];
        // Bucket into ~14 weekly points so the line breathes.
        const buckets: number[] = [];
        const size = Math.max(1, Math.ceil(daily.length / 14));
        for (let i = 0; i < daily.length; i += size) {
            const slice = daily.slice(i, i + size);
            const sum = slice.reduce((s, d) => s + d.totalFees, 0);
            buckets.push(sum);
        }
        return buckets;
    }, [daily]);

    if (points.length < 2) {
        return (
            <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-violet-100 text-[10px] text-slate-400">
                Not enough history yet
            </div>
        );
    }

    const W = 320;
    const H = 64;
    const max = Math.max(...points, 0.0001);
    const step = W / (points.length - 1);
    const path = points
        .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(H - (v / max) * (H - 6) - 3).toFixed(1)}`)
        .join(" ");
    const area = `${path} L ${W} ${H} L 0 ${H} Z`;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none" aria-hidden>
            <defs>
                <linearGradient id="feeArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill="url(#feeArea)" />
            <path d={path} fill="none" stroke="#7c3aed" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
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

    return (
        <Shell title="Fees · last 12 months">
            {!activeVault ? (
                <Body
                    headline="—"
                    subline="Connect a wallet to see how much you've spent on fees this year."
                />
            ) : loading ? (
                <Body headline="…" subline="Analysing the last 12 months of activity" />
            ) : error || !data ? (
                <Body headline="—" subline={error ?? "No fee data yet"} />
            ) : (
                <FeeBody data={data} />
            )}
        </Shell>
    );
}

function FeeBody({ data }: { data: FeeAnalytics }) {
    const top3 = data.byType.slice(0, 3);
    const total = data.totalFeeUsd;

    return (
        <>
            <div className="px-5 pb-3">
                <p className="font-manrope text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
                    {formatUsd(total)}
                </p>
                <p className="mt-1.5 line-clamp-1 text-[11px] text-slate-500">
                    across <span className="tabular-nums text-slate-700">{data.transactionCount.toLocaleString()}</span>
                    {" "}transactions · avg {formatUsd(data.avgFeePerTx)}/tx
                </p>
            </div>

            <div className="px-5">
                <div className="h-[68px] w-full">
                    <FeeSparkline daily={data.daily ?? []} />
                </div>
            </div>

            {top3.length > 0 && (
                <div className="mt-2 px-5">
                    <ul className="space-y-1.5">
                        {top3.map((row) => {
                            const pct = total > 0 ? (row.totalFees / total) * 100 : 0;
                            return (
                                <li key={row.type} className="flex items-center gap-3 text-[11px]">
                                    <span className="w-24 shrink-0 truncate font-medium text-slate-600">
                                        {prettyType(row.type)}
                                    </span>
                                    <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-violet-50">
                                        <span
                                            className="absolute inset-y-0 left-0 rounded-full bg-violet-500"
                                            style={{ width: `${Math.min(100, pct)}%` }}
                                        />
                                    </span>
                                    <span className="w-14 shrink-0 text-right tabular-nums text-slate-500">
                                        {formatUsd(row.totalFees)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <CTA
                label="Minimize next fees with Dreyv"
                command={`Analyse the ${formatUsd(total)} I spent on fees over the last 12 months and show me where I can save by routing through Dreyv.`}
                source="FeeAnalyticsWidget"
            />
        </>
    );
}

/* ─────────────────────────── shared shell ─────────────────────────── */

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white">
            <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-violet-300/20 blur-3xl" />
            <div className="flex items-center gap-1.5 px-5 pt-5 text-violet-700">
                <DreyvStar size={9} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                    {title}
                </span>
            </div>
            <div className="mt-3 flex flex-1 flex-col">{children}</div>
        </div>
    );
}

function Body({ headline, subline }: { headline: string; subline: string }) {
    return (
        <div className="flex flex-1 flex-col px-5 pb-5">
            <p className="font-manrope text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-300">
                {headline}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">{subline}</p>
        </div>
    );
}

function CTA({ label, href }: { label: string; href: string; command?: string; source?: string }) {
    return (
        <Link
            href={href}
            className="mt-auto inline-flex items-center justify-center gap-2 border-t border-violet-100 bg-violet-600 px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-violet-700"
        >
            {label}
            <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
    );
}
