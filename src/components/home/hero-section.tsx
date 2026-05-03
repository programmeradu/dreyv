"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { marketingPrimaryCtaSm, marketingGhostLink } from "./marketing-styles";
import { HeroCommandbarDemo } from "./hero-commandbar-demo";

export function HeroSection() {
  const [solPrice, setSolPrice] = useState<number | null>(null);

  useEffect(() => {
    let abort = false;
    async function fetchPrice() {
      try {
        const r = await fetch("/api/jupiter/price?ids=SOL", { cache: "no-store" });
        const j = await r.json();
        if (!abort && j?.data?.SOL?.price) {
          setSolPrice(j.data.SOL.price);
        }
      } catch {
        /* silent */
      }
    }
    fetchPrice();
    const id = setInterval(fetchPrice, 30000);
    return () => {
      abort = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section
      id="content"
      className="relative min-h-dvh max-h-dvh flex flex-col overflow-hidden"
      aria-labelledby="hero-heading"
    >
      {/* Ambient radial violet glow — subtle, behind headline */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(60% 50% at 30% 35%, rgba(124,58,237,0.10) 0%, rgba(124,58,237,0.04) 40%, transparent 70%), radial-gradient(40% 40% at 80% 70%, rgba(167,139,250,0.08) 0%, transparent 65%)",
        }}
      />

      <div className="relative flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-24 md:pt-28 pb-8 z-10">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="text-center font-inter-label text-[11px] uppercase tracking-[0.28em] text-violet-700/90 mb-8"
        >
          The Sovereign OS for Digital Assets
          {solPrice && (
            <span className="ml-4 inline-flex items-center gap-1.5 text-slate-500 font-mono normal-case tracking-normal align-middle">
              <img
                src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                alt="Solana"
                className="h-3.5 w-3.5 rounded-full"
                loading="lazy"
              />
              SOL ${solPrice.toFixed(2)}
            </span>
          )}
        </motion.p>

        <div className="w-full grid lg:grid-cols-2 gap-10 lg:gap-14 xl:gap-20 items-center">
          <div>
            <motion.h1
              id="hero-heading"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-[clamp(2.5rem,4.8vw,4.25rem)] font-bold tracking-[-0.03em] leading-[1.08] text-marketing-fg flex flex-col items-start"
            >
              <span>From</span>
              <span>
                Click-Ops <span className="text-violet-600">to</span>
              </span>
              <span className="text-gradient-dreyv">Command-Ops.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="mt-8 text-lg lg:text-xl text-slate-600 max-w-xl leading-relaxed font-medium"
            >
              Stop juggling Squads, Jupiter, and Birdeye across 10 tabs.
              One command. Full treasury control.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="relative hidden lg:flex items-center justify-center"
          >
            {/* Mascot — Dryv greets, floats above the demo card */}
            <div className="pointer-events-none absolute -top-10 -right-4 z-20">
              <DryvMascot pose="greet" size={120} priority />
            </div>
            <HeroCommandbarDemo />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 font-inter-label"
        >
          <a href="/waitlist" className={marketingPrimaryCtaSm}>
            <span className="relative font-semibold tracking-wide">Join the waitlist</span>
            <ArrowRight className="relative h-3.5 w-3.5 text-white/90 transition-transform duration-300 group-hover:translate-x-0.5" />
          </a>
          <a href="#demo" className={marketingGhostLink}>
            or try a command &darr;
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.75 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-inter-label text-xs tracking-wide text-slate-400"
        >
          <span>2,847+ TPS</span>
          <span className="hidden sm:block h-3 w-px bg-violet-200/80" aria-hidden />
          <span>5 Agents Online</span>
          <span className="hidden sm:block h-3 w-px bg-violet-200/80" aria-hidden />
          <span>0 Security Incidents</span>
        </motion.div>
      </div>
    </section>
  );
}
