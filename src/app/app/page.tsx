"use client";

/**
 * `/app` — the Living Canvas.
 *
 * One header strip, one stacked stream of blocks. Everything that happens
 * (CommandBar prompts, agent insights, capability runs) lands here. Pinned
 * blocks survive reload per-user; ephemeral ones drift off naturally.
 */

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Sparkles, Command } from "lucide-react";
import { useVault } from "@/lib/contexts/VaultContext";
import { AmbientGlow, StreamIn, SectionHeader } from "@/components/app-shell/primitives";
import { HeadlineValue, TrendCurve } from "@/components/app-shell/Composition";
import { CanvasStream } from "@/components/canvas/CanvasStream";
import { useCanvas } from "@/lib/canvas/CanvasContext";

function generateSparkline(seed: number, n = 28): number[] {
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    v += Math.sin(seed + i / 3) * 1.2 + Math.cos(seed * 0.7 + i / 5) * 0.8;
    out.push(v);
  }
  return out;
}

export default function AppHomePage() {
  const { vaultValue, vaultChange24h, activeVault } = useVault();
  const { addBlock, blocks } = useCanvas();
  const trend = useMemo(() => generateSparkline(activeVault ? 7 : 3), [activeVault]);

  // Seed a single welcome suggestion the first time the user lands with an
  // empty canvas. Pinned=false so it disappears as soon as they engage.
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
        title: "A few things, gently",
        payload: {
          message:
            "Ask me anything below — or press ⌘K to open the capability palette and explore everything I can do.",
        },
      });
    }
  }, [activeVault, blocks.length, addBlock]);

  const openPalette = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }),
    );
  };

  return (
    <div className="relative h-full overflow-y-auto bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-1/2 top-[-220px] -translate-x-1/2" />

      {/* Hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 pt-10 md:grid-cols-[1.05fr_1fr]">
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
              vaultChange24h !== null
                ? `${vaultChange24h >= 0 ? "+" : ""}${vaultChange24h.toFixed(2)}% in the last 24 hours`
                : "Connect a wallet to begin"
            }
          />
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={openPalette}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98]"
            >
              <Command className="h-4 w-4" />
              Open palette · ⌘K
            </button>
            <Link href="/app/treasury" className="text-sm font-medium text-slate-600 hover:text-violet-700">
              Treasury →
            </Link>
            <Link href="/app/analytics" className="text-sm font-medium text-slate-600 hover:text-violet-700">
              Analytics →
            </Link>
          </div>
        </StreamIn>

        <StreamIn delay={0.12}>
          <TrendCurve values={trend} label="Treasury trend · 7d" changePct={vaultChange24h ?? null} />
        </StreamIn>
      </section>

      {/* The Canvas */}
      <section className="relative z-10 mx-auto mt-14 max-w-6xl px-6 pb-32">
        <SectionHeader
          eyebrow="Your canvas"
          title="A living surface"
          description="Everything you ask Dreyv, every insight, every capability you run — it all lands here. Drag to reorder, pin what matters, dismiss the rest."
        />
        <div className="mt-6">
          <CanvasStream onOpenPalette={openPalette} />
        </div>
        <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400">
          <Sparkles className="h-3 w-3" />
          Pinned blocks are saved to this account. Everything else is ephemeral.
        </p>
      </section>
    </div>
  );
}
