"use client";

/**
 * EdgeInsightsPanel — the Dreyv differentiator surface on /v/[address].
 *
 * Lead hero (mascot + wallet DNA + totals) and a friendly grid of edge
 * insights (fee leakage, idle capital, dust reclaim, concentration,
 * lost opportunity, DCA cadence, yield routes…). Every metric is real
 * and traceable; no fabricated figures.
 */

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowRight,
    ChevronDown,
    Loader2,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { CrystalIcon, type CrystalName } from "@/components/marketplace/CrystalIcon";
import dreyvGreet from "@/assets/mascot/dreyv-greet.png";
import dreyvThink from "@/assets/mascot/dreyv-think.png";
import dreyvCelebrate from "@/assets/mascot/dreyv-celebrate.png";

type Impact = "high" | "medium" | "low";
type Kind =
    | "fees" | "idle" | "dust" | "lost" | "concentration"
    | "dca" | "counterparty" | "stale" | "earn";

interface EdgeInsight {
    id: string;
    kind: Kind;
    title: string;
    subtitle: string;
    metric: string;
    impactUsd: number;
    impact: Impact;
    detail: string;
    action?: { label: string; intent: string };
    evidence?: string[];
}

interface EdgeInsightsResponse {
    address: string;
    totalRecoverableUsd: number;
    totalAnnualUsd: number;
    walletDna: {
        archetype: string;
        confidence: number;
        traits: string[];
        activityTier: "dormant" | "light" | "active" | "power";
    };
    topInsight: EdgeInsight | null;
    insights: EdgeInsight[];
}

// Map each insight kind to a custom violet-crystal mark (no stock iconography).
const KIND_CRYSTAL: Record<Kind, CrystalName> = {
    fees: "trading",
    idle: "free",
    dust: "utility",
    lost: "trending",
    concentration: "security",
    dca: "analytics",
    counterparty: "social",
    stale: "featured",
    earn: "trending",
};

function fmtUsdShort(n: number): string {
    if (!isFinite(n)) return "—";
    if (n === 0) return "$0";
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
    if (abs >= 10) return `$${n.toFixed(0)}`;
    return `$${n.toFixed(2)}`;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Hero                                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

export function EdgeInsightsHero({
    address,
    data,
    loading,
    narrative,
}: {
    address: string;
    data: EdgeInsightsResponse | null;
    loading: boolean;
    narrative: { text: string; archetype?: string; loading: boolean };
}) {
    const dna = data?.walletDna;
    const top = data?.topInsight;
    const totalUpside = (data?.totalAnnualUsd ?? 0) + (data?.totalRecoverableUsd ?? 0);
    const mascot =
        totalUpside >= 100 ? dreyvCelebrate :
        loading || narrative.loading ? dreyvThink :
        dreyvGreet;

    return (
        <div className="relative">
            {/* ambient violet glow */}
            <div className="pointer-events-none absolute -top-24 left-1/3 h-[380px] w-[760px] -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 right-0 h-[300px] w-[500px] rounded-full bg-violet-300/25 blur-3xl" />

            <div className="relative grid lg:grid-cols-[1fr,360px] gap-8 lg:gap-10 items-start">
                {/* Left — DNA + narrative */}
                <div className="space-y-6">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 text-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
                            <DreyvStar size={10} className="text-white" />
                            {dna?.archetype ? dna.archetype.replace(/_/g, " ") : narrative.archetype?.replace(/_/g, " ") ?? "Analyzing"}
                        </span>
                        {dna?.activityTier && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] font-semibold text-violet-700">
                                {dna.activityTier} activity
                            </span>
                        )}
                        {dna?.traits.slice(0, 3).map((t) => (
                            <span key={t} className="inline-flex items-center rounded-full bg-violet-50 border border-violet-100 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] font-semibold text-violet-700">
                                {t}
                            </span>
                        ))}
                        {(loading || narrative.loading) && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-violet-700">
                                <Loader2 size={11} className="animate-spin" /> Reading on-chain history
                            </span>
                        )}
                    </div>

                    <div className="min-h-[88px]">
                        {narrative.text ? (
                            <p className="text-[15px] sm:text-[16px] leading-relaxed text-slate-700 whitespace-pre-line">
                                {narrative.text}
                            </p>
                        ) : narrative.loading ? (
                            <div className="space-y-2">
                                <div className="h-3 w-full rounded bg-violet-100/70 animate-pulse" />
                                <div className="h-3 w-[94%] rounded bg-violet-100/70 animate-pulse" />
                                <div className="h-3 w-[80%] rounded bg-violet-100/70 animate-pulse" />
                            </div>
                        ) : (
                            <p className="text-[13px] text-slate-500">Narrative unavailable — the rest of the report still loads.</p>
                        )}
                    </div>

                    {/* totals strip */}
                    <div className="grid sm:grid-cols-3 gap-3">
                        <TotalsCard
                            label="Annual upside"
                            value={fmtUsdShort(data?.totalAnnualUsd ?? 0)}
                            hint="recurring $ on the table"
                            tone="primary"
                        />
                        <TotalsCard
                            label="One-tap recoverable"
                            value={fmtUsdShort(data?.totalRecoverableUsd ?? 0)}
                            hint="rent + dust reclaimable now"
                        />
                        <TotalsCard
                            label="Edge insights"
                            value={String(data?.insights.length ?? 0)}
                            hint="value moves Dreyv spotted"
                        />
                    </div>
                </div>

                {/* Right — mascot + top insight */}
                <div className="relative">
                    <div className="rounded-3xl border border-violet-100 bg-white p-5">
                        <div className="flex items-start gap-4">
                            <div className="shrink-0 relative">
                                <div className="absolute inset-0 rounded-full bg-violet-300/30 blur-2xl" />
                                <Image
                                    src={mascot}
                                    alt="Dreyv"
                                    width={84}
                                    height={84}
                                    className="relative"
                                    priority
                                />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">Dreyv's pick</div>
                                <div className="text-[14px] font-semibold text-slate-900 leading-snug">
                                    {top ? top.title : loading ? "Sizing the upside…" : "No moves to flag right now."}
                                </div>
                                {top && (
                                    <div className="mt-1 text-[12px] text-slate-500 leading-relaxed">
                                        {top.subtitle}
                                    </div>
                                )}
                            </div>
                        </div>
                        {top && (
                            <>
                                <div className="mt-4 rounded-2xl bg-violet-50/60 border border-violet-100 p-3">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">{top.kind === "dust" ? "Recoverable" : top.impactUsd > 0 ? "Estimated upside" : "Signal"}</span>
                                        <span className="text-[18px] font-semibold text-slate-900">{top.metric}</span>
                                    </div>
                                    <p className="mt-2 text-[12px] text-slate-600 leading-relaxed">
                                        {top.detail}
                                    </p>
                                </div>
                                {top.action && (
                                    <Link
                                        href={`/auth?claim=${address}&intent=${top.action.intent}`}
                                        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-[12px] font-semibold text-white uppercase tracking-[0.08em]"
                                    >
                                        {top.action.label} <ArrowRight size={12} />
                                    </Link>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function TotalsCard({
    label, value, hint, tone,
}: { label: string; value: string; hint: string; tone?: "primary" }) {
    return (
        <div className={`rounded-2xl border p-4 ${tone === "primary" ? "border-violet-300 bg-violet-50" : "border-violet-100 bg-white"}`}>
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">{label}</div>
            <div className="mt-1 text-[24px] font-semibold text-slate-900 leading-none">{value}</div>
            <div className="mt-1.5 text-[11px] text-slate-500">{hint}</div>
        </div>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Grid                                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

export function EdgeInsightsGrid({
    address,
    data,
    loading,
}: {
    address: string;
    data: EdgeInsightsResponse | null;
    loading: boolean;
}) {
    if (loading && !data) {
        return (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-44 rounded-2xl bg-violet-100/40 animate-pulse" />
                ))}
            </div>
        );
    }
    if (!data || data.insights.length === 0) {
        return (
            <div className="rounded-2xl border border-violet-100 bg-violet-50/30 p-6 text-[13px] text-slate-600">
                Dreyv didn't find any fee leaks, idle capital, or recoverable rent on this wallet. That usually means it's already well-run — connect to unlock continuous monitoring.
            </div>
        );
    }
    return (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.insights.map((ins, i) => (
                <EdgeInsightCard key={ins.id} address={address} insight={ins} index={i} />
            ))}
        </div>
    );
}

function EdgeInsightCard({
    address, insight, index,
}: { address: string; insight: EdgeInsight; index: number }) {
    const [open, setOpen] = useState(false);
    const crystal = KIND_CRYSTAL[insight.kind] ?? "all";
    const toneRing =
        insight.impact === "high" ? "border-violet-300 bg-violet-50/50" :
        insight.impact === "medium" ? "border-violet-200 bg-white" :
        "border-violet-100 bg-white";

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.05, 0.4) }}
            className={`group relative rounded-2xl border p-5 flex flex-col gap-4 ${toneRing}`}
        >
            {/* Header: crystal medallion + kind/impact */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-violet-50 to-white border border-violet-200 shadow-[0_2px_10px_-4px_rgba(124,58,237,0.25)]">
                        <CrystalIcon name={crystal} size={26} alt={insight.kind} />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">{insight.kind}</div>
                        <div className="text-[14.5px] font-semibold text-slate-900 leading-snug mt-0.5 line-clamp-2">{insight.title}</div>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 mt-1">
                    <DreyvStar size={10} className={
                        insight.impact === "high" ? "text-violet-700" :
                        insight.impact === "medium" ? "text-violet-400" :
                        "text-violet-200"
                    } />
                    <span className={`text-[9px] uppercase tracking-[0.16em] font-semibold ${
                        insight.impact === "high" ? "text-violet-700" :
                        insight.impact === "medium" ? "text-slate-600" :
                        "text-slate-400"
                    }`}>{insight.impact}</span>
                </div>
            </div>


            {/* Metric block — primary number anchored, tabular */}
            <div className="rounded-xl border border-violet-100 bg-white px-3.5 py-2.5 flex items-baseline justify-between gap-3">
                <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">
                    {insight.subtitle}
                </span>
                <span className="text-[17px] font-semibold text-slate-900 tabular-nums tracking-tight truncate">
                    {insight.metric}
                </span>
            </div>

            <p className="text-[12.5px] text-slate-600 leading-relaxed flex-1">
                {insight.detail}
            </p>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-violet-100">
                {insight.action ? (
                    <Link
                        href={`/auth?claim=${address}&intent=${insight.action.intent}`}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700 hover:text-violet-900"
                    >
                        {insight.action.label} <ArrowRight size={11} />
                    </Link>
                ) : <span />}
                {insight.evidence && insight.evidence.length > 0 && (
                    <button
                        onClick={() => setOpen((v) => !v)}
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-500 hover:text-violet-700"
                    >
                        Evidence <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                )}
            </div>

            <AnimatePresence>
                {open && insight.evidence && (
                    <motion.ul
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-1 overflow-hidden"
                    >
                        {insight.evidence.map((ev, j) => (
                            <li key={j} className="text-[11px] text-slate-600 flex items-start gap-2">
                                <DreyvStar size={8} className="text-violet-500 mt-1.5 shrink-0" />
                                <span>{ev}</span>
                            </li>
                        ))}
                    </motion.ul>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Hook                                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

export function useEdgeInsights(address: string) {
    const [state, setState] = useState<{ data: EdgeInsightsResponse | null; loading: boolean }>({
        data: null, loading: true,
    });
    React.useEffect(() => {
        let cancelled = false;
        setState({ data: null, loading: true });
        fetch(`/api/public/edge-insights/${address}`, { cache: "no-store" })
            .then((r) => r.ok ? r.json() : null)
            .then((j) => { if (!cancelled) setState({ data: j ?? null, loading: false }); })
            .catch(() => { if (!cancelled) setState({ data: null, loading: false }); });
        return () => { cancelled = true; };
    }, [address]);
    return state;
}

export type { EdgeInsight, EdgeInsightsResponse };
