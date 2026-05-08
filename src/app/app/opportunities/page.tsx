"use client";

/**
 * /app/opportunities — dedicated section for agent-identified opportunities.
 *
 * Pulls from AgentContext.proposals filtered to yield/opportunity/rebalance kinds,
 * grouped by risk tier. Persona toggle (conservative/balanced/aggressive) controls
 * how aggressively the agent surfaces strategies. Each card has an Execute button
 * that hands off to the CommandBar via AGENT_COMMAND.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Compass, Sparkles, ShieldCheck, Shield, ShieldAlert, ArrowRight, RefreshCw } from "lucide-react";
import { useAgentContext, type AgentProposal } from "@/lib/contexts/AgentContext";
import { useVault } from "@/lib/contexts/VaultContext";
import { AmbientGlow } from "@/components/app-shell/primitives";
import { AppEventBus } from "@/lib/events";
import { YieldProtocolPanel } from "@/components/dashboard/YieldProtocolPanel";

type Persona = "conservative" | "balanced" | "aggressive";
type RiskTier = "low" | "medium" | "high";

const OPPORTUNITY_KINDS = ["yield", "opportunity", "rebalance", "alert", "proposal"] as const;

function inferRiskTier(p: AgentProposal): RiskTier {
    const explicit = (p.riskTier ?? "").toString().toLowerCase();
    if (explicit === "low" || explicit === "medium" || explicit === "high") return explicit;
    const sev = (p.severity ?? "").toString().toLowerCase();
    if (sev.includes("critical") || sev.includes("high")) return "high";
    if (sev.includes("medium") || sev.includes("warn")) return "medium";
    if (sev.includes("low") || sev.includes("info")) return "low";
    return "medium";
}

function inferKind(p: AgentProposal): string {
    return (p.kind ?? "proposal").toString().toLowerCase();
}

function tierMeta(tier: RiskTier) {
    switch (tier) {
        case "low":
            return { label: "Low risk", className: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: ShieldCheck };
        case "medium":
            return { label: "Medium risk", className: "border-amber-200 bg-amber-50 text-amber-700", Icon: Shield };
        case "high":
            return { label: "High risk", className: "border-rose-200 bg-rose-50 text-rose-700", Icon: ShieldAlert };
    }
}

const PERSONA_META: Record<Persona, { label: string; description: string; allow: RiskTier[] }> = {
    conservative: {
        label: "Conservative",
        description: "Only low-risk plays. Capital preservation first.",
        allow: ["low"],
    },
    balanced: {
        label: "Balanced",
        description: "Low and medium risk. Default for most teams.",
        allow: ["low", "medium"],
    },
    aggressive: {
        label: "Aggressive",
        description: "Full surface — including high-risk strategies.",
        allow: ["low", "medium", "high"],
    },
};

export default function OpportunitiesPage() {
    const { activeVault } = useVault();
    const { proposals, loading, lastFetchedAt, refresh, watcherHealth } = useAgentContext();
    const [persona, setPersona] = useState<Persona>("balanced");

    const evmWatchers = useMemo(
        () =>
            watcherHealth.filter(
                (w) => w.chain && !["solana", "sol"].includes(String(w.chain).toLowerCase()),
            ),
        [watcherHealth],
    );

    const filtered = useMemo(() => {
        const allow = PERSONA_META[persona].allow;
        return proposals
            .filter((p) => OPPORTUNITY_KINDS.includes(inferKind(p) as (typeof OPPORTUNITY_KINDS)[number]))
            .map((p) => ({ ...p, _tier: inferRiskTier(p) as RiskTier }))
            .filter((p) => allow.includes(p._tier));
    }, [proposals, persona]);

    const grouped = useMemo(() => {
        const buckets: Record<RiskTier, typeof filtered> = { low: [], medium: [], high: [] };
        for (const p of filtered) buckets[p._tier].push(p);
        return buckets;
    }, [filtered]);

    return (
        <div className="relative h-full w-full overflow-x-hidden overflow-y-auto bg-white font-manrope text-slate-900">
            <AmbientGlow className="left-1/2 top-[-220px] -translate-x-1/2" />
            <section className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6 sm:pt-16">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                            <Compass className="h-3 w-3" />
                            Opportunities
                        </p>
                        <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
                            Strategies the agents have surfaced for you.
                        </h1>
                        <p className="mt-2 max-w-xl text-sm text-slate-500">
                            Tied to your agent persona. Conservative shows only vetted, low-risk plays. Aggressive includes the full surface — high-yield, higher-risk strategies included.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void refresh()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                            title={lastFetchedAt ? `Last refreshed ${new Date(lastFetchedAt).toLocaleTimeString()}` : "Refresh"}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Persona toggle */}
                <div className="mt-6 inline-flex rounded-2xl border border-violet-100 bg-white p-1">
                    {(Object.keys(PERSONA_META) as Persona[]).map((key) => {
                        const active = persona === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setPersona(key)}
                                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                    active
                                        ? "rounded-xl bg-violet-600 text-white shadow-sm"
                                        : "rounded-xl text-slate-600 hover:text-slate-900"
                                }`}
                            >
                                {PERSONA_META[key].label}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-2 text-xs text-slate-500">{PERSONA_META[persona].description}</p>
            </section>

            <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-4 pb-16 sm:px-6">
                {/* Yield protocol panel — always visible, drives ranking by persona */}
                <YieldProtocolPanel persona={persona} limit={persona === "aggressive" ? 5 : 3} title="Top yield protocols" />

                {evmWatchers.length > 0 && (
                    <div className="mt-8 rounded-2xl border border-violet-100 bg-white p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                            Cross-chain watchers
                        </p>
                        <h2 className="mt-2 text-lg font-semibold text-slate-900">EVM address monitors</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Findings from Ethereum, Base, Arbitrum, Polygon, and BSC watches also surface in your inbox.
                        </p>
                        <ul className="mt-4 space-y-2">
                            {evmWatchers.map((w) => (
                                <li
                                    key={w.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm"
                                >
                                    <span className="font-medium capitalize text-slate-800">{w.chain}</span>
                                    <span className="font-mono text-xs text-slate-600">{w.address}</span>
                                    <span
                                        className={
                                            w.health === "active"
                                                ? "text-emerald-600"
                                                : w.health === "stale"
                                                  ? "text-amber-600"
                                                  : "text-slate-500"
                                        }
                                    >
                                        {w.health}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <Link
                            href="/app/inbox"
                            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"
                        >
                            Open inbox <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                )}

                <div className="mt-8 grid gap-6 lg:grid-cols-3">
                    {(["low", "medium", "high"] as const).map((tier) => {
                        if (!PERSONA_META[persona].allow.includes(tier)) return null;
                        const meta = tierMeta(tier);
                        const items = grouped[tier];
                        return (
                            <div key={tier} className="rounded-2xl border border-violet-100 bg-white p-5">
                                <div className="mb-4 flex items-center justify-between">
                                    <span
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}
                                    >
                                        <meta.Icon className="h-3 w-3" />
                                        {meta.label}
                                    </span>
                                    <span className="text-[11px] font-semibold text-slate-400">{items.length}</span>
                                </div>
                                {items.length === 0 ? (
                                    <p className="text-sm text-slate-500">
                                        {activeVault
                                            ? "Nothing in this band yet. The agents are watching."
                                            : "Connect a vault to start seeing strategies in this band."}
                                    </p>
                                ) : (
                                    <ul className="space-y-3">
                                        {items.map((p) => (
                                            <OpportunityCard key={p.id} proposal={p} tier={tier} />
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>

                {!activeVault && (
                    <div className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/40 p-5 text-sm text-slate-600">
                        <Sparkles className="mr-1 inline h-4 w-4 text-violet-500" />
                        Connect a wallet from the <Link href="/app/treasury" className="font-semibold text-violet-700 underline-offset-4 hover:underline">treasury</Link> to unlock personalized opportunities.
                    </div>
                )}
            </section>
        </div>
    );
}

function OpportunityCard({ proposal, tier }: { proposal: AgentProposal; tier: RiskTier }) {
    const meta = tierMeta(tier);
    const subtitle = proposal.summary ?? null;
    const apyHint = (() => {
        const payload = proposal.payload as Record<string, unknown> | null | undefined;
        if (!payload) return null;
        const apy = (payload as { apyBps?: unknown; apy?: unknown }).apyBps;
        if (typeof apy === "number") return `${(apy / 100).toFixed(2)}%`;
        const flat = (payload as { apy?: unknown }).apy;
        if (typeof flat === "number") return `${flat.toFixed(2)}%`;
        return null;
    })();
    return (
        <li className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{proposal.title ?? "Untitled opportunity"}</p>
                    {subtitle && (
                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{subtitle}</p>
                    )}
                </div>
                {apyHint && (
                    <span className="shrink-0 rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                        {apyHint} APY
                    </span>
                )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                    <meta.Icon className="h-2.5 w-2.5" />
                    {meta.label}
                </span>
                <button
                    onClick={() =>
                        AppEventBus.emit("AGENT_COMMAND", {
                            command: `Execute opportunity: ${proposal.title ?? "agent proposal"}. ${proposal.summary ?? ""}`.trim(),
                            source: "OpportunitiesPage",
                        })
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700"
                >
                    Execute
                    <ArrowRight className="h-3 w-3" />
                </button>
            </div>
        </li>
    );
}
