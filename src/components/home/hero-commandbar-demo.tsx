"use client";

import { useEffect, useState } from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";

const COMMANDS = [
  "Swap 500 SOL to USDC via Jupiter, max 0.5% slippage",
  "Rebalance treasury: 60% SOL, 30% USDC, 10% JTO",
  "Stake idle SOL on Marinade for max yield",
];

export function HeroCommandbarDemo() {
  const [cmdIdx, setCmdIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "hold" | "erasing">("typing");

  const command = COMMANDS[cmdIdx];

  useEffect(() => {
    if (phase === "typing") {
      if (typed.length >= command.length) {
        const t = setTimeout(() => setPhase("hold"), 1800);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setTyped(command.slice(0, typed.length + 1)), 32);
      return () => clearTimeout(t);
    }
    if (phase === "hold") {
      const t = setTimeout(() => setPhase("erasing"), 1200);
      return () => clearTimeout(t);
    }
    if (phase === "erasing") {
      if (typed.length === 0) {
        setCmdIdx((i) => (i + 1) % COMMANDS.length);
        setPhase("typing");
        return;
      }
      const t = setTimeout(() => setTyped(typed.slice(0, -1)), 14);
      return () => clearTimeout(t);
    }
  }, [phase, typed, command]);

  return (
    <div className="relative w-full max-w-lg">
      {/* Ambient glow */}
      <div className="absolute -inset-10 bg-violet-400/[0.12] blur-[90px] rounded-full pointer-events-none" />

      {/* Commandbar */}
      <div className="relative rounded-2xl bg-white ring-1 ring-slate-200/80 marketing-shadow-float p-5">
        <div className="flex items-start gap-3 rounded-xl bg-slate-50/80 ring-1 ring-slate-200/70 px-4 py-3.5">
          <DreyvStar size={16} className="text-violet-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-[14px] leading-snug text-slate-800 font-medium min-h-[20px]">
            {typed}
            <span className="inline-block w-[2px] h-[14px] bg-violet-600 align-middle ml-0.5 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
