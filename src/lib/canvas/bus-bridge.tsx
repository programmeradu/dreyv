"use client";

/**
 * BusBridge — translates the existing AppEventBus traffic into Canvas blocks.
 *
 * Why: every CommandBar handler, agent route, and dashboard widget already
 * emits via `AppEventBus`. Subscribing here (instead of changing each emitter)
 * means the canvas starts populating immediately with no upstream churn.
 *
 * Mapping:
 *   - CANVAS_ADD_BLOCK → addBlock(payload) verbatim (the "modern" path)
 *   - SHOW_STRATEGY_MODAL → plan block
 *   - AGENT_LOG → narrative block (collapsed timeline entry)
 *   - UI_NOTIFICATION → suggestion block (only kind: 'suggestion' / 'insight')
 *
 * NAVIGATE / REFRESH_DASHBOARD / AGENT_COMMAND are intentionally NOT translated —
 * they keep their existing behavior in app/layout.tsx.
 */

import { useEffect } from "react";
import { useAppEvent } from "@/lib/events";
import { useCanvas } from "./CanvasContext";

export function BusBridge() {
  const { addBlock } = useCanvas();

  // useAppEvent already uses a ref to keep the latest callback, but we
  // stash addBlock indirection for clarity.
  useAppEvent((event) => {
    if (!event || !event.type) return;

    switch (event.type) {
      case "SHOW_STRATEGY_MODAL": {
        const p = (event.payload ?? {}) as Record<string, unknown>;
        addBlock({
          type: "plan",
          source: "commandbar",
          title: typeof p.title === "string" ? p.title : "Proposed plan",
          subtitle:
            typeof p.summary === "string"
              ? p.summary
              : typeof p.description === "string"
                ? (p.description as string)
                : undefined,
          payload: p,
        });
        break;
      }

      case "AGENT_LOG": {
        const p = (event.payload ?? {}) as Record<string, unknown>;
        addBlock({
          type: "narrative",
          source: "agent",
          title:
            typeof p.title === "string"
              ? p.title
              : typeof p.actor === "string"
                ? `${p.actor}`
                : "Dreyv noticed something",
          subtitle:
            typeof p.message === "string"
              ? (p.message as string)
              : typeof p.detail === "string"
                ? (p.detail as string)
                : undefined,
          payload: p,
        });
        break;
      }

      case "UI_NOTIFICATION": {
        const p = (event.payload ?? {}) as Record<string, unknown>;
        const kind = typeof p.kind === "string" ? p.kind : "info";
        // Only promote suggestion-grade notifications onto the canvas; transient
        // toasts stay in the toast layer.
        if (kind !== "suggestion" && kind !== "insight") return;
        addBlock({
          type: "suggestion",
          source: "agent",
          title:
            typeof p.title === "string" ? (p.title as string) : "Dreyv suggests",
          subtitle:
            typeof p.message === "string" ? (p.message as string) : undefined,
          payload: p,
        });
        break;
      }

      // Modern path: components/agents that explicitly target the canvas.
      // Payload shape is `Omit<CanvasBlock,'id'|'createdAt'>`.
      // We tolerate missing fields with sensible defaults.
      // eslint-disable-next-line no-fallthrough
      default:
        if (event.type === ("CANVAS_ADD_BLOCK" as unknown)) {
          const p = (event.payload ?? {}) as Record<string, unknown>;
          addBlock({
            type: (p.type as never) ?? "narrative",
            source: (p.source as never) ?? "agent",
            title: typeof p.title === "string" ? (p.title as string) : "Update",
            subtitle: typeof p.subtitle === "string" ? (p.subtitle as string) : undefined,
            origin: typeof p.origin === "string" ? (p.origin as string) : undefined,
            payload: (p.payload as Record<string, unknown>) ?? {},
            pinned: p.pinned === true,
          });
        }
    }
  });

  // Sentinel for tree-shake friendliness.
  useEffect(() => undefined, []);

  return null;
}
