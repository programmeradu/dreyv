"use client";

/**
 * SmartExplorerClient — v2 of /v/[address].
 *
 * The smartest wallet explorer on Solana: AI narrative + archetype,
 * "What Dreyv would do" suggestions, PnL, performance, risk, counterparties,
 * activity timeline, NFTs, sibling wallets, token drill-in sheet, compare mode,
 * embed mode, and a sticky claim CTA — all powered by the existing /api/public/*
 * surface. Stitch-light violet aesthetic, flat surfaces, no gradients.
 *
 * SSR sends only the address. Each panel fetches independently and renders
 * progressively (skeletons → real data → AI refinement). No fabricated numbers.
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowRight,
    ArrowUpRight,
    Copy,
    ExternalLink,
    Loader2,
    Wallet,
    Shield,
    TrendingUp,
    Users,
    Layers,
    Activity,
    Bell,
    GitCompare,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TokenAvatar } from "@/components/TokenAvatar";
import { getProtocolLogo } from "@/lib/protocol-logos";
import { EdgeInsightsHero, EdgeInsightsGrid, useEdgeInsights } from "./EdgeInsightsPanel";

/* ──────────────────────────────────────────────────────────────────────── */
/* Types                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

interface FeaturePack {
    address: string;
    chain: string;
    ageDays: number | null;
    totalUsd: number;
    composition: Array<{ symbol: string; mint: string; pctUsd: number; usd: number; uiAmount: number }>;
    topProtocols: string[];
    delta30dPct: number | null;
    txCount30d: number;
    txCountPrev30d: number;
    uniqueCounterparties: number;
    isMultisig: boolean;
    signerCount: number;
    lastMeaningfulAction: { description: string; daysAgo: number } | null;
    archetype: string;
    archetypeConfidence: number;
    idle: { solUiAmount: number; usdcUiAmount: number; emptyTokenAccounts: number };
    topYields: Array<{ protocol: string; symbol: string; apy: number; riskTier: string }>;
}

interface Suggestion { title: string; detail: string; intent: string }
interface RiskFactor { label: string; weight: number; value: number; note: string }
interface PnlRow { mint: string; symbol: string; logo?: string; name?: string; uiAmount: number; currentPrice: number; currentValueUsd: number; avgEntry: number | null; pnlUsd: number | null; pnlPct: number | null }
interface PerfPoint { ts: number; value: number }
interface Counterparty { address: string; label: string; category: string | null; logoSlug?: string; count: number; solDelta: number }
interface ActivityItem { signature: string; timestamp: number; type: string; source?: string; description: string; protocol?: string }
interface NftCollection { groupId: string; name: string; count: number; thumbnails: string[] }
interface Sibling { address: string; confidence: number; reasons: string[] }

interface Props {
    address: string;
    compareAddress?: string;
    embed?: boolean;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

const fmtUsd = (n: number | null | undefined) => {
    if (n == null || !isFinite(n)) return "—";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
    return `$${n.toFixed(2)}`;
};
const fmtNum = (n: number) => n >= 1_000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const truncAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sinceDays = (ts: number) => Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86400));

function useFetchJson<T>(url: string | null, deps: React.DependencyList = []): { data: T | null; loading: boolean; error: string | null } {
    const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!url, error: null });
    useEffect(() => {
        if (!url) { setState({ data: null, loading: false, error: null }); return; }
        let cancelled = false;
        setState({ data: null, loading: true, error: null });
        fetch(url, { cache: "no-store" })
            .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
            .then((j) => { if (!cancelled) setState({ data: j, loading: false, error: null }); })
            .catch((e) => { if (!cancelled) setState({ data: null, loading: false, error: String(e) }); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return state;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Section primitives                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

function Section({ icon: Icon, title, subtitle, children, action, className = "" }: { icon?: React.ComponentType<{ size?: number; className?: string }>; title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
    return (
        <section className={`rounded-3xl border border-violet-100 bg-white p-6 sm:p-7 flex flex-col h-full ${className}`}>
            <div className="flex items-start justify-between gap-4 mb-5">
                <div className="flex items-start gap-3 min-w-0">
                    {Icon ? <Icon size={16} className="mt-0.5 text-violet-600 shrink-0" /> : <DreyvStar size={12} className="mt-1 text-violet-600 shrink-0" />}
                    <div className="min-w-0">
                        <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">{title}</h2>
                        {subtitle && <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>}
                    </div>
                </div>
                {action}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </section>
    );
}

function Skeleton({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded bg-violet-100/60 ${className}`} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Narrative + Archetype (streaming-feel via type-in)                        */
/* ──────────────────────────────────────────────────────────────────────── */

function NarrativeHeader({ address }: { address: string }) {
    const { data, loading } = useFetchJson<{ narrative?: string; archetype?: string; error?: string }>(`/api/public/narrative/${address}`, [address]);
    const [shown, setShown] = useState("");

    useEffect(() => {
        if (!data?.narrative) return;
        const full = data.narrative;
        let i = 0;
        const id = window.setInterval(() => {
            i = Math.min(full.length, i + 4);
            setShown(full.slice(0, i));
            if (i >= full.length) window.clearInterval(id);
        }, 18);
        return () => window.clearInterval(id);
    }, [data?.narrative]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 text-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
                    <DreyvStar size={10} className="text-white" />
                    {data?.archetype ? data.archetype.replace(/_/g, " ") : "Analyzing wallet"}
                </span>
                {loading && !data && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-violet-700">
                        <Loader2 size={11} className="animate-spin" /> Reading on-chain history
                    </span>
                )}
            </div>
            <div className="min-h-[72px]">
                {data?.narrative ? (
                    <p className="text-[15px] leading-relaxed text-slate-700">
                        {shown}
                        {shown.length < (data.narrative?.length ?? 0) && (
                            <span className="inline-block w-[6px] h-[14px] bg-violet-600 ml-0.5 align-middle animate-pulse" />
                        )}
                    </p>
                ) : loading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-[92%]" />
                        <Skeleton className="h-3 w-[76%]" />
                    </div>
                ) : (
                    <p className="text-[13px] text-slate-500">Narrative unavailable — connect to view the full report.</p>
                )}
            </div>
        </div>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Suggestions ("What Dreyv would do")                                       */
/* ──────────────────────────────────────────────────────────────────────── */

function SuggestionsPanel({ address }: { address: string }) {
    const { data, loading } = useFetchJson<{ suggestions: Suggestion[] }>(`/api/public/suggestions/${address}`, [address]);
    const sugs = data?.suggestions ?? [];
    if (!loading && sugs.length === 0) return null;
    return (
        <Section icon={ArrowUpRight} title="What Dreyv would do" subtitle="Concrete moves grounded in this wallet's real on-chain state.">
            {loading ? (
                <div className="grid sm:grid-cols-3 gap-3">
                    {[0, 1, 2].map(i => <Skeleton key={i} className="h-32" />)}
                </div>
            ) : (
                <div className="grid sm:grid-cols-3 gap-3">
                    {sugs.map((s, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.08 }}
                            className="rounded-2xl border border-violet-100 bg-violet-50/30 p-4 flex flex-col"
                        >
                            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">{s.intent}</div>
                            <div className="mt-1.5 text-[14px] font-semibold text-slate-900 leading-snug">{s.title}</div>
                            <p className="mt-2 text-[12px] text-slate-600 leading-relaxed flex-1">{s.detail}</p>
                            <Link href={`/waitlist?from=v&addr=${address}&intent=${s.intent}`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700 hover:text-violet-900">
                                Act on this <ArrowRight size={11} />
                            </Link>
                        </motion.div>
                    ))}
                </div>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Holdings with PnL                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

function HoldingsPanel({ address, onPickToken }: { address: string; onPickToken: (mint: string, symbol: string) => void }) {
    const { data, loading } = useFetchJson<{ rows: PnlRow[] }>(`/api/public/pnl/${address}`, [address]);
    const rows = data?.rows ?? [];
    return (
        <Section icon={Layers} title="Holdings" subtitle={rows.length ? `${rows.length} positions · click a row for the token sheet` : "Token positions"}>
            {loading ? (
                <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
            ) : rows.length === 0 ? (
                <p className="text-[13px] text-slate-500">No fungible holdings detected.</p>
            ) : (
                <div className="divide-y divide-violet-50">
                    {rows.slice(0, 12).map((r) => (
                        <button
                            key={r.mint}
                            onClick={() => onPickToken(r.mint, r.symbol)}
                            className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-violet-50/40 px-2 -mx-2 rounded-lg transition"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <TokenAvatar symbol={r.symbol} mint={r.mint} size={28} />
                                <div className="min-w-0">
                                    <div className="text-[13px] font-semibold text-slate-900 truncate">{r.symbol}</div>
                                    <div className="text-[11px] text-slate-500 font-mono">{fmtNum(r.uiAmount)}</div>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-[13px] font-semibold text-slate-900">{fmtUsd(r.currentValueUsd)}</div>
                                <div className="text-[11px] text-slate-500">{r.currentPrice > 0 ? `@ ${fmtUsd(r.currentPrice)}` : "no price"}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Composition donut (pure SVG)                                              */
/* ──────────────────────────────────────────────────────────────────────── */

function CompositionDonut({ pack }: { pack: FeaturePack | null }) {
    if (!pack) return <Skeleton className="h-48" />;
    const slices = pack.composition.slice(0, 8);
    if (slices.length === 0) return <p className="text-[13px] text-slate-500">No composition data.</p>;
    const palette = ["#7c3aed", "#a78bfa", "#c4b5fd", "#8b5cf6", "#6d28d9", "#ddd6fe", "#5b21b6", "#ede9fe"];
    let acc = 0;
    const r = 56, cx = 70, cy = 70, stroke = 16;
    const C = 2 * Math.PI * r;
    return (
        <div className="flex items-center gap-6">
            <svg width={140} height={140} viewBox="0 0 140 140" className="shrink-0">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f5f3ff" strokeWidth={stroke} />
                {slices.map((s, i) => {
                    const len = C * s.pctUsd;
                    const dash = `${len} ${C - len}`;
                    const offset = C * (1 - acc);
                    acc += s.pctUsd;
                    return <circle key={s.mint} cx={cx} cy={cy} r={r} fill="none" stroke={palette[i % palette.length]} strokeWidth={stroke} strokeDasharray={dash} strokeDashoffset={offset} transform={`rotate(-90 ${cx} ${cy})`} />;
                })}
                <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-900 text-[14px] font-semibold">{fmtUsd(pack.totalUsd)}</text>
                <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-500 text-[9px] uppercase tracking-[0.14em]">Net worth</text>
            </svg>
            <div className="flex-1 space-y-1.5 min-w-0">
                {slices.map((s, i) => (
                    <div key={s.mint} className="flex items-center justify-between gap-2 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: palette[i % palette.length] }} />
                            <span className="truncate font-medium text-slate-700">{s.symbol}</span>
                        </div>
                        <span className="text-slate-500 font-mono">{(s.pctUsd * 100).toFixed(1)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Performance chart                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

function PerformanceChart({ address }: { address: string }) {
    const [range, setRange] = useState<30 | 90 | 365>(30);
    const { data, loading } = useFetchJson<{ series: PerfPoint[]; bench: PerfPoint[]; totalUsd: number; approximated?: boolean }>(`/api/public/performance/${address}?range=${range}`, [address, range]);

    const path = useMemo(() => {
        if (!data?.series?.length) return { line: "", bench: "", change: 0 };
        const s = data.series;
        const b = data.bench ?? [];
        const min = Math.min(...s.map(p => p.value), ...(b.length ? b.map(p => p.value * (s[0].value / (b[0]?.value || 1))) : []));
        const max = Math.max(...s.map(p => p.value), ...(b.length ? b.map(p => p.value * (s[0].value / (b[0]?.value || 1))) : []));
        const W = 600, H = 140;
        const norm = (v: number) => H - 8 - ((v - min) / Math.max(1e-9, max - min)) * (H - 16);
        const xStep = W / Math.max(1, s.length - 1);
        const line = s.map((p, i) => `${i === 0 ? "M" : "L"}${(i * xStep).toFixed(1)},${norm(p.value).toFixed(1)}`).join(" ");
        const scale = b.length ? (s[0].value / (b[0]?.value || 1)) : 1;
        const bench = b.length ? b.map((p, i) => `${i === 0 ? "M" : "L"}${(i * xStep).toFixed(1)},${norm(p.value * scale).toFixed(1)}`).join(" ") : "";
        const change = s.length > 1 ? ((s[s.length - 1].value - s[0].value) / Math.max(1e-9, s[0].value)) * 100 : 0;
        return { line, bench, change };
    }, [data]);

    return (
        <Section
            icon={TrendingUp}
            title="Performance"
            subtitle={data?.approximated ? "Approximated from current balances × historical SOL price" : "USD value reconstructed from on-chain history"}
            action={
                <div className="inline-flex rounded-lg border border-violet-100 p-0.5">
                    {([30, 90, 365] as const).map(r => (
                        <button key={r} onClick={() => setRange(r)} className={range === r ? "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-violet-600 text-white" : "px-2.5 py-1 text-[11px] font-semibold rounded-md text-slate-600 hover:text-violet-700"}>{r}d</button>
                    ))}
                </div>
            }
        >
            {loading ? (
                <Skeleton className="h-36" />
            ) : !path.line ? (
                <p className="text-[13px] text-slate-500">Not enough price history.</p>
            ) : (
                <div>
                    <div className="flex items-baseline gap-3 mb-3">
                        <div className="text-2xl font-semibold text-slate-900">{fmtUsd(data?.totalUsd ?? 0)}</div>
                        <div className={`text-[12px] font-semibold ${path.change >= 0 ? "text-violet-700" : "text-slate-500"}`}>
                            {path.change >= 0 ? "+" : ""}{path.change.toFixed(2)}% · {range}d
                        </div>
                    </div>
                    <svg viewBox="0 0 600 140" className="w-full h-36">
                        {path.bench && <path d={path.bench} stroke="#c4b5fd" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />}
                        <path d={path.line} stroke="#7c3aed" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="mt-2 flex items-center gap-4 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-violet-600" /> This wallet</span>
                        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-violet-300" /> SOL benchmark</span>
                    </div>
                </div>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Risk & Hygiene — sophisticated multi-category profile + radar             */
/* ──────────────────────────────────────────────────────────────────────── */

type RiskStatus = "pass" | "warn" | "fail" | "info";
interface RiskCheckUI {
    id: string;
    category: "custody" | "diversification" | "counterparty" | "activity" | "approvals";
    title: string;
    status: RiskStatus;
    note: string;
    evidence?: string[];
    weight: number;
}
interface RiskCategoryUI {
    category: RiskCheckUI["category"];
    label: string;
    score: number;
    status: RiskStatus;
    summary: string;
}
interface RiskResponseUI {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    headline: string;
    categories: RiskCategoryUI[];
    checks: RiskCheckUI[];
}

const STATUS_TONE: Record<RiskStatus, { star: string; pill: string; text: string }> = {
    pass: { star: "text-violet-300", pill: "bg-white text-violet-700 border-violet-200", text: "text-violet-700" },
    warn: { star: "text-violet-600", pill: "bg-violet-50 text-violet-800 border-violet-300", text: "text-violet-800" },
    fail: { star: "text-white", pill: "bg-violet-600 text-white border-violet-700", text: "text-violet-900" },
    info: { star: "text-violet-400", pill: "bg-violet-50/60 text-violet-700 border-violet-100", text: "text-violet-700" },
};

function RiskRadar({ cats }: { cats: RiskCategoryUI[] }) {
    // Pentagon radar — 5 categories
    const size = 220;
    const cx = size / 2;
    const cy = size / 2;
    const r = 84;
    const n = cats.length || 5;
    const angle = (i: number) => (-Math.PI / 2) + (i * 2 * Math.PI) / n;
    const pt = (i: number, mag: number) => {
        const a = angle(i);
        return [cx + Math.cos(a) * r * mag, cy + Math.sin(a) * r * mag] as const;
    };
    const grid = [0.25, 0.5, 0.75, 1].map((m) =>
        cats.map((_, i) => pt(i, m).join(",")).join(" "),
    );
    const dataPath = cats.map((c, i) => pt(i, Math.max(0.05, c.score / 100)).join(",")).join(" ");

    return (
        <svg viewBox={`-40 -14 ${size + 80} ${size + 28}`} className="w-full max-w-[280px] h-auto overflow-visible">
            {grid.map((g, i) => (
                <polygon key={i} points={g} fill="none" stroke="hsl(263 70% 91%)" strokeWidth={1} />
            ))}
            {cats.map((_, i) => {
                const [x, y] = pt(i, 1);
                return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="hsl(263 70% 94%)" strokeWidth={1} />;
            })}
            <polygon points={dataPath} fill="hsl(263 90% 60% / 0.18)" stroke="hsl(263 90% 55%)" strokeWidth={1.5} />
            {cats.map((c, i) => {
                const [x, y] = pt(i, 1.18);
                const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
                return (
                    <g key={c.category}>
                        <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className="text-[9px] fill-slate-600 font-semibold uppercase tracking-[0.12em]">
                            {c.label.split(" ")[0]}
                        </text>
                        <text x={x} y={y + 11} textAnchor={anchor} dominantBaseline="middle" className="text-[10px] fill-violet-700 font-bold">
                            {c.score}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function RiskPanel({ address }: { address: string }) {
    const { data, loading } = useFetchJson<RiskResponseUI>(`/api/public/risk/${address}`, [address]);
    const [expanded, setExpanded] = useState(false);

    if (loading) {
        return (
            <Section icon={Shield} title="Risk & hygiene" subtitle="Custody, diversification, counterparties, activity, approvals.">
                <Skeleton className="h-64" />
            </Section>
        );
    }
    if (!data) {
        return (
            <Section icon={Shield} title="Risk & hygiene"><p className="text-[13px] text-slate-500">Risk profile unavailable.</p></Section>
        );
    }

    const counts = data.checks.reduce(
        (acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc; },
        { pass: 0, warn: 0, fail: 0, info: 0 } as Record<RiskStatus, number>,
    );
    const topIssue = data.checks.find((c) => c.status === "fail") || data.checks.find((c) => c.status === "warn");

    return (
        <Section
            icon={Shield}
            title="Risk & hygiene"
            subtitle={data.headline}
            action={
                <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">Overall</div>
                        <div className="text-[24px] font-semibold text-slate-900 leading-none">{data.score}<span className="text-[12px] text-slate-400">/100</span></div>
                    </div>
                    <div className="rounded-xl bg-violet-600 text-white px-3 py-1.5 text-[14px] font-bold">{data.grade}</div>
                </div>
            }
        >
            <div className="grid lg:grid-cols-[260px,1fr] gap-6 items-center">
                <div className="flex flex-col items-center justify-center">
                    <RiskRadar cats={data.categories} />
                </div>
                <div className="space-y-3">
                    {/* Compact summary chips: pass/warn/fail counts (brand violet only, DreyvStar glyph) */}
                    <div className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-white text-violet-700 border-violet-200">
                            <DreyvStar size={10} className="text-violet-300" />{counts.pass} passing
                        </span>
                        {counts.warn > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-violet-50 text-violet-800 border-violet-300">
                                <DreyvStar size={10} className="text-violet-600" />{counts.warn} watch
                            </span>
                        )}
                        {counts.fail > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-violet-600 text-white border-violet-700">
                                <DreyvStar size={10} className="text-white" />{counts.fail} critical
                            </span>
                        )}
                        {counts.info > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-violet-50/60 text-violet-700 border-violet-100">
                                <DreyvStar size={10} className="text-violet-400" />{counts.info} info
                            </span>
                        )}
                    </div>

                    {/* Headline insight under the chart */}
                    {topIssue ? (
                        <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-violet-700">Top focus</div>
                            <div className="mt-1 text-[13px] font-semibold text-slate-900">{topIssue.title}</div>
                            <p className="text-[12px] text-slate-600 leading-relaxed mt-0.5">{topIssue.note}</p>
                        </div>
                    ) : (
                        <p className="text-[13px] text-slate-600 leading-relaxed">
                            All {data.checks.length} hygiene checks look clean. Keep monitoring as activity grows.
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-violet-700 hover:text-violet-900"
                    >
                        {expanded ? "Hide details" : `View details (${data.checks.length})`}
                        <span className={`transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
                    </button>
                </div>
            </div>

            {expanded && (
                <ul className="mt-5 divide-y divide-violet-50 border-t border-violet-100 pt-3">
                    {data.checks.map((c) => {
                        const tone = STATUS_TONE[c.status];
                        return (
                            <li key={c.id} className="py-2.5 flex items-start gap-3">
                                <DreyvStar size={12} className={`mt-1 shrink-0 ${tone.star}`} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-[13px] font-semibold text-slate-900 truncate">{c.title}</div>
                                        <span className={`shrink-0 inline-block text-[9px] uppercase tracking-[0.16em] font-semibold border rounded-full px-2 py-0.5 ${tone.pill}`}>{c.status}</span>
                                    </div>
                                    <p className="text-[12px] text-slate-600 leading-relaxed mt-0.5">{c.note}</p>
                                    {c.evidence && c.evidence.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {c.evidence.filter(Boolean).slice(0, 4).map((ev, i) => (
                                                <span key={i} className="text-[10px] text-slate-500 bg-violet-50/60 border border-violet-100 rounded px-1.5 py-0.5">{ev}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Section>
    );
}


/* ──────────────────────────────────────────────────────────────────────── */
/* Counterparties (in/out)                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function CounterpartiesPanel({ address }: { address: string }) {
    const { data, loading } = useFetchJson<{ inbound: Counterparty[]; outbound: Counterparty[] }>(`/api/public/counterparties/${address}`, [address]);
    const Row = ({ c }: { c: Counterparty }) => (
        <Link href={`/v/${c.address}`} className="flex items-center justify-between gap-2 py-1.5 hover:bg-violet-50/40 px-2 -mx-2 rounded">
            <div className="flex items-center gap-2 min-w-0">
                {c.logoSlug ? (
                    <Image src={getProtocolLogo(c.logoSlug) || ""} alt="" width={20} height={20} className="rounded shrink-0" unoptimized />
                ) : (
                    <TokenAvatar symbol={c.label.slice(0, 3)} mint={c.address} size={20} />
                )}
                <span className="truncate text-[12px] text-slate-700 font-medium">{c.label}</span>
            </div>
            <div className="text-[11px] text-slate-500 font-mono shrink-0">{c.solDelta.toFixed(2)} SOL · {c.count}</div>
        </Link>
    );
    return (
        <Section icon={Users} title="Counterparties" subtitle="Top inflows and outflows from recent activity.">
            {loading ? <Skeleton className="h-40" /> : (
                <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700 mb-1">In</div>
                        {(data?.inbound ?? []).length === 0 ? <p className="text-[12px] text-slate-500">No inbound activity.</p> : data!.inbound.map(c => <Row key={c.address} c={c} />)}
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700 mb-1">Out</div>
                        {(data?.outbound ?? []).length === 0 ? <p className="text-[12px] text-slate-500">No outbound activity.</p> : data!.outbound.map(c => <Row key={c.address} c={c} />)}
                    </div>
                </div>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Activity timeline (semantic)                                              */
/* ──────────────────────────────────────────────────────────────────────── */

function ActivityPanel({ address }: { address: string }) {
    const { data, loading } = useFetchJson<{ items: ActivityItem[] }>(`/api/public/activity/${address}`, [address]);
    return (
        <Section icon={Activity} title="Recent activity" subtitle="Semantic timeline of meaningful actions.">
            {loading ? <Skeleton className="h-48" /> : (data?.items ?? []).length === 0 ? <p className="text-[13px] text-slate-500">No recent activity.</p> : (
                <ol className="relative pl-4 border-l border-violet-100 space-y-3">
                    {data!.items.slice(0, 12).map(it => {
                        const logo = it.protocol ? getProtocolLogo(it.protocol) : null;
                        return (
                            <li key={it.signature} className="relative">
                                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-sm bg-violet-600 rotate-45" />
                                <div className="flex items-start gap-2.5">
                                    {logo ? <Image src={logo} alt="" width={18} height={18} className="rounded mt-0.5 shrink-0" unoptimized /> : <span className="inline-flex items-center justify-center h-[18px] w-[18px] rounded bg-violet-50 text-[8px] font-semibold text-violet-700 mt-0.5 shrink-0">{(it.source || it.type).slice(0, 2).toUpperCase()}</span>}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[12px] text-slate-700 leading-snug">{it.description}</div>
                                        <div className="text-[10px] text-slate-500 mt-0.5">{sinceDays(it.timestamp)}d ago · <Link href={`https://solscan.io/tx/${it.signature}`} target="_blank" className="hover:text-violet-700 inline-flex items-center gap-1">tx <ExternalLink size={9} /></Link></div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* NFTs                                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

function NftsPanel({ address }: { address: string }) {
    const { data, loading } = useFetchJson<{ collections: NftCollection[] }>(`/api/public/nfts/${address}`, [address]);
    const cols = data?.collections ?? [];
    if (!loading && cols.length === 0) return null;
    return (
        <Section title="NFT collections" subtitle="Grouped by collection · floor pricing on the full app.">
            {loading ? <Skeleton className="h-36" /> : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {cols.slice(0, 8).map(c => (
                        <div key={c.groupId} className="rounded-xl border border-violet-100 p-2.5">
                            <div className="grid grid-cols-2 gap-1 mb-2">
                                {[0, 1, 2, 3].map(i => (
                                    <div key={i} className="aspect-square rounded bg-violet-50 overflow-hidden">
                                        {c.thumbnails[i] && <Image src={c.thumbnails[i]} alt="" width={64} height={64} className="w-full h-full object-cover" unoptimized />}
                                    </div>
                                ))}
                            </div>
                            <div className="text-[11px] font-semibold text-slate-900 truncate">{c.name}</div>
                            <div className="text-[10px] text-slate-500">{c.count} items</div>
                        </div>
                    ))}
                </div>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Siblings                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function SiblingsPanel({ address }: { address: string }) {
    const { data, loading } = useFetchJson<{ siblings: Sibling[] }>(`/api/public/siblings/${address}`, [address]);
    const s = data?.siblings ?? [];
    if (!loading && s.length === 0) return null;
    return (
        <Section icon={GitCompare} title="Likely linked wallets" subtitle="Heuristic: shared funder, multisig co-signing.">
            {loading ? <Skeleton className="h-20" /> : (
                <div className="flex flex-wrap gap-2">
                    {s.slice(0, 5).map(sib => (
                        <Link key={sib.address} href={`/v/${sib.address}`} className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50/40 px-3 py-1.5 text-[11px] font-mono text-slate-700 hover:border-violet-400">
                            {truncAddr(sib.address)}
                            <span className="text-[9px] uppercase tracking-[0.14em] text-violet-700">{Math.round(sib.confidence * 100)}%</span>
                        </Link>
                    ))}
                </div>
            )}
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Token drill-in sheet                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

function TokenSheet({ mint, symbol, onClose }: { mint: string; symbol: string; onClose: () => void }) {
    const { data, loading } = useFetchJson<Record<string, unknown>>(`/api/public/token/${mint}`, [mint]);
    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end"
                onClick={onClose}
            >
                <motion.aside
                    initial={{ x: 460 }}
                    animate={{ x: 0 }}
                    exit={{ x: 460 }}
                    transition={{ type: "spring", damping: 24, stiffness: 220 }}
                    onClick={e => e.stopPropagation()}
                    className="w-full max-w-md h-full bg-white p-6 overflow-y-auto border-l border-violet-100"
                >
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <TokenAvatar symbol={symbol} mint={mint} size={36} />
                            <div>
                                <div className="text-base font-semibold text-slate-900">{symbol}</div>
                                <div className="text-[10px] font-mono text-slate-500">{truncAddr(mint)}</div>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900">Close</button>
                    </div>
                    {loading ? (
                        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-32" /><Skeleton className="h-24" /></div>
                    ) : data ? (
                        <pre className="text-[11px] font-mono text-slate-700 bg-violet-50/40 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(data, null, 2)}</pre>
                    ) : (
                        <p className="text-[13px] text-slate-500">No token data available.</p>
                    )}
                    <Link href={`/waitlist?from=v&intent=swap&token=${mint}`} className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2 text-[11px] font-semibold text-white uppercase tracking-[0.08em]">
                        Trade {symbol} on Dreyv <ArrowRight size={11} />
                    </Link>
                </motion.aside>
            </motion.div>
        </AnimatePresence>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Stat strip                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

function StatStrip({ pack }: { pack: FeaturePack | null }) {
    const items = [
        { label: "Net worth", value: pack ? fmtUsd(pack.totalUsd) : "—", sub: pack?.delta30dPct != null ? `${pack.delta30dPct >= 0 ? "+" : ""}${pack.delta30dPct.toFixed(0)}% 30d activity` : "—" },
        { label: "Age", value: pack?.ageDays != null ? `${pack.ageDays}d` : "—", sub: "First on-chain action" },
        { label: "Counterparties", value: pack ? String(pack.uniqueCounterparties) : "—", sub: "Unique addresses" },
        { label: "Signers", value: pack ? `${pack.signerCount}${pack.isMultisig ? " · ms" : ""}` : "—", sub: pack?.isMultisig ? "Multisig protected" : "Single signer" },
    ];
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {items.map((s, i) => (
                <div key={i} className="rounded-2xl border border-violet-100 bg-white p-4">
                    <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-violet-700">{s.label}</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{s.value}</div>
                    <div className="text-[10px] text-slate-500 mt-1 truncate">{s.sub}</div>
                </div>
            ))}
        </div>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Compare strip                                                             */
/* ──────────────────────────────────────────────────────────────────────── */

function ComparePanel({ a, b }: { a: string; b: string }) {
    const packA = useFetchJson<FeaturePack>(`/api/public/feature-pack/${a}`, [a]);
    const packB = useFetchJson<FeaturePack>(`/api/public/feature-pack/${b}`, [b]);
    const rows: Array<[string, (p: FeaturePack | null) => React.ReactNode]> = [
        ["Net worth", p => p ? fmtUsd(p.totalUsd) : "—"],
        ["Archetype", p => p?.archetype.replace(/_/g, " ") ?? "—"],
        ["Age", p => p?.ageDays != null ? `${p.ageDays}d` : "—"],
        ["30d txs", p => p ? String(p.txCount30d) : "—"],
        ["Counterparties", p => p ? String(p.uniqueCounterparties) : "—"],
        ["Multisig", p => p ? (p.isMultisig ? "Yes" : "No") : "—"],
    ];
    return (
        <Section icon={GitCompare} title="Side-by-side compare" subtitle={`${truncAddr(a)} vs ${truncAddr(b)}`}>
            <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    <th className="font-medium pb-2">Metric</th>
                    <th className="font-medium pb-2">{truncAddr(a)}</th>
                    <th className="font-medium pb-2">{truncAddr(b)}</th>
                </tr></thead>
                <tbody className="divide-y divide-violet-50">
                    {rows.map(([label, get]) => (
                        <tr key={label}>
                            <td className="py-2 font-medium text-slate-600">{label}</td>
                            <td className="py-2 font-semibold text-slate-900">{get(packA.data)}</td>
                            <td className="py-2 font-semibold text-slate-900">{get(packB.data)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Section>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Claim CTA                                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

function ClaimCta({ address }: { address: string }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="fixed bottom-5 right-5 z-40 max-w-sm rounded-2xl border border-violet-200 bg-white shadow-lg shadow-violet-200/30 p-4"
        >
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">Your wallet?</div>
            <div className="mt-1 text-[13px] font-semibold text-slate-900">Claim this wallet on Dreyv</div>
            <p className="mt-1 text-[11px] text-slate-500">Auto-load history, set alerts, and run actions on it from your signed-in workspace.</p>
            <Link href={`/auth?claim=${address}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-[11px] font-semibold text-white uppercase tracking-[0.08em]">
                Claim <ArrowRight size={11} />
            </Link>
        </motion.div>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Main client                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export function SmartExplorerClient({ address, compareAddress, embed }: Props) {
    const { data: pack } = useFetchJson<FeaturePack>(`/api/public/feature-pack/${address}`, [address]);
    const edge = useEdgeInsights(address);
    const narr = useFetchJson<{ narrative?: string; archetype?: string }>(`/api/public/narrative/${address}`, [address]);
    const [picked, setPicked] = useState<{ mint: string; symbol: string } | null>(null);
    const [copied, setCopied] = useState(false);

    // Type-in narrative
    const [shown, setShown] = useState("");
    useEffect(() => {
        const full = narr.data?.narrative ?? "";
        if (!full) { setShown(""); return; }
        let i = 0;
        const id = window.setInterval(() => {
            i = Math.min(full.length, i + 5);
            setShown(full.slice(0, i));
            if (i >= full.length) window.clearInterval(id);
        }, 16);
        return () => window.clearInterval(id);
    }, [narr.data?.narrative]);

    const copy = () => {
        navigator.clipboard?.writeText(address);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <>
            {/* Hero — Edge Insights led */}
            <div className="relative border-b border-violet-100/80 overflow-hidden bg-white">
                <div className="relative mx-auto max-w-6xl px-6 py-10 sm:py-14">
                    {!embed && (
                        <div className="flex items-center justify-between gap-4 mb-8">
                            <Link href="/" className="text-xs uppercase tracking-[0.22em] font-semibold text-violet-700">Dreyv</Link>
                            <div className="flex items-center gap-2">
                                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] font-semibold text-violet-700">
                                    <Bell size={10} /> Live · 30s
                                </span>
                                <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-mono text-slate-700 hover:border-violet-400">
                                    {truncAddr(address)} {copied ? "✓" : <Copy size={10} />}
                                </button>
                            </div>
                        </div>
                    )}
                    <EdgeInsightsHero
                        address={address}
                        data={edge.data}
                        loading={edge.loading}
                        narrative={{
                            text: shown,
                            archetype: narr.data?.archetype,
                            loading: narr.loading,
                        }}
                    />
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
                {/* Edge insights grid — the differentiator */}
                <section className="space-y-4">
                    <div className="flex items-end justify-between flex-wrap gap-3">
                        <div>
                            <h2 className="text-[18px] font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                                <DreyvStar size={14} className="text-violet-600" />
                                The Dreyv Edge
                            </h2>
                            <p className="text-[12.5px] text-slate-500 mt-1">Value moves and pattern signals we found in this wallet's actual on-chain history.</p>
                        </div>
                        {!embed && (
                            <Link href={`/auth?claim=${address}`} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2 text-[12px] font-semibold text-white uppercase tracking-[0.08em]">
                                Act on all of this <ArrowRight size={12} />
                            </Link>
                        )}
                    </div>
                    <EdgeInsightsGrid address={address} data={edge.data} loading={edge.loading} />
                </section>

                {/* Sticky connect rail */}
                {!embed && (
                    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <Wallet size={18} className="text-violet-600 mt-0.5" />
                            <div>
                                <div className="text-[13px] font-semibold text-slate-900">Connect to act on these insights</div>
                                <div className="text-[11px] text-slate-500">You're viewing public on-chain data. Sign in to let Dreyv execute, watch, and protect this wallet.</div>
                            </div>
                        </div>
                        <Link href={`/auth?claim=${address}`} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2 text-[12px] font-semibold text-white uppercase tracking-[0.08em] shrink-0">
                            Connect wallet <ArrowRight size={12} />
                        </Link>
                    </div>
                )}

                {/* Analyst grid below the fold */}
                <StatStrip pack={pack} />
                <SuggestionsPanel address={address} />

                {compareAddress && <ComparePanel a={address} b={compareAddress} />}

                <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2"><HoldingsPanel address={address} onPickToken={(mint, symbol) => setPicked({ mint, symbol })} /></div>
                    <Section title="Composition" subtitle="USD weights across positions."><CompositionDonut pack={pack} /></Section>
                </div>

                <PerformanceChart address={address} />

                <div className="grid lg:grid-cols-2 gap-6">
                    <RiskPanel address={address} />
                    <CounterpartiesPanel address={address} />
                </div>

                <ActivityPanel address={address} />
                <NftsPanel address={address} />
                <SiblingsPanel address={address} />

                {!embed && (
                    <div className="text-center py-6 text-[11px] text-slate-500">
                        Powered by{" "}
                        <Link href="/" className="text-violet-700 font-semibold hover:underline">Dreyv</Link>
                        {" · "}
                        <Link href={`/v/${address}/data`} className="hover:text-violet-700">JSON</Link>
                        {" · "}
                        <Link href={`/v/${address}?embed=1`} className="hover:text-violet-700">Embed</Link>
                    </div>
                )}
            </div>

            {picked && <TokenSheet mint={picked.mint} symbol={picked.symbol} onClose={() => setPicked(null)} />}
            {!embed && <ClaimCta address={address} />}
        </>
    );
}

export default SmartExplorerClient;
