"use client";

// Feature: commandbar-god-mode
// EmptyState shown when chat thread is empty.
// Starter prompts are LLM-generated fresh each mount via /api/command/starter-prompts
// (per Sid feedback 2026-05-07: focus on cost reduction, yield, risk; never hardcode).

import React, { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { DryvMascot } from "@/components/brand/dryv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface EmptyStateProps {
  onChipClick: (text: string) => void;
}

interface StarterPrompt {
  label: string;
  text: string;
  pillar: "fees" | "yield" | "risk" | string;
}

// Skeleton shape only — never shown as text. Real prompts come from the LLM.
const SKELETON: StarterPrompt[] = Array.from({ length: 5 }, (_, i) => ({
  label: "",
  text: "",
  pillar: ["fees", "yield", "risk", "fees", "yield"][i],
}));

export function EmptyState({ onChipClick }: EmptyStateProps) {
  const [prompts, setPrompts] = useState<StarterPrompt[]>(SKELETON);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/command/starter-prompts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data?.prompts) ? data.prompts.slice(0, 5) : [];
        if (next.length > 0) setPrompts(next);
      })
      .catch(() => {
        // Soft-fail: keep skeletons hidden, show single fallback hint.
        if (!cancelled) {
          setPrompts([
            { label: "Get started", text: "What can you do for my treasury?", pillar: "risk" },
          ]);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="flex flex-col gap-7 px-7 pt-8 pb-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <DryvMascot pose="greet" size={56} glow priority alt="Dryv mascot" />
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <h2 className="text-[22px] leading-tight font-semibold tracking-tight text-foreground">
            Hello, I'm <span className="text-violet-600">Dryv</span>.
          </h2>
          <p className="text-sm text-muted-foreground">
            Your treasury copilot — ask me to cut costs, find safer yield, or surface hidden risks.
          </p>
        </div>
      </div>

      {/* Capability chips */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/70">
            Try one of these
          </span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/70 hover:text-violet-600 transition-colors flex items-center gap-1.5 disabled:opacity-40"
            aria-label="Regenerate starter prompts"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            New ideas
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {prompts.map((cmd, i) => {
            if (loading || !cmd.text) {
              return (
                <div
                  key={`sk-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 animate-pulse"
                >
                  <DreyvStar size={10} className="shrink-0 text-violet-200" />
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div className="h-2 w-20 rounded bg-violet-100" />
                    <div className="h-2.5 w-3/4 rounded bg-violet-100/70" />
                  </div>
                </div>
              );
            }
            return (
              <button
                key={`${cmd.text}-${i}`}
                type="button"
                onClick={() => onChipClick(cmd.text)}
                className="group flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 text-left transition-all hover:bg-background hover:shadow-sm hover:border-violet-300"
              >
                <DreyvStar size={10} className="shrink-0 text-violet-600" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {cmd.label}
                  </span>
                  <span className="text-sm text-foreground truncate">{cmd.text}</span>
                </div>
                <ArrowRight
                  size={14}
                  className="text-muted-foreground/40 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all shrink-0"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
