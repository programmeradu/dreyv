"use client";

// ThinkingBlock — ChatGPT-style collapsible "Thinking…" panel for the CommandBar.
// While the assistant is still working (no final text yet), this block is open
// by default and shows the streaming tool/step activity with a live timer.
// Once the final response begins streaming, the block auto-collapses to a
// compact "Thought for Xs" pill that the user can re-expand.

import React from "react";
import { ChevronDown, Sparkles } from "lucide-react";

interface ThinkingBlockProps {
  /** Active = agent is still working AND has not produced final text yet. */
  active: boolean;
  /** Render the streaming tool cards / intermediate steps inside. */
  children: React.ReactNode;
  /** Optional label to show next to the spinner (e.g. specialist name). */
  label?: string;
}

export function ThinkingBlock({ active, children, label }: ThinkingBlockProps) {
  const startRef = React.useRef<number>(Date.now());
  const [elapsed, setElapsed] = React.useState(0);
  const [open, setOpen] = React.useState(true);
  const [autoCollapsed, setAutoCollapsed] = React.useState(false);

  // Tick timer while active
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);

  // Auto-collapse once the agent transitions from active → done
  React.useEffect(() => {
    if (!active && !autoCollapsed) {
      setOpen(false);
      setAutoCollapsed(true);
    }
  }, [active, autoCollapsed]);

  const seconds = active
    ? elapsed
    : Math.max(1, Math.floor((Date.now() - startRef.current) / 1000));

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <Sparkles
          size={13}
          className={`text-primary shrink-0 ${active ? "animate-pulse" : ""}`}
        />
        <span className="text-xs font-medium text-foreground/80">
          {active ? "Thinking" : "Thought"}
          {label ? ` · ${label}` : ""}
          <span className="ml-1 text-muted-foreground tabular-nums">
            {active ? "…" : ""} {seconds}s
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-1.5 border-t border-border/40 bg-background/40">
          {children}
        </div>
      )}
    </div>
  );
}
