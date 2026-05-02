"use client";

/**
 * WatcherCanvasBridge — polls /api/treasury/watcher-events for the active vault
 * and streams each new sub-agent watcher episode (runway autopilot,
 * liquidation, gas-tank, grants) as a narrative block into the shared canvas.
 *
 * No mocks: if no watcher rows exist for the wallet in the lookback window,
 * the bridge stays silent. Each episode is emitted exactly once per session
 * (deduped by episode id).
 */

import { useEffect, useRef } from "react";
import { useVault } from "@/lib/contexts/VaultContext";
import { AppEventBus } from "@/lib/events";

type WatcherEvent = {
  id: string;
  commandId: string;
  walletAddress: string | null;
  intentKind: string;
  outcome: string;
  valueUsd: string | null;
  notes: string | null;
  createdAt: string;
};

const POLL_MS = 30_000;

const TITLES: Record<string, (e: WatcherEvent) => string> = {
  "policy.runway_autopilot": (e) =>
    e.outcome === "needs_attention" ? "Runway falling below your target" : "Runway autopilot check-in",
  "risk.liquidation_watch": (e) =>
    e.outcome === "needs_attention" ? "Liquidation health factor breach" : "Liquidation watcher tick",
  "gas_tank_refill_drafted": () => "Gas tank — refill drafted",
  "grant_milestone": () => "Grant milestone verified",
};

function relativeTime(iso: string): string {
  const dt = Date.now() - new Date(iso).getTime();
  if (dt < 60_000) return "just now";
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  return `${Math.floor(dt / 86_400_000)}d ago`;
}

export function WatcherCanvasBridge() {
  const { activeVault } = useVault();
  const seen = useRef<Set<string>>(new Set());
  const sinceRef = useRef<string>(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  useEffect(() => {
    if (!activeVault) return;

    let cancelled = false;

    async function tick() {
      try {
        const url = `/api/treasury/watcher-events?wallet=${encodeURIComponent(activeVault!)}&since=${encodeURIComponent(sinceRef.current)}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { events?: WatcherEvent[] };
        const events = data.events ?? [];
        if (cancelled || events.length === 0) return;

        for (const e of events.slice().reverse()) {
          if (seen.current.has(e.id)) continue;
          seen.current.add(e.id);

          const title = TITLES[e.intentKind]?.(e) ?? "Dreyv watcher update";
          const subtitle = e.notes
            ? `${e.notes} · ${relativeTime(e.createdAt)}`
            : `${e.outcome} · ${relativeTime(e.createdAt)}`;

          AppEventBus.emit("CANVAS_ADD_BLOCK", {
            id: `watcher-${e.id}`,
            type: "narrative",
            source: "agent",
            origin: "/app/treasury",
            title,
            subtitle,
            payload: {
              intentKind: e.intentKind,
              outcome: e.outcome,
              valueUsd: e.valueUsd ? Number(e.valueUsd) : null,
              commandId: e.commandId,
              createdAt: e.createdAt,
              wallet: e.walletAddress,
              kind: e.outcome === "needs_attention" ? "alert" : "info",
            },
          });
        }

        // Advance the cursor to the newest event we've seen.
        const newest = events.reduce(
          (acc, e) => (new Date(e.createdAt) > new Date(acc) ? e.createdAt : acc),
          sinceRef.current,
        );
        sinceRef.current = newest;
      } catch {
        // Silent — watchers may not have run yet, or DB may be warming up.
      }
    }

    tick();
    const handle = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [activeVault]);

  return null;
}
