"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TokenAvatar } from "@/components/TokenAvatar";
import { AppEventBus } from "@/lib/events";
import { type RiskTier } from "@/lib/yield-registry";
import { getProtocolLogo } from "@/lib/protocol-logos";

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

// Neutral / violet-toned risk pills (no green/yellow/rose to match brand).
function riskMeta(tier: RiskTier): { label: string; cls: string } {
    switch (tier) {
        case "low":
            return { label: "Low risk", cls: "border-violet-200 bg-violet-50 text-violet-700" };
        case "medium":
            return { label: "Medium risk", cls: "border-slate-200 bg-slate-50 text-slate-700" };
        case "high":
            return { label: "Higher risk", cls: "border-slate-300 bg-slate-100 text-slate-800" };
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
            conservative: (r) => r.apy - (r.riskTier === "high" ? 8 : r.riskTier === "medium" ? 2 : 0),
            balanced: (r) => r.apy - (r.riskTier === "high" ? 3 : 0),
            aggressive: (r) => r.apy + (r.riskTier === "high" ? 0.5 : 0),
        };
        const score = personaWeight[persona];
        // Dedupe by protocol+symbol so we don't show "Kamino USDC" three times
        const seen = new Set<string>();
        const sorted = [...all].sort((a, b) => score(b) - score(a));
        const deduped: ProtocolRow[] = [];
        for (const row of sorted) {
            const key = `${row.protocol}|${row.symbol}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(row);
            if (deduped.length >= limit) break;
        }
        return deduped;
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
                    const logo = getProtocolLogo(r.protocol);
                    return (
                        <li
                            key={r.mint}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-3 py-2"
                        >
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                <TokenAvatar
                                    logo={logo}
                                    symbol={r.protocol}
                                    mint={r.mint}
                                    size={28}
                                    className="shrink-0 rounded-full"
                                />
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
                                            <span className="rounded-full border border-violet-200 bg-white px-1.5 py-0.5 font-semibold text-violet-700">
                                                Live
                                            </span>
                                        )}
                                    </div>
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

            <div className="mt-auto flex flex-col">
                <Link
                    href="/app/treasury"
                    className="flex items-center justify-between gap-2 border-t border-violet-100 px-5 py-2.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-violet-50 hover:text-violet-700"
                >
                    See all yield routes in Treasury
                    <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <button
                    onClick={() => {
                        const top = ranked[0];
                        const cmd = top
                            ? `Deploy idle stables and SOL into ${top.protocol} (${top.symbol}) at ~${top.apy.toFixed(2)}% APY. Confirm risk: ${top.riskTier}.`
                            : `Show me the best yield opportunities for my treasury right now.`;
                        AppEventBus.emit("AGENT_COMMAND", { command: cmd, source: "YieldProtocolPanel" });
                    }}
                    className="inline-flex items-center justify-center gap-2 bg-violet-600 px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-violet-700"
                >
                    {ranked[0] ? `Earn ${ranked[0].apy.toFixed(2)}% with ${ranked[0].protocol}` : "Find yield with Dreyv"}
                    <ArrowRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
