"use client";

import { useState } from "react";
import { Sparkles, ArrowRight, FolderOpen, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onSubmit: (prompt: string) => void;
  onOpenTemplates: () => void;
  onOpenRecent: () => void;
  isSubmitting?: boolean;
  /** When true, renders inline (fills parent) instead of as a full-screen overlay. */
  inline?: boolean;
}

const EXAMPLES = [
  "A staking dashboard for mSOL holders",
  "A token-gated chat using my SPL token",
  "A DCA bot UI with Jupiter routes",
  "A Squads multisig viewer",
];

/**
 * Studio empty state — premium light, marketing-aligned.
 *
 * Sits as a full-cover overlay with its own opaque background so the dark
 * IDE chrome behind it never bleeds through. Manrope display headline,
 * violet accent, flat chips, single primary CTA.
 */
export function EmptyState({ onSubmit, onOpenTemplates, onOpenRecent, isSubmitting }: EmptyStateProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v.length < 6 || isSubmitting) return;
    onSubmit(v);
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto"
      style={{
        // Full-cover marketing-style background so dark editor never leaks.
        background:
          "radial-gradient(1200px 600px at 20% -10%, hsl(264 96% 96% / 0.9), transparent 60%)," +
          "radial-gradient(800px 500px at 100% 100%, hsl(264 96% 92% / 0.55), transparent 60%)," +
          "linear-gradient(180deg, hsl(40 60% 98%) 0%, hsl(40 50% 96%) 100%)",
      }}
    >
      {/* Subtle grid texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(264 30% 70% / 0.08) 1px, transparent 1px)," +
            "linear-gradient(to bottom, hsl(264 30% 70% / 0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(circle at center, black 40%, transparent 90%)",
        }}
      />

      <div className="relative w-full max-w-2xl px-6 pt-28 md:pt-32 pb-16 mx-auto">
        {/* Brand chip */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 backdrop-blur border border-violet-200/70 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse" />
            <span className="text-[10px] font-bold tracking-[0.25em] text-violet-700 uppercase">
              Dreyv Studio
            </span>
          </span>
        </div>

        {/* Headline — Manrope display via globals */}
        <h1
          className="text-center text-[44px] md:text-[56px] leading-[1.05] font-semibold tracking-[-0.02em] mb-4 text-slate-900"
          style={{ fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif" }}
        >
          What do you want to build?
        </h1>
        <p className="text-center text-[15px] text-slate-600/90 mb-10 max-w-lg mx-auto leading-relaxed">
          Describe a real Solana app. Dreyv wires real RPCs, real APIs, and real on-chain calls — never mocks.
        </p>

        {/* Prompt card */}
        <form onSubmit={handleSubmit} className="mb-7">
          <div className="relative group">
            <div className="absolute -inset-px bg-gradient-to-r from-violet-400/40 via-violet-200/30 to-violet-400/40 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-md" />
            <div className="relative bg-white border border-slate-200/80 rounded-2xl p-2 shadow-[0_20px_50px_-20px_rgba(124,58,237,0.18)]">
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="A staking dashboard for mSOL holders…"
                rows={3}
                className="w-full bg-transparent border-0 outline-none resize-none px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 font-sans"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }}
              />
              <div className="flex items-center justify-between px-3 pb-2 pt-1">
                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">
                  ⌘ + Enter to generate plan
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={value.trim().length < 6 || isSubmitting}
                  className="gap-2 h-9 px-4 font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-[0_8px_20px_-8px_rgba(124,58,237,0.6)]"
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

        {/* Examples — flat chips */}
        <div className="mb-10">
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3 text-center">
            Examples
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setValue(ex)}
                className="text-[13px] px-3.5 py-1.5 rounded-full border border-slate-200/80 bg-white hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 transition-colors text-slate-600"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-slate-200/80" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">or</span>
          <div className="flex-1 h-px bg-slate-200/80" />
        </div>

        {/* Secondary actions */}
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenTemplates}
            className="gap-2 h-9 rounded-full border-slate-200 text-slate-700 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50"
          >
            <LayoutTemplate size={14} />
            Browse templates
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenRecent}
            className="gap-2 h-9 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <FolderOpen size={14} />
            Open recent
          </Button>
        </div>
      </div>
    </div>
  );
}
