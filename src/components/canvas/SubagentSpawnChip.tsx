"use client";

/**
 * SubagentSpawnChip — small footer action on every canvas block letting the
 * user promote a one-shot finding into a recurring/monitoring subagent.
 *
 * Variants:
 *   - "default"  → quiet "Watch this" / "Schedule" chip (always visible)
 *   - "promoted" → solid violet "Dreyv suggests watching this" pill (when
 *                  block.payload.suggestSubagent is truthy)
 *
 * v1 spawns with sensible defaults (daily interval, no trigger). The user
 * can refine cadence + condition from the SubagentsPanel after creation.
 */

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { CanvasBlock } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";

interface Props {
  block: CanvasBlock;
  /** Override raw command text; defaults to block.title. */
  defaultRawText?: string;
}

export function SubagentSpawnChip({ block, defaultRawText }: Props) {
  const { publicKey } = useWallet();
  const [state, setState] = useState<"idle" | "spawning" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const payload = (block.payload as Record<string, unknown> | undefined) ?? {};
  const promoted = Boolean(payload.suggestSubagent);

  // Only show on block types where recurring monitoring makes sense.
  // Conversational/Q&A/empty-state blocks (narrative, suggestion, artifact)
  // get nothing unless Dreyv explicitly promoted it.
  const WATCHABLE: ReadonlyArray<string> = [
    "metric",
    "chart",
    "watcher",
    "plan",
    "decision",
    "capability-result",
    "research-brief",
  ];
  const watchable = WATCHABLE.includes(block.type);
  if (!watchable && !promoted) return null;

  async function handleSpawn() {
    if (state === "spawning") return;
    setState("spawning");
    setMsg(null);
    try {
      const rawText =
        defaultRawText ||
        (typeof (block.payload as Record<string, unknown>)?.prompt === "string"
          ? String((block.payload as Record<string, unknown>).prompt)
          : block.title);
      const res = await fetch("/api/dacs/subagents/spawn-from-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey?.toBase58() ?? null,
          block: {
            id: block.id,
            type: block.type,
            title: block.title,
            payload: block.payload,
          },
          rawText,
          intervalSeconds: 86_400,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setState("error");
        setMsg("Couldn't schedule");
        return;
      }
      setState("ok");
      setMsg("Watching · daily");
    } catch {
      setState("error");
      setMsg("Couldn't schedule");
    }
  }

  if (promoted && state === "idle") {
    return (
      <button
        onClick={handleSpawn}
        className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-violet-700"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor"><path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" /></svg>
        Dreyv suggests watching this
      </button>
    );
  }

  return (
    <button
      onClick={handleSpawn}
      disabled={state === "spawning" || state === "ok"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition",
        state === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : state === "error"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-violet-200 text-violet-700 hover:bg-violet-50",
      )}
    >
      {state === "spawning" ? "Scheduling…" : msg ?? "Watch this"}
    </button>
  );
}
