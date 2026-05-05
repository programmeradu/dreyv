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
import { DreyvStar } from "@/components/studio/DreyvStar";

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
    <div className="relative h-full w-full max-w-full overflow-x-hidden overflow-y-auto bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-1/2 top-[-220px] -translate-x-1/2" />
      {/* Floating team/wallet/bell — desktop only. Mobile uses the layout's top header. */}
      <div className="hidden md:block">
        <AppTopRightBar />
      </div>

      {/* Hero — extra top padding only on desktop where the floating bar lives */}
      <section className="relative z-10 mx-auto grid w-full max-w-6xl gap-8 px-4 pt-6 sm:px-6 sm:pt-10 md:grid-cols-[1.05fr_1fr] md:gap-10 md:pt-28">
        <StreamIn className="space-y-5 md:space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600" />
            </span>
            Live
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
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
            <NavTile href="/app/treasury" eyebrow="Treasury" title="Holdings & flows" />
            <NavTile href="/app/analytics" eyebrow="Analytics" title="Performance & risk" />
          </div>
        </StreamIn>

        <StreamIn delay={0.12} className="md:pt-12">
          <TreasuryPulseCarousel />
        </StreamIn>
      </section>

      {/* The Canvas + Agents Rail — rail is desktop-only (lg:block inside) */}
      <section className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-4 pb-40 sm:mt-14 sm:px-6 sm:pb-32">
        <SectionHeader
          eyebrow="Your canvas"
          title="A living surface"
          description="Everything you ask Dreyv, every insight, every plan it draws up — it all lands here. Drag to reorder, pin what matters, dismiss the rest."
        />
        <div className="mt-6 flex w-full min-w-0 flex-col lg:flex-row lg:gap-6">
          <div className="min-w-0 flex-1">
            <CanvasStream scope="dashboard" />
            <p className="mt-6 flex items-center gap-2 text-xs text-slate-400">
              <DreyvStar size={9} className="text-violet-500" />
              Pinned blocks are saved to this account. Everything else is ephemeral.
            </p>
          </div>
          <AgentsRail />
        </div>
      </section>
    </div>
  );
}
