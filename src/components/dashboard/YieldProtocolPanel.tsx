"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
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

function riskMeta(tier: RiskTier): { label: string; cls: string } {
    switch (tier) {
        case "low":
            return { label: "Low risk", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
        case "medium":
            return { label: "Medium risk", cls: "border-amber-200 bg-amber-50 text-amber-700" };
        case "high":
            return { label: "High risk", cls: "border-rose-200 bg-rose-50 text-rose-700" };
    }
}

interface YieldProtocolPanelProps {
    persona?: "conservative" | "balanced" | "aggressive";
    limit?: number;
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

    const topApy = ranked[0]?.apy ?? 0;
    const liveCount = ranked.filter((r) => r.source === "live").length;

    return (
        <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white">
            <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-violet-300/20 blur-3xl" />

            <div className="flex items-center justify-between gap-2 px-5 pt-5">
                <div className="flex items-center gap-1.5 text-violet-700">
                    <DreyvStar size={9} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">{title}</span>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    {persona}
                </span>
            </div>

            <div className="px-5 pt-3 pb-2">
                {loading ? (
                    <p className="font-manrope text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-300">…</p>
                ) : error || ranked.length === 0 ? (
                    <p className="font-manrope text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-300">—</p>
                ) : (
                    <p className="font-manrope text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
                        {topApy.toFixed(2)}<span className="text-slate-400">%</span>
                    </p>
                )}
                <p className="mt-1.5 line-clamp-1 text-[11px] text-slate-500">
                    {loading
                        ? "Pulling live rates from Kamino, MarginFi, Marinade…"
                        : error
                          ? error
                          : ranked.length === 0
                            ? "No yield opportunities available right now"
                            : `Top of ${ranked.length} ranked for ${persona} · ${liveCount}/${ranked.length} live`}
                </p>
            </div>

            <ul className="flex-1 space-y-1.5 px-5 pb-3">
                {ranked.map((r) => {
                    const badge = riskMeta(r.riskTier);
                    return (
                        <li
                            key={r.mint}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-slate-900">
                                    {r.protocol}
                                    <span className="ml-1.5 text-[10px] font-medium text-slate-400">{r.symbol}</span>
                                </p>
                                <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-semibold ${badge.cls}`}>
                                        {badge.label}
                                    </span>
                                    <span className="text-slate-400">AUM {formatAum(r.aumUsd)}</span>
                                    {r.source === "live" && (
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                                            Live
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="font-manrope text-[15px] font-semibold tabular-nums text-slate-900">
                                    {r.apy.toFixed(2)}<span className="text-slate-400">%</span>
                                </p>
                                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-400">APY</p>
                            </div>
                        </li>
                    );
                })}
            </ul>

            <button
                onClick={() => {
                    const top = ranked[0];
                    const cmd = top
                        ? `Deploy idle stables and SOL into ${top.protocol} (${top.symbol}) at ~${top.apy.toFixed(2)}% APY. Confirm risk: ${top.riskTier}.`
                        : `Show me the best yield opportunities for my treasury right now.`;
                    AppEventBus.emit("AGENT_COMMAND", { command: cmd, source: "YieldProtocolPanel" });
                }}
                className="mt-auto inline-flex items-center justify-center gap-2 border-t border-violet-100 bg-violet-600 px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-violet-700"
            >
                {ranked[0] ? `Earn ${ranked[0].apy.toFixed(2)}% with ${ranked[0].protocol}` : "Find yield with Dreyv"}
                <ArrowRight className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
