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
import { TokenAvatar } from "@/components/TokenAvatar";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { FeeAnalyticsWidget } from "@/components/dashboard/FeeAnalyticsWidget";
import { YieldProtocolPanel } from "@/components/dashboard/YieldProtocolPanel";
import { WatcherHeartbeatStrip } from "@/components/agent/WatcherHeartbeatStrip";
import { OnrampButton } from "@/components/onramp/OnrampButton";

export default function AppHomePage() {
  const { vaultValue, vaultChange24h, activeVault, vaultTokens } = useVault();
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
            <NavTile href="/app/treasury" eyebrow="Treasury" title="Holdings & flows" variant="treasury" tokens={vaultTokens} />
            <NavTile href="/app/analytics" eyebrow="Analytics" title="Performance & risk" variant="analytics" />
          </div>
        </StreamIn>

        <StreamIn delay={0.12} className="md:pt-12">
          <TreasuryPulseCarousel />
        </StreamIn>
      </section>

      {/* Watcher heartbeat — agent pipeline visibility (Track B) */}
      <section className="relative z-10 mx-auto mt-6 w-full max-w-6xl px-4 sm:mt-10 sm:px-6">
        <WatcherHeartbeatStrip />
      </section>

      {/* Monetary hooks — Sid feedback: surface fee analytics + yield ops above the canvas */}
      <section className="relative z-10 mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <FeeAnalyticsWidget />
          <YieldProtocolPanel persona="balanced" limit={3} title="Top yield opportunities" />
        </div>
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

function NavTile({
  href,
  eyebrow,
  title,
  variant,
  tokens,
}: {
  href: string;
  eyebrow: string;
  title: string;
  variant?: "treasury" | "analytics";
  tokens?: any[];
}) {
  return (
    <Link
      href={href}
      className="group relative h-32 overflow-hidden rounded-2xl border border-violet-200 bg-white p-4 transition hover:border-violet-400"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-violet-300/25 blur-2xl transition group-hover:bg-violet-400/40" />

      {variant === "treasury" && <TreasuryBubbles tokens={tokens ?? []} />}
      {variant === "analytics" && <AnalyticsMascot />}

      <DreyvStar size={10} className="absolute right-3 top-3 text-violet-300 transition group-hover:text-violet-500" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
          {eyebrow}
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-900">{title}</p>
        <span className="mt-3 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white transition group-hover:translate-x-0.5 group-hover:bg-violet-700">
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

function TreasuryBubbles({ tokens }: { tokens: any[] }) {
  // Pick up to 5 tokens with logos; fallback to a few placeholder symbols so the
  // tile always feels alive even before a wallet is connected.
  const all = (tokens || []).filter((t) => t && (t.logo || t.symbol));
  const MAX = 5;
  const picks = all.slice(0, MAX);
  const overflow = Math.max(0, all.length - MAX);
  const fallback = [
    { symbol: "SOL" },
    { symbol: "USDC" },
    { symbol: "JUP" },
    { symbol: "BONK" },
    { symbol: "JTO" },
  ];
  const items = picks.length > 0 ? picks : fallback;

  // Stacked in a "jar" cluster bottom-right, slight rotation for playfulness.
  const positions = [
    { right: 8, bottom: 6, size: 30, delay: 0 },
    { right: 30, bottom: 10, size: 24, delay: 0.05 },
    { right: 14, bottom: 30, size: 22, delay: 0.1 },
    { right: 44, bottom: 4, size: 20, delay: 0.15 },
    { right: 36, bottom: 28, size: 18, delay: 0.2 },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Jar curve — soft violet wash hugging bottom-right */}
      <div className="absolute -bottom-8 -right-8 h-28 w-28 rounded-full bg-gradient-to-tl from-violet-100 to-transparent" />
      <div className="absolute bottom-0 right-0 h-16 w-24 rounded-tl-[3rem] border-l border-t border-violet-200/70 bg-violet-50/40" />
      {items.map((tk, i) => {
        const p = positions[i];
        if (!p) return null;
        return (
          <div
            key={(tk.symbol || tk.mint || i) + "-" + i}
            className="absolute animate-[float_4s_ease-in-out_infinite] drop-shadow-[0_4px_8px_rgba(124,58,237,0.18)]"
            style={{
              right: p.right,
              bottom: p.bottom,
              animationDelay: `${p.delay}s`,
            }}
          >
            <TokenAvatar symbol={tk.symbol} mint={tk.mint} logo={tk.logo} size={p.size} />
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          className="absolute flex items-center justify-center rounded-full bg-violet-600 text-[9px] font-bold text-white shadow-[0_4px_10px_rgba(124,58,237,0.35)] ring-2 ring-white"
          style={{ right: 4, bottom: 44, height: 18, minWidth: 18, padding: "0 5px" }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function AnalyticsMascot() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Chart + mascot anchored together bottom-right */}
      <svg
        viewBox="0 0 100 50"
        width="112"
        height="56"
        className="absolute bottom-3 right-[18px]"
        aria-hidden
      >
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#c4b5fd" />
          </linearGradient>
        </defs>

        {/* baseline */}
        <line x1="0" y1="46" x2="100" y2="46" stroke="#ede9fe" strokeWidth="0.6" />

        {/* ascending bars */}
        <g className="origin-bottom transition-transform duration-500 group-hover:scale-y-110">
          <rect x="14" y="30" width="9" height="16" rx="1.2" fill="url(#barGrad)" opacity="0.45" />
          <rect x="27" y="22" width="9" height="24" rx="1.2" fill="url(#barGrad)" opacity="0.65" />
          <rect x="40" y="14" width="9" height="32" rx="1.2" fill="url(#barGrad)" opacity="0.8" />
          <rect x="53" y="6"  width="9" height="40" rx="1.2" fill="url(#barGrad)" />
        </g>

        {/* diagonal trend arrow */}
        <path
          d="M16 36 L34 28 L48 18 L62 8"
          stroke="#7c3aed"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M58 6 L64 8 L62 14" stroke="#7c3aed" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* arrow chip on first bar */}
        <circle cx="8" cy="38" r="5" fill="#7c3aed" />
        <path d="M5.5 38 L10 38 M8 36 L10 38 L8 40" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Mascot anchored bottom-right beside the chart */}
      <div className="absolute bottom-3 right-3 opacity-95 transition duration-300 group-hover:scale-105 group-hover:-translate-y-0.5">
        <DreyvMascot pose="celebrate" size={48} glow={false} />
      </div>
    </div>
  );
}
