"use client";

import { Pin, PinOff, X } from "lucide-react";
import type { ReactNode } from "react";
import { Surface } from "@/components/app-shell/primitives";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import type { CanvasBlock, CanvasBlockSource } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<CanvasBlockSource, string> = {
  commandbar: "from CommandBar",
  agent: "from Dreyv",
  user: "by you",
  page: "from this page",
  capability: "from Capability",
};

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function BlockShell({
  block,
  children,
  accent,
}: {
  block: CanvasBlock;
  children: ReactNode;
  accent?: "violet" | "emerald" | "rose" | "slate";
}) {
  const { pinBlock, removeBlock } = useCanvas();
  const accentBar: Record<string, string> = {
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    slate: "bg-slate-400",
  };

  return (
    <Surface className="overflow-hidden">
      <div className="flex items-stretch">
        <div className={cn("w-[3px] shrink-0", accentBar[accent ?? "violet"])} />
        <div className="flex-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                <span>{SOURCE_LABEL[block.source]}</span>
                <span className="text-slate-300">·</span>
                <span>{timeAgo(block.createdAt)}</span>
                {block.origin && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="truncate">{block.origin}</span>
                  </>
                )}
              </div>
              <h3 className="mt-1 truncate text-base font-semibold tracking-tight text-slate-900">
                {block.title}
              </h3>
              {block.subtitle && (
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{block.subtitle}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => pinBlock(block.id)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-violet-50 hover:text-violet-700"
                aria-label={block.pinned ? "Unpin" : "Pin"}
                title={block.pinned ? "Unpin" : "Pin to canvas"}
              >
                {block.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => removeBlock(block.id)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                aria-label="Dismiss"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-3">{children}</div>
        </div>
      </div>
    </Surface>
  );
}
