"use client";

/**
 * AgentsRail — right-side persistent surface showing background agents.
 *
 * Fully dynamic:
 *   - Personas are derived from recent canvas activity (capability invocations,
 *     agent log titles). Each unique capability/persona that fired in the
 *     RECENT_WINDOW shows up as a row.
 *   - We pad up to MAX_VISIBLE rows from a small "always-watching" baseline so
 *     the rail isn't empty on cold start (those baseline rows render greyed
 *     out / idle until they actually fire).
 *   - The "+ N agents more" footer is fetched live from
 *     /api/capabilities/list so it auto-reflects new capabilities added to the
 *     registry — never hardcoded.
 */

import { useEffect, useMemo, useState } from "react";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { cn } from "@/lib/utils";
import { toolLabel, toolWatching } from "@/lib/commandbar/tool-meta";

const MAX_VISIBLE = 5;
const RECENT_WINDOW_MS = 60 * 60 * 1000; // 1h
const ACTIVE_WINDOW_MS = 30_000;

/** Tiny baseline so the rail isn't empty before any agent has fired.
 *  IDs must match TOOL_META keys so labels/subtitles stay consistent. */
const BASELINE: Array<{ id: string; tone: string }> = [
  { id: "treasury_watcher", tone: "text-violet-600" },
  { id: "yield_optimizer", tone: "text-emerald-600" },
  { id: "risk_sentinel", tone: "text-amber-600" },
  { id: "mev_guard", tone: "text-sky-600" },
  { id: "simulation_firewall", tone: "text-rose-600" },
];

const TONE_PALETTE = [
  "text-violet-600",
  "text-emerald-600",
  "text-amber-600",
  "text-sky-600",
  "text-rose-600",
  "text-fuchsia-600",
  "text-cyan-600",
  "text-orange-600",
];

interface DerivedAgent {
  id: string;
  name: string;
  watching: string;
  tone: string;
  lastTitle?: string;
  lastAt?: number;
}

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

// Normalize ids so `execute-swap`, `execute_swap`, `EXECUTE_SWAP` all collapse
// to the same persona key (and match TOOL_META lookups).
function normalizeId(id: string): string {
  return String(id).toLowerCase().trim().replace(/-+/g, "_");
}

export function AgentsRail() {
  const { blocks } = useCanvas();
  const [, force] = useState(0);
  const [totalCapabilities, setTotalCapabilities] = useState<number | null>(null);

  // Tick every 5s so timeAgo stays live.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  // Fetch total capability count once — drives the "+ N more" footer.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/capabilities/list")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.count === "number") setTotalCapabilities(data.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive agent personas from recent canvas activity.
  const { visible, activeCount } = useMemo(() => {
    const now = Date.now();
    const acc = new Map<string, DerivedAgent>();

    // Seed baseline (idle by default).
    for (const b of BASELINE) {
      acc.set(b.id, { id: b.id, name: b.name, watching: b.watching, tone: b.tone });
    }

    // Walk canvas blocks; attribute activity to personas. We look at:
    //   1. Agent-sourced blocks (background observations)
    //   2. CommandBar plan blocks — their payload.steps[].title contains the
    //      actual capability ids that ran (execute_swap, simulate_route, …).
    //      Without this, every command appears as a single "commandbar" entry
    //      and the rail looks dead.
    let toneIdx = 0;
    const bumpPersona = (rawId: string, at: number, title?: string) => {
      const id = String(rawId).toLowerCase().trim();
      if (!id) return;
      const existing = acc.get(id);
      if (existing) {
        if (!existing.lastAt || existing.lastAt < at) {
          existing.lastAt = at;
          if (title) existing.lastTitle = title;
        }
      } else {
        acc.set(id, {
          id,
          name: humanize(id),
          watching: "live capability",
          tone: TONE_PALETTE[toneIdx++ % TONE_PALETTE.length],
          lastAt: at,
          lastTitle: title,
        });
      }
    };

    for (const block of blocks) {
      if (now - block.createdAt > RECENT_WINDOW_MS) continue;
      const payload = (block.payload ?? {}) as {
        agentId?: string;
        capability?: string;
        actor?: string;
        steps?: Array<{
          title?: string;
          status?: string;
          subSteps?: Array<{ title?: string; status?: string }>;
        }>;
      };

      // CommandBar plan blocks — surface each capability step AND the
      // pipeline sub-steps (firewall, route sim, risk, mev, resolver) so the
      // rail reflects every agent that actually ran inside the loop.
      if (Array.isArray(payload.steps) && payload.steps.length) {
        for (const step of payload.steps) {
          if (step?.title) bumpPersona(step.title, block.createdAt, step.title);
          if (Array.isArray(step?.subSteps)) {
            for (const sub of step.subSteps) {
              if (sub?.title) bumpPersona(sub.title, block.createdAt, sub.title);
            }
          }
        }
        continue;
      }

      // Agent-sourced blocks.
      if (block.source !== "agent") continue;
      const rawId =
        payload.agentId ||
        payload.capability ||
        payload.actor ||
        block.title.split(/[\s·:—-]/)[0]?.toLowerCase();
      if (rawId) bumpPersona(String(rawId), block.createdAt, block.title);
    }

    // Rank: agents with recent activity first (most recent first), then idle baseline.
    const ranked = Array.from(acc.values()).sort((a, b) => {
      if (a.lastAt && b.lastAt) return b.lastAt - a.lastAt;
      if (a.lastAt) return -1;
      if (b.lastAt) return 1;
      return 0;
    });

    const visible = ranked.slice(0, MAX_VISIBLE);
    const activeCount = ranked.filter((a) => a.lastAt && now - a.lastAt < RECENT_WINDOW_MS).length;
    return { visible, activeCount };
  }, [blocks]);

  // "+ N more" — total registry minus what we're showing. Never negative.
  const remaining = totalCapabilities != null ? Math.max(0, totalCapabilities - visible.length) : null;

  return (
    <aside className="sticky top-6 hidden w-[280px] shrink-0 lg:block">
      <div className="rounded-3xl border border-violet-200/70 bg-white p-5 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.25)]">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Background</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
            <span className={cn("h-1.5 w-1.5 rounded-full bg-violet-600", activeCount > 0 && "animate-pulse")} />
            {activeCount} active
          </span>
        </div>
        <h3 className="mt-1 font-manrope text-base font-semibold tracking-tight text-slate-900">
          Working for you
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Always-on. They watch quietly and surface only what matters.
        </p>

        <ul className="mt-4 space-y-3">
          {visible.map((agent) => {
            const isIdle = !agent.lastAt;
            const isActive = agent.lastAt && Date.now() - agent.lastAt < ACTIVE_WINDOW_MS;
            return (
              <li key={agent.id} className={cn("flex items-start gap-3", isIdle && "opacity-50")}>
                <span
                  className={cn(
                    "relative mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center",
                    isIdle ? "text-slate-300" : agent.tone,
                  )}
                >
                  {isActive && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
                  )}
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-slate-900">{agent.name}</p>
                    {agent.lastAt && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-400">
                        {timeAgo(agent.lastAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {agent.lastTitle ? agent.lastTitle : `watching ${agent.watching}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        {remaining != null && remaining > 0 && (
          <p className="mt-3 text-[11px] text-slate-400">
            + {remaining} agent{remaining === 1 ? "" : "s"} more
          </p>
        )}

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
