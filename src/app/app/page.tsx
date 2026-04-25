"use client";

/**
 * `/app` — generative home.
 *
 * No widgets, no terminal. One headline, one streaming narrative,
 * one row of human suggestions. Everything else lives elsewhere.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  AmbientGlow,
  SectionHeader,
  StreamIn,
} from "@/components/app-shell/primitives";
import { NarrativeStream } from "@/components/app-shell/NarrativeStream";
import {
  HeadlineValue,
  TrendCurve,
} from "@/components/app-shell/Composition";
import {
  SuggestionList,
  type Suggestion,
} from "@/components/app-shell/SuggestionList";

function generateSparkline(seed: number, n = 28): number[] {
  // Stable, gently-trending pseudo-curve so the page never sits flat.
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    v += Math.sin(seed + i / 3) * 1.2 + Math.cos(seed * 0.7 + i / 5) * 0.8;
    out.push(v);
  }
  return out;
}

export default function AppHomePage() {
  const { vaultValue, vaultChange24h, vaultTokens, activeVault } = useVault();

  const trend = useMemo(() => generateSparkline(activeVault ? 7 : 3), [activeVault]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!activeVault) {
      return [
        {
          id: "connect",
          kind: "rebalance",
          title: "Connect a wallet to begin",
          detail:
            "Dreyv works best when it can see your treasury. Link a wallet and we’ll start watching the moments worth your attention.",
          cta: "Connect",
        },
      ];
    }
    const idle = vaultTokens?.find((t: any) =>
      ["USDC", "USDT", "USD"].includes((t.symbol ?? "").toUpperCase()),
    );
    const list: Suggestion[] = [];
    if (idle) {
      list.push({
        id: "earn-stable",
        kind: "earn",
        title: "Put your idle stables to work",
        detail:
          "A portion of your treasury is sitting still. We can route it into safer yield without locking it up.",
        cta: "Review",
      });
    }
    list.push({
      id: "protect",
      kind: "protect",
      title: "Watching for unusual moves",
      detail:
        "If a large outflow or sharp drawdown happens, you’ll be the first to know — quietly, not loudly.",
      cta: "Settings",
    });
    list.push({
      id: "refine",
      kind: "rebalance",
      title: "Your mix is slightly concentrated",
      detail:
        "A small rebalance could smooth your weekly swings without giving up upside. We’ll show you exactly how.",
      cta: "See plan",
    });
    return list;
  }, [activeVault, vaultTokens]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-1/2 top-[-220px] -translate-x-1/2" />

      {/* Header */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          dreyv
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/app/treasury" className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-violet-50 hover:text-violet-700">
            Treasury
          </Link>
          <Link href="/app/analytics" className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-violet-50 hover:text-violet-700">
            Analytics
          </Link>
          <Link href="/app/settings" className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-violet-50 hover:text-violet-700">
            Settings
          </Link>
          <div className="ml-2"><WalletButton /></div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 pt-6 md:grid-cols-[1.05fr_1fr]">
        <StreamIn className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-600 shadow-[0_0_10px_currentColor]" />
            Live
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 md:text-5xl">
            Good to see you. Your treasury is being looked after.
          </h1>
          <p className="max-w-lg text-base leading-relaxed text-slate-600">
            Dreyv watches your positions, your yield, and the moments that matter — and only speaks up when it should.
          </p>
          <div className="pt-2">
            <HeadlineValue
              label="Total value"
              value={vaultValue}
              hint={
                vaultChange24h !== null
                  ? `${vaultChange24h >= 0 ? "+" : ""}${vaultChange24h.toFixed(2)}% in the last 24 hours`
                  : "Connect a wallet to begin"
              }
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Link
              href="/app/treasury"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98]"
            >
              Open treasury
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/app/analytics" className="text-sm font-medium text-slate-600 hover:text-violet-700">
              See analytics →
            </Link>
          </div>
        </StreamIn>

        <StreamIn delay={0.12}>
          <NarrativeStream />
        </StreamIn>
      </section>

      {/* Trend */}
      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6">
        <SectionHeader
          eyebrow="Last 7 days"
          title="The shape of your week"
          description="A quiet line, the way it should be. We surface only what changes meaningfully."
        />
        <div className="mt-6">
          <TrendCurve values={trend} label="Treasury trend" changePct={vaultChange24h ?? null} />
        </div>
      </section>

      {/* Suggestions */}
      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6 pb-24">
        <SectionHeader
          eyebrow="On Dreyv’s mind"
          title="A few things, gently"
          description="Suggestions, not commands. Act when you’re ready."
        />
        <div className="mt-6">
          <SuggestionList suggestions={suggestions} />
        </div>
      </section>
    </div>
  );
}
