"use client";

/**
 * AgentsRail — right-side persistent surface showing background agents,
 * what they're watching, and their last finding.
 *
 * Visual language:
 *   - Each agent = a row with a colored "presence" dot (per-agent identity color)
 *   - Status verb in tiny caps ("watching", "scanning", "analyzing")
 *   - Last finding in slate-700, time-ago in slate-400
 *   - Active agents pulse the dot; idle ones are dimmed
 *
 * Data source: subscribes to canvas blocks (source==='agent') to derive the
 * "last finding" per agent. Until SSE is wired the rail still renders the
 * full roster with idle states, so users see the autonomy is *there*.
 */

import { useEffect, useMemo, useState } from "react";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { cn } from "@/lib/utils";

interface AgentDef {
  id: string;
  name: string;
  watching: string;
  /** Tailwind text color for the identity dot. */
  tone: string;
}

const AGENTS: AgentDef[] = [
  { id: "treasury-watcher", name: "Treasury Watcher", watching: "balance & flows", tone: "text-violet-600" },
  { id: "yield-optimizer", name: "Yield Optimizer", watching: "Kamino · Marinade · MarginFi", tone: "text-emerald-600" },
  { id: "risk-sentinel", name: "Risk Sentinel", watching: "drawdown & exposure", tone: "text-amber-600" },
  { id: "mev-guard", name: "MEV Guard", watching: "swap routes", tone: "text-sky-600" },
  { id: "simulation-firewall", name: "Simulation Firewall", watching: "outgoing transactions", tone: "text-rose-600" },
];

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AgentsRail() {
  const { blocks } = useCanvas();
  const [, force] = useState(0);

  // Tick every 5s so timeAgo stays live.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  // Derive last finding per agent from the canvas stream.
  // We match by `payload.agentId` if present, else by best-effort title match.
  const findings = useMemo(() => {
    const map = new Map<string, { title: string; createdAt: number }>();
    for (const b of blocks) {
      if (b.source !== "agent") continue;
      const aid = (b.payload as { agentId?: string })?.agentId;
      const matched =
        AGENTS.find((a) => a.id === aid) ??
        AGENTS.find((a) => b.title.toLowerCase().includes(a.name.toLowerCase().split(" ")[0]));
      if (!matched) continue;
      const prev = map.get(matched.id);
      if (!prev || prev.createdAt < b.createdAt) {
        map.set(matched.id, { title: b.title, createdAt: b.createdAt });
      }
    }
    return map;
  }, [blocks]);

  return (
    <aside className="sticky top-6 hidden w-[280px] shrink-0 lg:block">
      <div className="rounded-3xl border border-violet-200/70 bg-white p-5 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.25)]">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Background</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-600" />
            {AGENTS.length} agents
          </span>
        </div>
        <h3 className="mt-1 font-manrope text-base font-semibold tracking-tight text-slate-900">
          Working for you
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Always-on. They watch quietly and surface only what matters.
        </p>

        <ul className="mt-4 space-y-3">
          {AGENTS.map((agent) => {
            const finding = findings.get(agent.id);
            const active = finding && Date.now() - finding.createdAt < 30_000;
            return (
              <li key={agent.id} className="flex items-start gap-3">
                <span className={cn("relative mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center", agent.tone)}>
                  {active && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
                  )}
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-slate-900">{agent.name}</p>
                    {finding && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-400">
                        {timeAgo(finding.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {finding ? finding.title : `watching ${agent.watching}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 border-t border-violet-100 pt-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Today</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Observations" value={blocks.filter((b) => b.source === "agent").length} />
            <Stat label="Pinned" value={blocks.filter((b) => b.pinned).length} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-violet-50/60 px-3 py-2">
      <p className="font-manrope text-lg font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    </div>
  );
}
