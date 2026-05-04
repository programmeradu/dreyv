"use client";
import { DreyvStar } from "@/components/studio/DreyvStar";

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
import { ArrowLeft } from "lucide-react";
import {
  AmbientGlow,
  Surface,
  StreamIn,
} from "@/components/app-shell/primitives";
import { useForesightFoundation } from "@/lib/hooks/useForesightFoundation";
import { ForesightPanel } from "@/components/analytics/ForesightPanel";
import { MoneyMovementLedger } from "@/components/analytics/MoneyMovementLedger";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { AnalyticsCockpit } from "@/components/analytics/AnalyticsCockpit";
import { SmartInsights } from "@/components/analytics/SmartInsights";
import { AnomalyChips } from "@/components/analytics/AnomalyChips";
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

  const aggregates = events?.aggregates ?? null;
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
            <DreyvStar size={12} />

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

        {/* ── Cockpit — verdict + valuation + ribbon + signals + KPIs + composition ─ */}
        <div className="mt-3">
          <AnalyticsCockpit
            activeVault={activeVault ?? null}
            vaultValue={vaultValue ?? null}
            vaultChange24h={vaultChange24h ?? null}
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
            trend={trend}
          />
        </div>

        {/* ── Anomalies inline ─────────────────────────────────────── */}
        <div className="mt-3">
          <AnomalyChips
            attribution={aggregates}
            snapshotStats={snapshots?.stats ?? null}
            foresight={foresight?.summary ?? null}
            vaultChange24h={vaultChange24h ?? null}
          />
        </div>

        {/* ── Baseline vs simulated overlay (only meaningful when sim active) ─ */}
        <div className="mt-3">
          <BaselineVsSimulated baseline={valueSeries} />
        </div>

        {/* ── Row 4 — PnL waterfall + Foresight side-by-side ───────── */}
        <div className="mt-3 grid gap-3 lg:grid-cols-12">
          <Card className="lg:col-span-7" eyebrow="PnL · day-by-day" title="Where the money moved">
            <MoneyMovementLedger
              wallet={activeVault ?? null}
              range="30d"
              snapshotSeries={valueSeries}
            />
            <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
              <ExportButtons range="30d" />
              <span className="text-slate-400">spreadsheet · branded report</span>
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

        {/* ── Row 5 — Coverage grid: 3 dense panels ────────────────── */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StreamIn delay={0.02}><FeesBreakdown events={(events?.events ?? null) as any} totalFeeUsd={aggregates?.feeUsd ?? 0} /></StreamIn>
          <StreamIn delay={0.04}><FlowsByCategory events={(events?.events ?? null) as any} /></StreamIn>
          <StreamIn delay={0.06}><BenchmarkVsMarket valueSeries={valueSeries} benchmark="SOL" /></StreamIn>
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

