"use client";

// Feature: commandbar-god-mode
// EmptyState shown when chat thread is empty. Redesigned for Stripe-inspired
// light Dreyv theme: soft violet hero, semantic tokens, grouped capability chips.

import React from "react";
import { ArrowRight } from "lucide-react";
import { DryvMascot } from "@/components/brand/dryv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface EmptyStateProps {
  onChipClick: (text: string) => void;
}

// Refreshed per Sid feedback (2026-05-07): focus on cost reduction + yield,
// not generic "swap" / "scaffold a mini-app" demos.
const EXAMPLE_COMMANDS = [
  {
    text: "Show fees and slippage I've paid in the last 12 months",
    label: "Audit my costs",
    pillar: "fees",
  },
  {
    text: "Find the safest yield on my idle stables with AUM and risk",
    label: "Park idle stables",
    pillar: "yield",
  },
  {
    text: "Compare top 3 yield protocols for my SOL with risk and TVL",
    label: "Compare yield options",
    pillar: "yield",
  },
  {
    text: "Reduce my swap costs — route via the cheapest path next time",
    label: "Cut swap costs",
    pillar: "fees",
  },
  {
    text: "Spot drift, concentration, and runway risks in my treasury",
    label: "Find hidden risks",
    pillar: "risk",
  },
];

const PILLAR_META: Record<string, { ring: string }> = {
  fees:  { ring: "hover:border-violet-300" },
  yield: { ring: "hover:border-violet-300" },
  risk:  { ring: "hover:border-violet-300" },
};

export function EmptyState({ onChipClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col gap-7 px-7 pt-8 pb-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0 pt-1">
          <Sparkle size={28} className="text-violet-600" fill="currentColor" />
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
