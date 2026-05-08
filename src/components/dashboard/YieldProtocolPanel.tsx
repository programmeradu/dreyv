"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { AppEventBus } from "@/lib/events";
import { type RiskTier } from "@/lib/yield-registry";

interface ProtocolRow {
    mint: string;
    protocol: string;
    symbol: string;
    apy: number;
    source: "live" | "estimated";
    riskTier: RiskTier;
    aumUsd?: number;
}

interface RatesResponse {
    rates: Record<string, ProtocolRow>;
    fetchedAt: string;
    cached?: boolean;
}

function formatAum(usd?: number): string {
    if (!usd || usd <= 0) return "—";
    if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(0)}M`;
    if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
    return `$${usd}`;
}

function riskBadge(tier: RiskTier) {
    switch (tier) {
        case "low":
            return {
                label: "Low risk",
                className: "border-emerald-200 bg-emerald-50 text-emerald-700",
                Icon: ShieldCheck,
            };
        case "medium":
            return {
                label: "Medium risk",
                className: "border-amber-200 bg-amber-50 text-amber-700",
                Icon: Shield,
            };
        case "high":
            return {
                label: "High risk",
                className: "border-rose-200 bg-rose-50 text-rose-700",
                Icon: ShieldAlert,
            };
    }
}

interface YieldProtocolPanelProps {
    /** Persona drives ranking — aggressive prefers higher APY, conservative prefers low risk */
    persona?: "conservative" | "balanced" | "aggressive";
    /** How many protocols to show — default 3 */
    limit?: number;
    /** Optional title override */
    title?: string;
}

export function YieldProtocolPanel({
    persona = "balanced",
    limit = 3,
    title = "Top yield opportunities",
}: YieldProtocolPanelProps) {
    const [rates, setRates] = useState<Record<string, ProtocolRow> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/yield/rates");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: RatesResponse = await res.json();
                if (!cancelled) setRates(data.rates);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load rates");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const ranked = useMemo<ProtocolRow[]>(() => {
        if (!rates) return [];
        const all: ProtocolRow[] = Object.entries(rates).map(([mint, r]) => ({ ...r, mint }));

        const personaWeight: Record<typeof persona, (r: ProtocolRow) => number> = {
            conservative: (r) => r.apy - (r.riskTier === "high" ? 5 : r.riskTier === "medium" ? 1.5 : 0),
            balanced: (r) => r.apy - (r.riskTier === "high" ? 1.5 : 0),
            aggressive: (r) => r.apy + (r.riskTier === "high" ? 0.5 : 0),
        };
        const score = personaWeight[persona];
        return [...all].sort((a, b) => score(b) - score(a)).slice(0, limit);
    }, [rates, persona, limit]);

    if (loading) {
        return (
            <div className="rounded-2xl border border-violet-100 bg-white p-4 text-xs text-slate-500">
                Loading yield opportunities…
            </div>
        );
    }
    if (error || ranked.length === 0) {
        return (
            <div className="rounded-2xl border border-violet-100 bg-white p-4 text-xs text-slate-500">
                {error ?? "No yield opportunities available right now."}
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-violet-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                    {title}
                </h3>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {persona} persona
                </span>
            </div>
            <ul className="space-y-2">
                {ranked.map((r, i) => {
                    const badge = riskBadge(r.riskTier);
                    return (
                        <li
                            key={r.mint}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5"
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                                    {i + 1}
                                </span>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">
                                        {r.protocol}
                                        <span className="ml-1.5 text-[10px] font-medium text-slate-500">
                                            ({r.symbol})
                                        </span>
                                    </p>
                                    <p className="mt-0.5 flex items-center gap-2 text-[10px] font-medium text-slate-500">
                                        <span>AUM {formatAum(r.aumUsd)}</span>
                                        <span>·</span>
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${badge.className}`}
                                        >
                                            <badge.Icon className="h-2.5 w-2.5" />
                                            {badge.label}
                                        </span>
                                        {r.source === "live" ? (
                                            <span className="text-emerald-600">● Live</span>
                                        ) : (
                                            <span className="text-slate-400">○ Est.</span>
                                        )}
                                    </p>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                                <div className="text-right">
                                    <p className="text-base font-black tabular-nums text-slate-900">
                                        {r.apy.toFixed(2)}%
                                    </p>
                                    <p className="text-[9px] font-medium uppercase tracking-wider text-slate-500">
                                        APY
                                    </p>
                                </div>
                                <button
                                    onClick={() =>
                                        AppEventBus.emit("AGENT_COMMAND", {
                                            command: `Deploy idle SOL into ${r.protocol} (${r.symbol}) at the current ${r.apy.toFixed(2)}% APY. Confirm risk band: ${r.riskTier}.`,
                                            source: "YieldProtocolPanel",
                                        })
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700"
                                >
                                    Execute
                                    <ArrowRight className="h-3 w-3" />
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
