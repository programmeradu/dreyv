"use client";

/**
 * `/app` — the Living Canvas.
 *
 * One header strip, one stacked stream of blocks. Everything that happens
 * (CommandBar prompts, agent insights, capability runs) lands here.
 * The CommandBar is the single user entry point — no palette button.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useVault } from "@/lib/contexts/VaultContext";
import { AmbientGlow, StreamIn, SectionHeader } from "@/components/app-shell/primitives";
import { HeadlineValue } from "@/components/app-shell/Composition";
import { TreasuryPulseCarousel } from "@/components/app-shell/TreasuryPulseCarousel";
import { AppTopRightBar } from "@/components/app-shell/AppTopRightBar";
import { CanvasStream } from "@/components/canvas/CanvasStream";
import { AgentsRail } from "@/components/canvas/AgentsRail";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { useTreasuryTrend } from "@/lib/hooks/useTreasuryTrend";

export default function AppHomePage() {
  const { vaultValue, vaultChange24h, activeVault } = useVault();
  const { addBlock, blocks } = useCanvas();
  const trend = useTreasuryTrend("7d");
  // Use the real composite change from the trend if the vault hasn't reported one yet.
  const displayChange = vaultChange24h ?? trend.changePct ?? null;

  // Seed a single welcome suggestion on first empty landing.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (blocks.length > 0) return;
    seededRef.current = true;
    if (!activeVault) {
      addBlock({
        type: "suggestion",
        source: "agent",
        title: "Connect a wallet to begin",
        payload: {
          message:
            "Dreyv works best when it can see your treasury. Link a wallet and I'll start watching the moments worth your attention.",
          cta: { href: "/app/treasury", label: "Open treasury" },
        },
      });
    } else {
      addBlock({
        type: "suggestion",
        source: "agent",
        title: "Ask me anything",
        payload: {
          message:
            "Use the command bar below — I'll plan, simulate, and surface every step right here on your canvas.",
        },
      });
    }
  }, [activeVault, blocks.length, addBlock]);

  return (
    <div className="relative h-full overflow-y-auto bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-1/2 top-[-220px] -translate-x-1/2" />
      <AppTopRightBar />

      {/* Hero — top padding leaves room for the floating top-right bar */}
      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 pt-24 md:grid-cols-[1.05fr_1fr] md:pt-28">
        <StreamIn className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-600 shadow-[0_0_10px_currentColor]" />
            Live
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 md:text-5xl">
            Good to see you. Your treasury is being looked after.
          </h1>
          <HeadlineValue
            label="Total value"
            value={vaultValue}
            hint={
              displayChange !== null
                ? `${displayChange >= 0 ? "+" : ""}${displayChange.toFixed(2)}% in the last ${trend.source ? "7 days" : "24 hours"}`
                : "Connect a wallet to begin"
            }
          />
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Link
              href="/app/treasury"
              className="group relative overflow-hidden rounded-2xl border border-violet-200 bg-white p-4 transition hover:border-violet-400 hover:shadow-[0_20px_60px_-30px_rgba(124,58,237,0.5)]"
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-violet-400/20 blur-2xl transition group-hover:bg-violet-400/40" />
              <div className="relative flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Treasury</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">Holdings & flows</p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white transition group-hover:scale-110">
                  <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" />
                  </svg>
                </span>
              </div>
            </Link>
            <Link
              href="/app/analytics"
              className="group relative overflow-hidden rounded-2xl border border-violet-200 bg-white p-4 transition hover:border-violet-400 hover:shadow-[0_20px_60px_-30px_rgba(124,58,237,0.5)]"
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-violet-300/20 blur-2xl transition group-hover:bg-violet-300/40" />
              <div className="relative flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Analytics</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">Performance & risk</p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white transition group-hover:scale-110">
                  <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" />
                  </svg>
                </span>
              </div>
            </Link>
          </div>
        </StreamIn>

        <StreamIn delay={0.12} className="md:pt-12">
          <TreasuryPulseCarousel />
        </StreamIn>
      </section>

      {/* The Canvas + Agents Rail */}
      <section className="relative z-10 mx-auto mt-14 max-w-6xl px-6 pb-32">
        <SectionHeader
          eyebrow="Your canvas"
          title="A living surface"
          description="Everything you ask Dreyv, every insight, every plan it draws up — it all lands here. Drag to reorder, pin what matters, dismiss the rest."
        />
        <div className="mt-6 flex gap-6">
          <div className="min-w-0 flex-1">
            <CanvasStream scope="dashboard" />
            <p className="mt-6 flex items-center gap-2 text-xs text-slate-400">
              <span className="h-1 w-1 rounded-full bg-violet-500" />
              Pinned blocks are saved to this account. Everything else is ephemeral.
            </p>
          </div>
          <AgentsRail />
        </div>
      </section>
    </div>
  );
}
