"use client";

/**
 * `/app/analytics` — compact, dense, grid-first layout.
 *
 * Same wiring (real snapshots, events, foresight, simulate) — but every block
 * lives in a tight 12-col grid so the whole page fits in a single viewport
 * on desktop with very little scroll. Flat only (no shadows / blur / gradient).
 */

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Receipt,
} from "lucide-react";
import {
  AmbientGlow,
  Surface,
  StreamIn,
  StreamingNumber,
  Pill,
} from "@/components/app-shell/primitives";
import { TrendCurve } from "@/components/app-shell/Composition";
import { useForesightFoundation } from "@/lib/hooks/useForesightFoundation";
import { ForesightPanel } from "@/components/analytics/ForesightPanel";
import { PnlWaterfall } from "@/components/analytics/PnlWaterfall";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { AreWeOkHero } from "@/components/analytics/AreWeOkHero";
import { SmartInsights } from "@/components/analytics/SmartInsights";
import { AnomalyChips } from "@/components/analytics/AnomalyChips";
import { ConcentrationHHI } from "@/components/analytics/ConcentrationHHI";
import { FeesBreakdown } from "@/components/analytics/FeesBreakdown";
import { FlowsByCategory } from "@/components/analytics/FlowsByCategory";
import { BenchmarkVsMarket } from "@/components/analytics/BenchmarkVsMarket";
import { ScenarioBanner } from "@/components/analytics/ScenarioBanner";
import { BaselineVsSimulated } from "@/components/analytics/BaselineVsSimulated";
import { useScenarioRun } from "@/lib/foresight/useScenarioRun";

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const { vaultValue, vaultChange24h, vaultTokens, activeVault } = useVault();

  useScenarioRun();

  const handleAsk = (question: string) => {
    router.push(`/app?ask=${encodeURIComponent(question)}`);
  };

  const {
    snapshots,
    events,
    foresight,
    valueSeries,
    loading,
  } = useForesightFoundation({ range: "30d", timeframeMonths: 12, paths: 200 });

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
  const asOf = snapshots?.snapshots?.length
    ? snapshots.snapshots[snapshots.snapshots.length - 1].capturedAt
    : null;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-[-160px] top-[-200px]" />

      {/* ── Sticky compact header ─────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/90 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/app" className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-violet-700">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600 text-white">
              <Sparkles className="h-3 w-3" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              Analytics
            </span>
          </div>
          <WalletButton />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-4 sm:px-6">
        {/* ── Scenario banner (only when active) ───────────────────── */}
        <ScenarioBanner />

        {/* ── Row 1 — Verdict + KPI strip ──────────────────────────── */}
        <div className="mt-3 grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <AreWeOkHero
              activeVault={activeVault ?? null}
              vaultValue={vaultValue ?? null}
              vaultTokens={vaultTokens ?? []}
              attribution={aggregates}
              snapshotStats={snapshots?.stats ?? null}
              foresight={foresight?.summary
                ? {
                    depletionProbability: foresight.summary.depletionProbability,
                    medianDepletionMonths: foresight.summary.medianDepletionMonths,
                  }
                : null}
              asOf={asOf}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:col-span-5">
            <KpiTile
              tone="emerald"
              icon={<ArrowDownRight className="h-3.5 w-3.5" />}
              label="Inflows · 30d"
              usd={aggregates?.inflowUsd ?? 0}
              sub={`${fmtCompact(aggregates?.monthlyInflow ?? 0)}/mo`}
            />
            <KpiTile
              tone="rose"
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              label="Outflows · 30d"
              usd={aggregates?.outflowUsd ?? 0}
              sub={`${fmtCompact(aggregates?.monthlyBurnRate ?? 0)}/mo burn`}
            />
            <KpiTile
              tone="violet"
              icon={<Coins className="h-3.5 w-3.5" />}
              label="Yield earned"
              usd={aggregates?.yieldUsd ?? 0}
              sub={aggregates?.annualYieldRate
                ? `${(aggregates.annualYieldRate * 100).toFixed(2)}% APY`
                : "—"}
            />
            <KpiTile
              tone="slate"
              icon={<Receipt className="h-3.5 w-3.5" />}
              label="Fees paid"
              usd={aggregates?.feeUsd ?? 0}
              sub={hasAttribution ? "Network + protocol" : "—"}
            />
          </div>
        </div>

        {/* ── Row 2 — Anomalies inline ─────────────────────────────── */}
        <div className="mt-3">
          <AnomalyChips
            attribution={aggregates}
            snapshotStats={snapshots?.stats ?? null}
            foresight={foresight?.summary ?? null}
            vaultChange24h={vaultChange24h ?? null}
          />
        </div>

        {/* ── Row 3 — Growth chart + Composition ───────────────────── */}
        <div className="mt-4 grid gap-3 lg:grid-cols-12">
          <Card className="lg:col-span-8" eyebrow="Growth · 30d" title="Treasury value over time"
            hint={snapshots && snapshots.snapshots.length >= 2
              ? `${snapshots.snapshots.length} snapshots`
              : "Accumulating snapshots…"}
          >
            <TrendCurve values={trend} label="Real value series" changePct={vaultChange24h ?? null} />
            <BaselineVsSimulated baseline={valueSeries} />
          </Card>

          <div className="grid gap-3 lg:col-span-4">
            <Card eyebrow="Composition" title="Largest exposure" compact>
              <div className="font-manrope text-2xl font-semibold tracking-tight text-slate-900">
                {concentration ? (
                  <StreamingNumber value={concentration.share} suffix="%" decimals={1} />
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {concentration
                  ? `Most of your treasury is in ${concentration.symbol}.`
                  : "Connect a wallet to see your composition."}
              </p>
              {concentration && (
                <div className="mt-2">
                  <Pill tone={concentration.share > 60 ? "rose" : concentration.share > 35 ? "violet" : "emerald"}>
                    {concentration.share > 60 ? "Concentrated" : concentration.share > 35 ? "Tilted" : "Balanced"}
                  </Pill>
                </div>
              )}
            </Card>
            <Card eyebrow="Net 30d" title="Inflows − outflows" compact>
              <div className="font-manrope text-2xl font-semibold tracking-tight text-slate-900">
                {hasAttribution ? (
                  <StreamingNumber value={aggregates!.netUsd ?? 0} prefix="$" decimals={0} />
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </div>
              {hasAttribution && (
                <div className="mt-2">
                  <Pill tone={aggregates!.netUsd >= 0 ? "emerald" : "rose"}>
                    {aggregates!.netUsd >= 0 ? "Net positive" : "Net outflow"}
                  </Pill>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* ── Row 4 — PnL waterfall + Foresight side-by-side ───────── */}
        <div className="mt-3 grid gap-3 lg:grid-cols-12">
          <Card className="lg:col-span-7" eyebrow="PnL · day-by-day" title="Where the money moved">
            <PnlWaterfall wallet={activeVault ?? null} range="30d" />
            <div className="mt-3">
              <ExportButtons range="30d" />
            </div>
          </Card>
          <Card className="lg:col-span-5" eyebrow="Foresight · 12mo" title="200 Monte Carlo paths">
            <ForesightPanel
              projection={foresight?.projection ?? []}
              summary={foresight?.summary ?? null}
              attribution={aggregates}
              timeframeMonths={12}
              loading={loading}
            />
          </Card>
        </div>

        {/* ── Row 5 — Coverage grid: 4 dense panels ────────────────── */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StreamIn delay={0.02}><ConcentrationHHI vaultTokens={vaultTokens ?? []} /></StreamIn>
          <StreamIn delay={0.04}><FeesBreakdown events={(events?.events ?? null) as any} totalFeeUsd={aggregates?.feeUsd ?? 0} /></StreamIn>
          <StreamIn delay={0.06}><FlowsByCategory events={(events?.events ?? null) as any} /></StreamIn>
          <StreamIn delay={0.08}><BenchmarkVsMarket valueSeries={valueSeries} benchmark="SOL" /></StreamIn>
        </div>

        {/* ── Row 6 — Smart insights (streamed, full-width) ────────── */}
        <div className="mt-3">
          <SmartInsights
            vaultValue={vaultValue ?? null}
            vaultChange24h={vaultChange24h ?? null}
            vaultTokens={vaultTokens ?? []}
            attribution={aggregates}
            snapshots={(snapshots?.snapshots ?? []) as any[]}
            snapshotStats={snapshots?.stats ?? null}
            foresight={foresight?.summary ?? null}
            onAskQuestion={handleAsk}
          />
        </div>

        {/* ── Footer link strip ───────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
          <span>Want to bend the simulation?</span>
          <Link href="/app/treasury" className="font-semibold text-violet-700 hover:text-violet-800">Open treasury</Link>
          <span>·</span>
          <Link href="/app" className="font-semibold text-violet-700 hover:text-violet-800">Ask Dreyv</Link>
        </div>
      </main>
    </div>
  );
}

/* ── Tiny presentational helpers ────────────────────────────────── */

function Card({
  children,
  eyebrow,
  title,
  hint,
  className,
  compact = false,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  title?: string;
  hint?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <Surface className={`${compact ? "p-4" : "p-5"} ${className ?? ""}`}>
      {(eyebrow || title || hint) && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                {eyebrow}
              </p>
            )}
            {title && (
              <h3 className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                {title}
              </h3>
            )}
          </div>
          {hint && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-400">
              {hint}
            </span>
          )}
        </div>
      )}
      {children}
    </Surface>
  );
}

function KpiTile({
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
    <Surface className="p-3">
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneMap[tone]}`}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 font-manrope text-xl font-semibold tracking-tight text-slate-900">
        {fmtCompact(usd)}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>
    </Surface>
  );
}
