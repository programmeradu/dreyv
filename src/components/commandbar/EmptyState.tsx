"use client";

// Feature: commandbar-god-mode
// EmptyState shown when chat thread is empty. Redesigned for Stripe-inspired
// light Dreyv theme: soft violet hero, semantic tokens, grouped capability chips.

import React from "react";
import { Sparkles, ArrowRight } from "lucide-react";

interface EmptyStateProps {
  onChipClick: (text: string) => void;
}

const EXAMPLE_COMMANDS = [
  { text: "Swap 100 SOL to USDC", label: "Execute a swap", pillar: "treasury" },
  { text: "Run a runway projection at $15k/mo burn", label: "Project runway", pillar: "foresight" },
  { text: "Research Kamino Finance documentation", label: "Research a protocol", pillar: "research" },
  { text: "Initialize a DeFi dashboard mini-app", label: "Scaffold a mini-app", pillar: "studio" },
  { text: "Set a SOL price alert below $100", label: "Set a price alert", pillar: "monitoring" },
];

const PILLAR_META: Record<string, { dot: string; ring: string }> = {
  treasury:   { dot: "bg-blue-500",    ring: "hover:border-blue-300" },
  foresight:  { dot: "bg-violet-500",  ring: "hover:border-violet-300" },
  research:   { dot: "bg-fuchsia-500", ring: "hover:border-fuchsia-300" },
  studio:     { dot: "bg-emerald-500", ring: "hover:border-emerald-300" },
  monitoring: { dot: "bg-amber-500",   ring: "hover:border-amber-300" },
};

export function EmptyState({ onChipClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col gap-7 px-7 pt-8 pb-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-400/30 to-fuchsia-300/20 blur-md" />
          <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Sparkles size={20} className="text-white" />
          </div>
        </div>
        <div className="flex flex-col gap-1 pt-0.5">
          <h2 className="text-[22px] leading-tight font-semibold tracking-tight text-foreground">
            Hello, I'm <span className="text-violet-600">dreyv</span>.
          </h2>
          <p className="text-sm text-muted-foreground">
            Your platform-wide execution layer — describe an intent and I'll plan, simulate, or execute it.
          </p>
        </div>
      </div>

      {/* Capability chips */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/70 px-1">
          Try one of these
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EXAMPLE_COMMANDS.map((cmd) => {
            const meta = PILLAR_META[cmd.pillar];
            return (
              <button
                key={cmd.text}
                type="button"
                onClick={() => onChipClick(cmd.text)}
                className={`group flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 text-left transition-all hover:bg-background hover:shadow-sm ${meta?.ring ?? ""}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot ?? "bg-muted-foreground"} shrink-0`} />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {cmd.label}
                  </span>
                  <span className="text-sm text-foreground truncate">
                    {cmd.text}
                  </span>
                </div>
                <ArrowRight size={14} className="text-muted-foreground/40 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { EXAMPLE_COMMANDS };
