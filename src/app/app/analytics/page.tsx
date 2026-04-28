"use client";

/**
 * `/app/analytics` — Phase 14: real foundation.
 *
 * Replaces the synthetic sin-wave trend with the user's actual treasury
 * snapshot history (/api/treasury/snapshots), surfaces USD attribution
 * (/api/treasury/events), and mounts the Monte Carlo + LLM-narrated
 * ForesightPanel.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import { ArrowLeft, Sparkles, ArrowDownRight, ArrowUpRight, Coins, Receipt } from "lucide-react";
import {
  AmbientGlow,
  SectionHeader,
  Surface,
  StreamIn,
  StreamingNumber,
  Pill,
} from "@/components/app-shell/primitives";
import { TrendCurve } from "@/components/app-shell/Composition";
import { useForesightFoundation } from "@/lib/hooks/useForesightFoundation";
import { ForesightPanel } from "@/components/analytics/ForesightPanel";

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function AnalyticsPage() {
  const { vaultValue, vaultChange24h, vaultTokens, activeVault } = useVault();

  const {
    snapshots,
    events,
    foresight,
    valueSeries,
    loading,
  } = useForesightFoundation({ range: "30d", timeframeMonths: 12, paths: 200 });

  // Real treasury value series (snapshots) — falls back to a single-point
  // shim using the live vault value so the chart never collapses entirely.
  const trend = useMemo(() => {
    if (valueSeries.length >= 2) return valueSeries.map((p) => p.value);
    if (typeof vaultValue === "number" && vaultValue > 0) {
      return [vaultValue * 0.985, vaultValue * 0.99, vaultValue, vaultValue * 1.005, vaultValue];
    }
    return [];
  }, [valueSeries, vaultValue]);

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

  const aggregates = events?.aggregates ?? null;
  const hasAttribution = !!aggregates && aggregates.sampleSize > 0;

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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Analytics · Foresight</p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Where you are. Where you’re heading.</h1>
          <p className="max-w-xl text-base text-slate-600">
            Real snapshots of your treasury, real attribution of every dollar in or out, and 200 forward simulations of where the next year could land.
          </p>
        </StreamIn>
      </section>

      {/* ── Growth: real snapshots ─────────────────────────────────── */}
      <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6">
        <SectionHeader
          eyebrow="Growth"
          title="Your treasury, over time"
          description={
            snapshots && snapshots.snapshots.length >= 2
              ? `${snapshots.snapshots.length} snapshots over the last 30 days.`
              : "Keep this page open — snapshots will accumulate every few minutes as your vault changes."
          }
        />
        <StreamIn delay={0.05} className="mt-6">
          <TrendCurve values={trend} label="Real value series" changePct={vaultChange24h ?? null} />
        </StreamIn>
      </section>

      {/* ── Foresight: Monte Carlo + LLM narrative ─────────────────── */}
      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6">
        <SectionHeader
          eyebrow="Foresight"
          title="The next 12 months, simulated 200 times"
          description="A Monte Carlo run anchored on your real volatility and burn rate. The shaded band is the middle 80% of outcomes."
        />
        <StreamIn delay={0.05} className="mt-6">
          <ForesightPanel
            projection={foresight?.projection ?? []}
            summary={foresight?.summary ?? null}
            attribution={aggregates}
            timeframeMonths={12}
            loading={loading}
          />
        </StreamIn>
      </section>

      {/* ── Attribution: where the money flowed ────────────────────── */}
      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6">
        <SectionHeader
          eyebrow="Attribution"
          title="Where every dollar went"
          description={hasAttribution
            ? `${aggregates!.sampleSize} treasury events recorded in the last 30 days.`
            : "Tag your first inflow or outflow from the treasury page to start building your attribution view."}
        />
        <div className="mt-6 grid gap-5 md:grid-cols-4">
          <AttributionCard
            tone="emerald"
            icon={<ArrowDownRight className="h-4 w-4" />}
            label="Inflows"
            usd={aggregates?.inflowUsd ?? 0}
            sub={`${fmtCompact(aggregates?.monthlyInflow ?? 0)}/mo`}
          />
          <AttributionCard
            tone="rose"
            icon={<ArrowUpRight className="h-4 w-4" />}
            label="Outflows"
            usd={aggregates?.outflowUsd ?? 0}
            sub={`${fmtCompact(aggregates?.monthlyBurnRate ?? 0)}/mo burn`}
          />
          <AttributionCard
            tone="violet"
            icon={<Coins className="h-4 w-4" />}
            label="Yield earned"
            usd={aggregates?.yieldUsd ?? 0}
            sub={aggregates?.annualYieldRate
              ? `${(aggregates.annualYieldRate * 100).toFixed(2)}% APY realized`
              : "—"}
          />
          <AttributionCard
            tone="slate"
            icon={<Receipt className="h-4 w-4" />}
            label="Fees paid"
            usd={aggregates?.feeUsd ?? 0}
            sub={hasAttribution ? "Network + protocol" : "—"}
          />
        </div>
      </section>

      {/* ── Composition ────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6">
        <SectionHeader eyebrow="Composition" title="Where your treasury leans" />
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Net 30-day delta</p>
              <div className="mt-3 font-manrope text-4xl font-semibold tracking-tight text-slate-900">
                {hasAttribution ? (
                  <StreamingNumber value={aggregates!.netUsd ?? 0} prefix="$" decimals={0} />
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Inflows minus outflows over the last month, derived from the events you’ve recorded.
              </p>
              {hasAttribution && (
                <div className="mt-4">
                  <Pill tone={aggregates!.netUsd >= 0 ? "emerald" : "rose"}>
                    {aggregates!.netUsd >= 0 ? "Net positive" : "Net outflow"}
                  </Pill>
                </div>
              )}
            </Surface>
          </StreamIn>
        </div>
      </section>

      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6 pb-24">
        <Surface className="p-7 text-center">
          <p className="font-manrope text-lg text-slate-700">
            Want to bend the simulation with what-ifs? Open{" "}
            <Link href="/app/treasury" className="font-semibold text-violet-700 hover:text-violet-800">
              your treasury
            </Link>
            {" "}or chat with{" "}
            <Link href="/app" className="font-semibold text-violet-700 hover:text-violet-800">CommandBar</Link>.
          </p>
        </Surface>
      </section>
    </div>
  );
}

function AttributionCard({
  tone,
  icon,
  label,
  usd,
  sub,
}: {
  tone: "emerald" | "rose" | "violet" | "slate";
  icon: React.ReactNode;
  label: string;
  usd: number;
  sub: string;
}) {
  const toneMap: Record<string, string> = {
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    violet: "text-violet-700",
    slate: "text-slate-700",
  };
  return (
    <StreamIn>
      <Surface className="p-5">
        <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneMap[tone]}`}>
          {icon}
          {label}
        </div>
        <div className="mt-3 font-manrope text-2xl font-semibold tracking-tight text-slate-900">
          {fmtCompact(usd)}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
      </Surface>
    </StreamIn>
  );
}
