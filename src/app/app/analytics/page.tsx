"use client";

/**
 * `/app/analytics` — generative analytics (rebuilt).
 * Replaced the previous widget-grid analytics dashboard.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  AmbientGlow,
  SectionHeader,
  Surface,
  StreamIn,
  StreamingNumber,
  Pill,
} from "@/components/app-shell/primitives";
import { TrendCurve } from "@/components/app-shell/Composition";

export default function AnalyticsPage() {
  const { vaultValue, vaultChange24h, vaultTokens } = useVault();

  // ── Loop detector ─────────────────────────────────────────────────
  // If this page re-renders >40 times in a 250ms window, log a single
  // warning with a stack so we can trace what's driving the update loop.
  const renderTimes = useRef<number[]>([]);
  const warned = useRef(false);
  if (typeof window !== "undefined") {
    const now = performance.now();
    renderTimes.current.push(now);
    renderTimes.current = renderTimes.current.filter((t) => now - t < 250);
    if (renderTimes.current.length > 40 && !warned.current) {
      warned.current = true;
      // eslint-disable-next-line no-console
      console.error("[AnalyticsPage] update loop detected", {
        rendersIn250ms: renderTimes.current.length,
        vaultValue,
        vaultChange24h,
        vaultTokensLen: Array.isArray(vaultTokens) ? vaultTokens.length : "n/a",
        stack: new Error().stack,
      });
    }
  }
  useEffect(() => {
    return () => {
      warned.current = false;
      renderTimes.current = [];
    };
  }, []);

  const trend = useMemo(() => {
    const out: number[] = [];
    let v = 100;
    for (let i = 0; i < 30; i++) {
      v += Math.sin(i / 4) * 1.6 + Math.cos(i / 7) * 1.1;
      out.push(v);
    }
    return out;
  }, []);

  const concentration = useMemo(() => {
    const tokens = (vaultTokens ?? []) as any[];
    if (tokens.length === 0) return null;
    const total = tokens.reduce((s, t) => s + (t.value ?? 0), 0);
    if (total === 0) return null;
    const sorted = [...tokens].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const top = sorted[0];
    return {
      symbol: (top?.symbol ?? "").toUpperCase() || "Top asset",
      share: ((top?.value ?? 0) / total) * 100,
    };
  }, [vaultTokens]);

  const yieldEstimate = useMemo(() => {
    if (typeof vaultValue !== "number") return null;
    return (vaultValue * 0.045) / 12;
  }, [vaultValue]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-[-160px] top-[-200px]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/app" className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <Link href="/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          dreyv
        </Link>
        <WalletButton />
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-4">
        <StreamIn className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Analytics</p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Three stories, told gently.</h1>
          <p className="max-w-lg text-base text-slate-600">
            How you’re growing, where your risk concentrates, and how much you’re quietly earning.
          </p>
        </StreamIn>
      </section>

      <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6">
        <SectionHeader eyebrow="Growth" title="Your treasury, over time" />
        <StreamIn delay={0.05} className="mt-6">
          <TrendCurve values={trend} label="30-day shape" changePct={vaultChange24h ?? null} />
        </StreamIn>
      </section>

      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6">
        <SectionHeader
          eyebrow="Composition & earning"
          title="Where your treasury leans"
          description="One position can quietly become most of your treasury. We watch for that."
        />
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <StreamIn delay={0.05}>
            <Surface className="p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Largest exposure</p>
              <div className="mt-3 font-manrope text-4xl font-semibold tracking-tight text-slate-900">
                {concentration ? (
                  <StreamingNumber value={concentration.share} suffix="%" decimals={1} />
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {concentration
                  ? `Most of your treasury is in ${concentration.symbol}. A small rebalance could soften your weekly swings.`
                  : "Connect a wallet to see your composition."}
              </p>
              {concentration && (
                <div className="mt-4 flex items-center gap-2">
                  <Pill tone={concentration.share > 60 ? "rose" : concentration.share > 35 ? "violet" : "emerald"}>
                    {concentration.share > 60 ? "Concentrated" : concentration.share > 35 ? "Tilted" : "Balanced"}
                  </Pill>
                </div>
              )}
            </Surface>
          </StreamIn>

          <StreamIn delay={0.12}>
            <Surface className="p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Quietly earning</p>
              <div className="mt-3 font-manrope text-4xl font-semibold tracking-tight text-slate-900">
                <StreamingNumber value={yieldEstimate} prefix="$" decimals={2} />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                A soft estimate of how much your treasury is on track to earn this month at its current shape.
              </p>
              <div className="mt-4">
                <Pill tone="emerald">Conservative</Pill>
              </div>
            </Surface>
          </StreamIn>
        </div>
      </section>

      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6 pb-24">
        <Surface className="p-7 text-center">
          <p className="font-manrope text-lg text-slate-700">
            Want a closer look at any of these? Just open{" "}
            <Link href="/app/treasury" className="font-semibold text-violet-700 hover:text-violet-800">
              your treasury
            </Link>
            .
          </p>
        </Surface>
      </section>
    </div>
  );
}
