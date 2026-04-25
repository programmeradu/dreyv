"use client";

/**
 * Smart suggestion cards — the user-facing form of agent recommendations.
 * No agent IDs, no confidence scores, no JSON. Just: what, why, and a clean CTA.
 */

import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { Surface, Pill } from "./primitives";

export interface Suggestion {
  id: string;
  kind: "earn" | "protect" | "rebalance";
  title: string;
  detail: string;
  cta: string;
}

const KIND_META: Record<Suggestion["kind"], { icon: ReactNode; tone: "violet" | "emerald" | "rose"; label: string }> = {
  earn: { icon: <TrendingUp className="h-4 w-4" />, tone: "emerald", label: "Earn more" },
  protect: { icon: <ShieldCheck className="h-4 w-4" />, tone: "violet", label: "Protect" },
  rebalance: { icon: <Sparkles className="h-4 w-4" />, tone: "violet", label: "Refine" },
};

export function SuggestionList({
  suggestions,
  onAct,
}: {
  suggestions: Suggestion[];
  onAct?: (id: string) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <Surface className="p-7 text-sm text-slate-500">
        Nothing to suggest right now — your treasury is in a calm spot.
      </Surface>
    );
  }
  return (
    <div className="space-y-3">
      {suggestions.map((s, i) => {
        const meta = KIND_META[s.kind];
        return (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <Surface className="group p-5 transition-shadow hover:shadow-[0_24px_48px_-20px_rgba(124,58,237,0.28)]">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-violet-200">
                  {meta.icon}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                  </div>
                  <h3 className="font-manrope text-base font-semibold text-slate-900">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{s.detail}</p>
                </div>
                <button
                  onClick={() => onAct?.(s.id)}
                  className="flex flex-none items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98]"
                >
                  {s.cta}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </Surface>
          </motion.div>
        );
      })}
    </div>
  );
}
