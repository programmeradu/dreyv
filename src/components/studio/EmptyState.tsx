"use client";

import { useState } from "react";
import { Sparkles, ArrowRight, FolderOpen, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onSubmit: (prompt: string) => void;
  onOpenTemplates: () => void;
  onOpenRecent: () => void;
  isSubmitting?: boolean;
}

const EXAMPLES = [
  "A staking dashboard for mSOL holders",
  "A token-gated chat using my SPL token",
  "A DCA bot UI with Jupiter routes",
  "A Squads multisig viewer",
];

export function EmptyState({ onSubmit, onOpenTemplates, onOpenRecent, isSubmitting }: EmptyStateProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v.length < 6 || isSubmitting) return;
    onSubmit(v);
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 overflow-y-auto">
      <div className="w-full max-w-2xl px-6 py-12 mx-auto">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-black tracking-[0.3em] text-primary uppercase">
            Dreyv Studio
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-center text-4xl md:text-5xl font-bold tracking-tight mb-3 text-foreground">
          What do you want to build?
        </h1>
        <p className="text-center text-sm text-muted-foreground mb-10 max-w-md mx-auto leading-relaxed">
          Describe a real Solana app. We'll wire real RPCs, real APIs, and real on-chain calls — never mocks.
        </p>

        {/* Prompt box */}
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="relative group">
            <div className="absolute -inset-px bg-gradient-to-r from-primary/40 via-primary/10 to-primary/40 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm" />
            <div className="relative bg-card border border-border rounded-2xl p-2 shadow-lg">
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="A staking dashboard for mSOL holders…"
                rows={3}
                className="w-full bg-transparent border-0 outline-none resize-none px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/60 font-sans"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }}
              />
              <div className="flex items-center justify-between px-3 pb-2 pt-1">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
                  ⌘ + Enter to generate plan
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={value.trim().length < 6 || isSubmitting}
                  className="gap-2 h-9 px-4 font-semibold"
                >
                  {isSubmitting ? (
                    <>
                      <Sparkles size={14} className="animate-spin" />
                      Planning…
                    </>
                  ) : (
                    <>
                      Generate plan
                      <ArrowRight size={14} />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>

        {/* Examples */}
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70 font-bold mb-3 text-center">
            Examples
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setValue(ex)}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted/40 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors text-muted-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-bold">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Secondary actions */}
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={onOpenTemplates} className="gap-2">
            <LayoutTemplate size={14} />
            Start from template
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenRecent} className="gap-2 text-muted-foreground">
            <FolderOpen size={14} />
            Open recent
          </Button>
        </div>
      </div>
    </div>
  );
}
