"use client";

/**
 * The heart of the new generative app shell: a streaming narrative.
 *
 * Instead of a terminal of agent IDs and tick logs, Dreyv tells the user
 * what's happening in plain language — "Watching SOL price slip past $148",
 * "Earned $42 in the last hour", "Recommending you rebalance 3% USDC into JitoSOL".
 *
 * The narrative auto-rotates and lightly streams character-by-character so it
 * feels alive without ever exposing the underlying agent system.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Surface } from "./primitives";

interface NarrativeBeat {
  tone: "watching" | "earned" | "noticed" | "recommending" | "calm";
  text: string;
}

const BEATS: NarrativeBeat[] = [
  { tone: "calm", text: "Your treasury is healthy. Nothing needs your attention right now." },
  { tone: "watching", text: "Watching SOL volatility — a few small moves, nothing alarming." },
  { tone: "earned", text: "Yield is compounding quietly across your stable positions." },
  { tone: "noticed", text: "A swap opportunity opened on Jupiter for one of your pairs." },
  { tone: "recommending", text: "Holding a small idle balance — you can put it to work whenever you’re ready." },
];

const TONE_DOT: Record<NarrativeBeat["tone"], string> = {
  calm: "bg-violet-400",
  watching: "bg-violet-500",
  earned: "bg-emerald-500",
  noticed: "bg-amber-500",
  recommending: "bg-violet-600",
};

const TONE_LABEL: Record<NarrativeBeat["tone"], string> = {
  calm: "All clear",
  watching: "Watching",
  earned: "Earning",
  noticed: "Noticed",
  recommending: "Suggestion",
};

export function NarrativeStream() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % BEATS.length);
    }, 5500);
    return () => clearInterval(id);
  }, []);

  const beat = BEATS[index];

  return (
    <Surface glow className="overflow-hidden p-7 md:p-9">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
        <Sparkles className="h-3.5 w-3.5" />
        Dreyv is on it
      </div>

      <div className="mt-5 min-h-[120px] md:min-h-[96px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[beat.tone]} shadow-[0_0_12px_currentColor]`} />
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {TONE_LABEL[beat.tone]}
              </span>
            </div>
            <p className="font-manrope text-xl leading-snug text-slate-900 md:text-2xl">
              {beat.text}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-center gap-1.5">
        {BEATS.map((_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all duration-500 ${
              i === index ? "w-8 bg-violet-500" : "w-2 bg-violet-200"
            }`}
          />
        ))}
      </div>
    </Surface>
  );
}
