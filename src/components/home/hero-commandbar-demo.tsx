"use client";

import { useEffect, useState } from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";

const COMMANDS = [
  "Swap 500 SOL to USDC via Jupiter, max 0.5% slippage",
  "Rebalance treasury: 60% SOL, 30% USDC, 10% JTO",
  "Stake idle SOL on Marinade for max yield",
  "Pay contractor 8,000 USDC, vesting 12 months",
  "Project runway at $42k/mo burn, alert at 6 months",
  "DCA 2,000 USDC into JTO weekly for 8 weeks",
  "Scan treasury for MEV exposure in last 30 days",
  "Bridge 50k USDC from Ethereum to Solana, cheapest route",
  "Draft Q2 treasury report for the multisig",
  "Set guardrail: block any single transfer over $250k",
  "Close LP position on Kamino, route proceeds to USDC",
  "Simulate: what if SOL drops 30% overnight?",
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

      {/* Replaces these tools */}
      <div className="relative mt-6">
        <p className="text-center text-[10px] font-mono uppercase tracking-[0.28em] text-slate-400 mb-3">
          Replaces 10+ tabs
        </p>
        <div className="relative flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
          {[
            { name: "Squads", logo: "/logos/squads.png" },
            { name: "Jupiter", logo: "/logos/jup.png" },
            { name: "Birdeye", logo: "/logos/birdeye.png" },
            { name: "Helius", logo: "/logos/helius.png" },
            { name: "Marinade", logo: "/logos/marinade.png" },
            { name: "Jito", logo: "/logos/jito.png" },
            { name: "Phantom", logo: "/logos/phantom.png" },
            { name: "Dune", logo: "/logos/dune.png" },
          ].map((tool) => (
            <div
              key={tool.name}
              className="group flex items-center gap-1.5 opacity-55 hover:opacity-90 transition-opacity"
            >
              <img
                src={tool.logo}
                alt=""
                loading="lazy"
                className="h-4 w-4 rounded-sm grayscale"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="text-[12px] font-medium text-slate-500 line-through decoration-violet-400/70 decoration-[1.5px]">
                {tool.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
