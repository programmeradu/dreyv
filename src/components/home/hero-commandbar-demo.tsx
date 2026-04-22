"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Check, Shield, Zap } from "lucide-react";

type Step = {
  command: string;
  reasoning: string;
  result: {
    title: string;
    from: string;
    to: string;
    rate: string;
    impact: string;
  };
};

const STEPS: Step[] = [
  {
    command: "Swap 500 SOL to USDC via Jupiter, max 0.5% slippage",
    reasoning: "Routing through Jupiter v6 · 3 hops · Simulating…",
    result: {
      title: "Simulation passed",
      from: "500 SOL",
      to: "43,150 USDC",
      rate: "1 SOL ≈ $86.30",
      impact: "0.12%",
    },
  },
  {
    command: "Rebalance treasury: 60% SOL, 30% USDC, 10% JTO",
    reasoning: "Computing optimal route across 4 venues…",
    result: {
      title: "Plan ready · 3 txs",
      from: "Current drift 8.4%",
      to: "Target reached",
      rate: "Net cost $12.40",
      impact: "0.08%",
    },
  },
  {
    command: "Stake idle SOL on Marinade for max yield",
    reasoning: "Comparing Marinade · Jito · Sanctum LSTs…",
    result: {
      title: "Best route: mSOL",
      from: "1,200 SOL",
      to: "1,198.4 mSOL",
      rate: "APY 7.8%",
      impact: "0.00%",
    },
  },
];

export function HeroCommandbarDemo() {
  const [stepIdx, setStepIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "thinking" | "result">("typing");

  const step = STEPS[stepIdx];

  // Typewriter
  useEffect(() => {
    if (phase !== "typing") return;
    setTyped("");
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(step.command.slice(0, i));
      if (i >= step.command.length) {
        clearInterval(id);
        setTimeout(() => setPhase("thinking"), 500);
      }
    }, 28);
    return () => clearInterval(id);
  }, [phase, step.command]);

  // Thinking → Result
  useEffect(() => {
    if (phase === "thinking") {
      const t = setTimeout(() => setPhase("result"), 1200);
      return () => clearTimeout(t);
    }
    if (phase === "result") {
      const t = setTimeout(() => {
        setStepIdx((i) => (i + 1) % STEPS.length);
        setPhase("typing");
      }, 3200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  return (
    <div className="relative w-full max-w-lg">
      {/* Ambient glow */}
      <div className="absolute -inset-10 bg-violet-400/[0.12] blur-[90px] rounded-full pointer-events-none" />

      {/* Card frame */}
      <div className="relative rounded-2xl bg-white ring-1 ring-slate-200/80 marketing-shadow-float overflow-hidden">
        {/* Command input */}
        <div className="px-5 pt-5">
          <div className="flex items-start gap-3 rounded-xl bg-slate-50/80 ring-1 ring-slate-200/70 px-4 py-3.5">
            <Sparkles className="w-4 h-4 text-violet-600 mt-0.5 shrink-0" />
            <div className="flex-1 text-[14px] leading-snug text-slate-800 font-medium min-h-[20px]">
              {typed}
              {phase === "typing" && (
                <span className="inline-block w-[2px] h-[14px] bg-violet-600 align-middle ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        </div>

        {/* Reasoning / Result */}
        <div className="px-5 pt-3 pb-5 min-h-[180px]">
          <AnimatePresence mode="wait">
            {phase === "thinking" && (
              <motion.div
                key={`think-${stepIdx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-1 py-3 text-[13px] text-slate-500"
              >
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-bounce" />
                </span>
                <span>{step.reasoning}</span>
              </motion.div>
            )}

            {phase === "result" && (
              <motion.div
                key={`result-${stepIdx}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="mt-2 rounded-xl bg-white ring-1 ring-violet-200 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </span>
                    <span className="text-[13px] font-semibold text-slate-900">
                      {step.result.title}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-violet-600">
                    Ready to sign
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">From</div>
                    <div className="text-[13px] font-semibold text-slate-900 mt-0.5">
                      {step.result.from}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-violet-600 shrink-0" />
                  <div className="flex-1 rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">To</div>
                    <div className="text-[13px] font-semibold text-slate-900 mt-0.5">
                      {step.result.to}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-violet-600" />
                    {step.result.rate}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-3 h-3 text-violet-600" />
                    Impact {step.result.impact}
                  </span>
                </div>

                <button className="mt-4 w-full rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold py-2.5 transition-colors">
                  Sign &amp; Execute
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Step indicator dots */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {STEPS.map((_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all duration-300 ${
              i === stepIdx ? "w-6 bg-violet-600" : "w-1.5 bg-slate-300"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
