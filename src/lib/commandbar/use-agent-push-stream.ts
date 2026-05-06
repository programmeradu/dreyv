"use client";
/**
 * Phase 7 — Subscribes to /api/command/stream and:
 *  1. surfaces toasts for autopilot runs, new proposals, and tool errors,
 *  2. dispatches a window event "agent:push" so the CommandBar (or any
 *     interested page) can inject the event into the agent's next turn.
 *
 * Mounted once at /app layout level. Auto-reconnects.
 */
import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast-notifications";

export interface AgentPushEvent {
  kind: "proposal" | "autopilot_run" | "tool_error";
  [k: string]: unknown;
}

export function useAgentPushStream(enabled: boolean = true) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let backoff = 1000;

    const connect = () => {
      if (stopped) return;
      try {
        const es = new EventSource("/api/command/stream", { withCredentials: true });
        esRef.current = es;

        es.addEventListener("agent_push", (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as AgentPushEvent;
            window.dispatchEvent(new CustomEvent("agent:push", { detail: data }));

            if (data.kind === "proposal") {
              toast.message("New agent proposal", {
                description: String((data as any).title || "Awaiting your decision"),
              });
            } else if (data.kind === "autopilot_run" && (data as any).status === "queued") {
              toast.message("Autopilot queued an action", {
                description: `Job ${(data as any).jobId} → inbox`,
              });
            } else if (data.kind === "tool_error") {
              toast.error("Agent tool error", {
                description: `${(data as any).capabilityId}: ${(data as any).errorCode || "unknown"}`,
              });
            }
          } catch { /* ignore */ }
        });

        es.onerror = () => {
          es.close();
          if (stopped) return;
          backoff = Math.min(backoff * 2, 30_000);
          setTimeout(connect, backoff);
        };
        es.onopen = () => { backoff = 1000; };
      } catch (e) {
        console.warn("[agent-push] connect failed", e);
      }
    };

    connect();
    return () => {
      stopped = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled]);
}
