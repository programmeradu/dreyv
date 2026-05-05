"use client";
import { DreyvStar } from "@/components/studio/DreyvStar";

/**
 * `/app/analytics` — answer-first analytics page.
 *
 * EVERY card on this page is dynamic: when a what-if/foresight prompt is
 * active in the simulation store, the page swaps live values for simulated
 * ones from /api/analytics/simulate (single endpoint, real math grounded in
 * the user's real holdings). Exit the overlay to return to live data.
 */

import Link from "next/link";
import { useMemo } from "react";
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
import {
  SimulatedAnalyticsProvider,
  useSimulatedAnalytics,
} from "@/lib/foresight/SimulatedAnalyticsContext";

export default function AnalyticsPage() {
  const { vaultValue, vaultChange24h, vaultTokens, activeVault } = useVault();

  const {
    snapshots,
    events,
    foresight,
    valueSeries,
    loading,
  } = useForesightFoundation({ range: "30d", timeframeMonths: 12, paths: 200 });

  const baselineAttribution = events?.aggregates ?? null;

  return (
    <SimulatedAnalyticsProvider
      baselineAttribution={baselineAttribution}
      baselineDriftPctPerDay={snapshots?.stats?.driftPctPerDay}
    >
      <AnalyticsPageInner
        vaultValue={vaultValue ?? null}
        vaultChange24h={vaultChange24h ?? null}
        vaultTokens={vaultTokens ?? []}
        activeVault={activeVault ?? null}
        snapshots={snapshots}
        events={events}
        foresight={foresight}
        valueSeries={valueSeries}
        baselineAttribution={baselineAttribution}
        loading={loading}
      />
    </SimulatedAnalyticsProvider>
  );
}

function AnalyticsPageInner({
  vaultValue,
  vaultChange24h,
  vaultTokens,
  activeVault,
  snapshots,
  events,
  foresight,
  valueSeries,
  baselineAttribution,
  loading,
}: {
  vaultValue: number | null;
  vaultChange24h: number | null;
  vaultTokens: any[];
  activeVault: string | null;
  snapshots: any;
  events: any;
  foresight: any;
  valueSeries: { date: string; value: number }[];
  baselineAttribution: any;
  loading: boolean;
}) {
  const sim = useSimulatedAnalytics();
  const simState = sim.state;
  const simActive = sim.active;

  const handleAsk = (question: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("keystone-app-event", {
        detail: {
          type: "AGENT_COMMAND",
          payload: { command: question, autoSubmit: true },
        },
      }),
    );
  };

  // ── Resolve every card's data source: sim overlay wins when active ─────
  const displayVaultValue = simActive ? simState!.vaultValue : vaultValue;
  const displayVaultChange24h = simActive ? simState!.vaultChange24h : vaultChange24h;
  const displayTokens = simActive ? simState!.tokens : vaultTokens;
  const displayValueSeries = simActive ? simState!.valueSeries : valueSeries;
  const displayAttribution = simActive ? simState!.attribution : baselineAttribution;
  const displaySnapshotStats = simActive ? simState!.snapshotStats : snapshots?.stats ?? null;
  const displaySnapshots = simActive ? simState!.snapshots : (snapshots?.snapshots ?? []);
  const displayEvents = simActive ? simState!.events : (events?.events ?? null);
  const displayForesightProjection = simActive ? simState!.foresight.projection : (foresight?.projection ?? []);
  const displayForesightSummary = simActive ? simState!.foresight.summary : (foresight?.summary ?? null);
  const displayAsOf = simActive
    ? simState!.asOf
    : snapshots?.snapshots?.length
      ? snapshots.snapshots[snapshots.snapshots.length - 1].capturedAt
      : null;

  const trend = useMemo(() => {
    if (displayValueSeries.length >= 2) return displayValueSeries.map((p: any) => p.value);
    if (typeof displayVaultValue === "number" && displayVaultValue > 0) {
      return [displayVaultValue * 0.985, displayVaultValue * 0.99, displayVaultValue, displayVaultValue * 1.005, displayVaultValue];
    }
    return [];
  }, [displayValueSeries, displayVaultValue]);

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
              {simActive ? "Analytics · Simulating" : "Analytics"}
            </span>
          </div>
          <WalletButton />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-4 sm:px-6">
        <ScenarioBanner />

        <div className="mt-3">
          <AnalyticsCockpit
            activeVault={activeVault}
            vaultValue={displayVaultValue}
            vaultChange24h={displayVaultChange24h}
            vaultTokens={displayTokens}
            attribution={displayAttribution}
            snapshotStats={displaySnapshotStats}
            foresight={displayForesightSummary
              ? {
                  depletionProbability: displayForesightSummary.depletionProbability,
                  medianDepletionMonths: displayForesightSummary.medianDepletionMonths,
                }
              : null}
            asOf={displayAsOf}
            trend={trend}
          />
        </div>

        <div className="mt-3">
          <AnomalyChips
            attribution={displayAttribution}
            snapshotStats={displaySnapshotStats}
            foresight={displayForesightSummary}
            vaultChange24h={displayVaultChange24h}
          />
        </div>

        <div className="mt-3">
          <BaselineVsSimulated baseline={valueSeries} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-12">
          <Card className="lg:col-span-7" eyebrow="PnL · day-by-day" title="Where the money moved">
            <MoneyMovementLedger
              wallet={activeVault}
              range="30d"
              snapshotSeries={displayValueSeries}
              simulatedEvents={simActive ? simState!.events : null}
            />
            <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
              <ExportButtons range="30d" />
              <span className="text-slate-400">spreadsheet · branded report</span>
            </div>
          </Card>
          <Card className="lg:col-span-5" eyebrow="Foresight · 12mo" title={simActive ? "Scenario projection" : "200 Monte Carlo paths"}>
            <ForesightPanel
              projection={displayForesightProjection}
              summary={displayForesightSummary}
              attribution={displayAttribution}
              timeframeMonths={12}
              loading={loading || sim.loading}
            />
          </Card>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StreamIn delay={0.02}>
            <FeesBreakdown
              events={(displayEvents ?? null) as any}
              totalFeeUsd={displayAttribution?.feeUsd ?? 0}
            />
          </StreamIn>
          <StreamIn delay={0.04}>
            <FlowsByCategory events={(displayEvents ?? null) as any} />
          </StreamIn>
          <StreamIn delay={0.06}>
            <BenchmarkVsMarket
              valueSeries={displayValueSeries}
              benchmark="SOL"
            />
          </StreamIn>
        </div>

        <div className="mt-3">
          <SmartInsights
            vaultValue={displayVaultValue}
            vaultChange24h={displayVaultChange24h}
            vaultTokens={displayTokens}
            attribution={displayAttribution}
            snapshots={(displaySnapshots ?? []) as any[]}
            snapshotStats={displaySnapshotStats}
            foresight={displayForesightSummary}
            onAskQuestion={handleAsk}
            simulating={simActive}
          />
        </div>

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
