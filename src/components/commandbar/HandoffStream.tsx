"use client";

/**
 * DACS Phase 5.3 — Live handoff ticker.
 *
 * Subscribes to /api/dacs/handoffs/stream via EventSource and renders the
 * last few specialist reports as a compact strip. Designed to drop into the
 * CommandBar above the input row.
 */
import React, { useEffect, useRef, useState } from "react";
import { Network, CheckCircle2, XCircle, Clock, PauseCircle } from "lucide-react";

interface HandoffEvent {
  id: string;
  commandId: string;
  walletAddress: string | null;
  specialist: string;
  intentKind: string;
  status: "accepted" | "completed" | "rejected" | "deferred";
  summary: string;
  durationMs: number | null;
  createdAt: string;
}

const STATUS_META: Record<HandoffEvent["status"], { cls: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  completed: { cls: "text-emerald-600", Icon: CheckCircle2 },
  accepted: { cls: "text-primary", Icon: Clock },
  deferred: { cls: "text-amber-600", Icon: PauseCircle },
  rejected: { cls: "text-destructive", Icon: XCircle },
};

function shortSpec(id: string) {
  return id.replace(/-agent$/, "").replace(/-/g, " ");
}

export interface HandoffStreamProps {
  wallet: string | null;
  commandId?: string;
  max?: number;
  /** When true, render even with zero events and pulse the live indicator. */
  streaming?: boolean;
  /** Notify parent of the most recent in-flight specialist (accepted/deferred). */
  onActiveSpecialistChange?: (specialist: string | null) => void;
}

export function HandoffStream({
  wallet,
  commandId,
  max = 4,
  streaming = false,
  onActiveSpecialistChange,
}: HandoffStreamProps) {
  const [events, setEvents] = useState<HandoffEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!wallet && !commandId) return;
    const params = new URLSearchParams();
    if (wallet) params.set("wallet", wallet);
    if (commandId) params.set("commandId", commandId);
    const url = `/api/dacs/handoffs/stream?${params.toString()}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("handoff", (ev: MessageEvent) => {
      try {
        const row = JSON.parse(ev.data) as HandoffEvent;
        setEvents((prev) => {
          if (prev.some((p) => p.id === row.id)) return prev;
          return [row, ...prev].slice(0, max);
        });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("error", () => setConnected(false));

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [wallet, commandId, max]);

  // Surface the active specialist (most recent accepted/deferred) to the parent
  useEffect(() => {
    if (!onActiveSpecialistChange) return;
    const inFlight = events.find(
      (e) => e.status === "accepted" || e.status === "deferred",
    );
    onActiveSpecialistChange(inFlight ? inFlight.specialist : null);
  }, [events, onActiveSpecialistChange]);

  if (!wallet && !commandId) return null;
  // While streaming, render an empty "waiting on specialists" strip so the
  // user sees the SSE channel is live before the first report lands.
  if (events.length === 0 && !streaming) return null;

  return (
    <div className="px-4 py-2 border-t border-border bg-muted/30">
      <div className="flex items-center gap-2 mb-1.5">
        <Network size={11} className={`text-primary ${streaming ? "animate-pulse" : ""}`} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Specialist activity
        </span>
        <span
          className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`}
          title={connected ? "Live" : "Reconnecting"}
        />
        {events.length === 0 && streaming && (
          <span className="text-[10px] text-muted-foreground/70 italic">
            waiting for specialist reports…
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {events.map((e) => {
          const meta = STATUS_META[e.status] ?? STATUS_META.accepted;
          const Icon = meta.Icon;
          return (
            <li key={e.id} className="flex items-start gap-2 text-[11px] leading-snug">
              <Icon size={11} className={`${meta.cls} mt-0.5 flex-shrink-0`} />
              <span className="font-bold text-foreground/90 whitespace-nowrap">
                {shortSpec(e.specialist)}
              </span>
              <span className="text-muted-foreground truncate flex-1">{e.summary}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
