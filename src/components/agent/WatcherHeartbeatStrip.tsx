"use client";

/**
 * WatcherHeartbeatStrip — horizontal strip of dots showing live watcher and
 * subagent health. Pulls from AgentContext. One dot per active watcher.
 *   Green pulsing  → healthy (last seen within 5 min)
 *   Amber          → stale (no heartbeat > 5 min)
 *   Red            → errored
 *   Slate          → idle / no heartbeat yet
 */

import { useMemo } from "react";
import { Activity, Eye } from "lucide-react";
import { useAgentContext, type WatcherHealth } from "@/lib/contexts/AgentContext";

const HEALTH_COLOR: Record<WatcherHealth, { dot: string; ring: string; pulse: boolean; label: string }> = {
    active: { dot: "bg-emerald-500", ring: "bg-emerald-400", pulse: true, label: "Active" },
    stale: { dot: "bg-amber-500", ring: "bg-amber-400", pulse: false, label: "Stale" },
    errored: { dot: "bg-rose-500", ring: "bg-rose-400", pulse: true, label: "Errored" },
    idle: { dot: "bg-slate-300", ring: "bg-slate-200", pulse: false, label: "Idle" },
};

export function WatcherHeartbeatStrip() {
    const { watcherHealth, subagents, activeSubagentCount, lastFetchedAt } = useAgentContext();

    const dots = useMemo(() => {
        const watcherDots = watcherHealth.map((w) => ({
            id: `w-${w.id}`,
            label: w.label ?? w.address ?? "watcher",
            health: w.health,
            kind: "watcher" as const,
        }));
        const subagentDots = subagents.slice(0, 8).map((s) => ({
            id: `s-${s.id}`,
            label: s.label ?? s.kind ?? "subagent",
            health: (s.status === "errored" || s.status === "error"
                ? "errored"
                : !s.status || s.status === "active" || s.status === "running"
                ? "active"
                : "stale") as WatcherHealth,
            kind: "subagent" as const,
        }));
        return [...watcherDots, ...subagentDots].slice(0, 16);
    }, [watcherHealth, subagents]);

    if (dots.length === 0) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-white px-4 py-2.5 text-xs text-slate-500">
                <Activity className="h-3.5 w-3.5 text-violet-500" />
                <span>No watchers running yet — connect a vault to start seeing heartbeats.</span>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-100 bg-white px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                <Eye className="h-3 w-3" />
                Watchers
            </div>
            <div className="flex items-center gap-1.5">
                {dots.map((d) => {
                    const c = HEALTH_COLOR[d.health];
                    return (
                        <span
                            key={d.id}
                            title={`${d.label} — ${c.label}`}
                            className="relative inline-flex h-2.5 w-2.5"
                        >
                            {c.pulse && (
                                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${c.ring}`} />
                            )}
                            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${c.dot}`} />
                        </span>
                    );
                })}
            </div>
            <span className="ml-auto text-[11px] font-medium text-slate-500">
                {activeSubagentCount > 0 ? `${activeSubagentCount} subagent${activeSubagentCount === 1 ? "" : "s"} live` : "Idle"}
                {lastFetchedAt && (
                    <span className="ml-2 text-slate-400">·{" "}{new Date(lastFetchedAt).toLocaleTimeString()}</span>
                )}
            </span>
        </div>
    );
}
