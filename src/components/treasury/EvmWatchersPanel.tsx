"use client";

/**
 * EvmWatchersPanel — surfaces cross-chain (Ethereum, Base, Arbitrum, Polygon,
 * BSC) address monitors inside Treasury. Findings continue to land in the
 * Inbox; this panel is the at-a-glance health view.
 *
 * Lives in Treasury (not the deleted /app/opportunities) because watchers are
 * a treasury data source, not a destination page.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { useAgentContext, type WatcherHealth } from "@/lib/contexts/AgentContext";

const SOLANA_KEYS = new Set(["solana", "sol"]);

function healthLabel(h: WatcherHealth): { label: string; cls: string } {
    switch (h) {
        case "active":
            return { label: "Active", cls: "border-violet-200 bg-violet-50 text-violet-700" };
        case "stale":
            return { label: "Stale", cls: "border-slate-200 bg-slate-50 text-slate-600" };
        case "errored":
            return { label: "Errored", cls: "border-slate-300 bg-slate-100 text-slate-800" };
        case "idle":
        default:
            return { label: "Idle", cls: "border-slate-200 bg-white text-slate-500" };
    }
}

function shortAddr(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function EvmWatchersPanel() {
    const { watcherHealth } = useAgentContext();

    const evmWatchers = useMemo(
        () =>
            watcherHealth.filter(
                (w) => w.chain && !SOLANA_KEYS.has(String(w.chain).toLowerCase()),
            ),
        [watcherHealth],
    );

    if (evmWatchers.length === 0) return null;

    return (
        <div className="relative overflow-hidden rounded-3xl border border-violet-100 bg-white p-5">
            <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-violet-300/20 blur-3xl" />

            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-violet-700">
                    <DreyvStar size={9} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                        Cross-chain watchers
                    </span>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    {evmWatchers.length} EVM
                </span>
            </div>

            <h3 className="mt-2 font-manrope text-[18px] font-semibold leading-tight tracking-tight text-slate-900">
                EVM address monitors
            </h3>
            <p className="mt-1 text-[12px] text-slate-500">
                Findings from Ethereum, Base, Arbitrum, Polygon, and BSC also surface in your inbox.
            </p>

            <ul className="mt-4 space-y-1.5">
                {evmWatchers.map((w) => {
                    const h = healthLabel(w.health);
                    return (
                        <li
                            key={w.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-violet-100 bg-white px-3 py-2"
                        >
                            <span className="text-[12px] font-semibold capitalize text-slate-900">
                                {w.chain}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                                {shortAddr(w.address ?? "")}
                            </span>
                            <span
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${h.cls}`}
                            >
                                {h.label}
                            </span>
                        </li>
                    );
                })}
            </ul>

            <Link
                href="/app/inbox"
                className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-900"
            >
                Open inbox <ArrowUpRight className="h-3 w-3" />
            </Link>
        </div>
    );
}
