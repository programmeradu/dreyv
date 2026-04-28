"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Surface } from "@/components/app-shell/primitives";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import type { CanvasBlock, CanvasBlockSource } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";
import { SubagentSpawnChip } from "./SubagentSpawnChip";

const SOURCE_LABEL: Record<CanvasBlockSource, string> = {
  commandbar: "from CommandBar",
  agent: "from Dreyv",
  user: "by you",
  page: "from this page",
  capability: "from Capability",
};

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Re-renders every 5s so timestamps stay live without prop drilling. */
function useLiveLabel(createdAt: number): string {
  const [label, setLabel] = useState(() => timeAgo(createdAt));
  useEffect(() => {
    const id = window.setInterval(() => setLabel(timeAgo(createdAt)), 5000);
    return () => window.clearInterval(id);
  }, [createdAt]);
  return label;
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
  const ago = useLiveLabel(block.createdAt);
  const accentBar: Record<string, string> = {
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    slate: "bg-slate-400",
  };

  // accent retained for API compatibility but no longer rendered as a bar
  void accent;
  void accentBar;

  return (
    <Surface className="relative overflow-hidden">
      {/* Dreyv logo watermark — tinted via CSS mask so it actually shows on light cards */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -bottom-14 h-52 w-52 bg-violet-600 opacity-[0.07]"
        style={{
          WebkitMaskImage: "url(/dreyv-mark.svg)",
          maskImage: "url(/dreyv-mark.svg)",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
      <div className="relative flex items-stretch">
        <div className="flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                <span>{SOURCE_LABEL[block.source]}</span>
                <span className="text-slate-300">·</span>
                <span>{ago}</span>
                {block.origin && (
                  <>
                    <span className="hidden text-slate-300 sm:inline">·</span>
                    <span className="hidden truncate sm:inline">{block.origin}</span>
                  </>
                )}
              </div>
              <h3 className="mt-1 break-words text-base font-semibold tracking-tight text-slate-900">
                {block.title}
              </h3>
              {block.subtitle && (
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{block.subtitle}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => pinBlock(block.id)}
                className={cn(
                  "rounded-full p-1.5 transition",
                  block.pinned
                    ? "text-violet-700 hover:bg-violet-50"
                    : "text-slate-400 hover:bg-violet-50 hover:text-violet-700",
                )}
                aria-label={block.pinned ? "Unpin" : "Pin"}
                title={block.pinned ? "Unpin" : "Pin to canvas"}
              >
                {/* Brand glyph: filled vs outlined diamond */}
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill={block.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" />
                </svg>
              </button>
              <button
                onClick={() => removeBlock(block.id)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                aria-label="Dismiss"
                title="Dismiss"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-3">{children}</div>
          <div className="mt-3 flex items-center justify-end empty:hidden empty:mt-0">
            <SubagentSpawnChip block={block} />
          </div>
        </div>
      </div>
    </Surface>
  );
}
