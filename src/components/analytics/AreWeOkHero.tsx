"use client";

/**
 * AreWeOkHero — composite "answer first" verdict for /app/analytics.
 *
 * Reads ONLY from live signals (no demo/hardcoded numbers):
 *   • runway          ← attribution.monthlyBurnRate vs vaultValue
 *   • concentration   ← top-token share of vaultTokens
 *   • drift           ← snapshots stats.driftPctPerDay (realized)
 *   • depletion risk  ← foresight summary.depletionProbability
 *
 * Renders a single verdict (green/amber/red) with the one-line "why",
 * traceability popovers per signal, and as-of/data-scope chips. If the
 * user has no wallet / no data, it asks them to connect — never invents
 * a number.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, AlertTriangle, CheckCircle2, Info, Wallet, ChevronRight } from "lucide-react";
import { Surface, Pill, StreamingNumber, StreamIn } from "@/components/app-shell/primitives";
import Link from "next/link";

interface Aggregates {
  inflowUsd: number; outflowUsd: number; yieldUsd: number; feeUsd: number;
  netUsd: number; monthlyBurnRate: number; monthlyInflow: number;
  annualYieldRate: number; sampleSize: number;
}
interface SnapshotStats { driftPctPerDay: number; volPctPerDay: number; samples: number }
interface ForesightSummary { depletionProbability: number; medianDepletionMonths: number | null }

interface Props {
  vaultValue: number | null;
  vaultTokens: any[];
  attribution: Aggregates | null;
  snapshotStats: SnapshotStats | null;
  foresight: ForesightSummary | null;
  /** ISO timestamp of newest snapshot (for "as of") */
  asOf?: string | null;
  /** Wallet address — null when not connected */
  activeVault: string | null;
}

type Grade = "ok" | "watch" | "risk" | "unknown";

interface SignalScore {
  id: "runway" | "concentration" | "drift" | "depletion";
  label: string;
  /** Numeric severity 0 (good) - 1 (bad) */
  severity: number;
  /** One-line plain-language reading */
  reading: string;
  /** Inputs that produced the reading (traceability) */
  inputs: { label: string; value: string }[];
  /** Where to drill in */
  drillHref?: string;
}

function formatUsdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "no snapshots yet";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "unknown";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function AreWeOkHero({
  vaultValue, vaultTokens, attribution, snapshotStats, foresight, asOf, activeVault,
}: Props) {
  const [openSignal, setOpenSignal] = useState<string | null>(null);

  // ── Empty state: no wallet ─────────────────────────────────────
  if (!activeVault) {
    return (
      <Surface className="p-7" >
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
              Are we OK?
            </p>
            <h2 className="mt-2 font-manrope text-3xl font-semibold tracking-tight text-slate-900">
              Connect a wallet to get your verdict.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              Your composite health score blends runway, concentration, drift, and depletion risk —
              all from your real treasury. Nothing here is a demo.
            </p>
          </div>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Wallet className="h-4 w-4" />
            Connect wallet
          </Link>
        </div>
      </Surface>
    );
  }

  // ── Score each signal independently ────────────────────────────
  const signals = useMemo<SignalScore[]>(() => {
    const out: SignalScore[] = [];

    // Runway (months) ← burn vs current value
    if (attribution && vaultValue && vaultValue > 0 && attribution.monthlyBurnRate > 0) {
      const months = vaultValue / attribution.monthlyBurnRate;
      const sev = months >= 24 ? 0 : months >= 12 ? 0.25 : months >= 6 ? 0.55 : months >= 3 ? 0.8 : 0.95;
      out.push({
        id: "runway",
        label: "Runway",
        severity: sev,
        reading:
          months >= 24 ? `~${Math.round(months)} months at current burn — comfortable.` :
          months >= 12 ? `~${months.toFixed(1)} months at current burn — healthy.` :
          months >= 6  ? `~${months.toFixed(1)} months — start planning the next inflow.` :
          months >= 3  ? `~${months.toFixed(1)} months — short runway, act this quarter.` :
                         `<${Math.max(1, Math.round(months))} months — critical, act now.`,
        inputs: [
          { label: "Treasury value", value: formatUsdCompact(vaultValue) },
          { label: "Monthly burn", value: formatUsdCompact(attribution.monthlyBurnRate) },
          { label: "Net 30d", value: formatUsdCompact(attribution.netUsd) },
          { label: "Sample size", value: `${attribution.sampleSize} events` },
        ],
        drillHref: "/app/treasury",
      });
    } else if (attribution && vaultValue && vaultValue > 0) {
      out.push({
        id: "runway",
        label: "Runway",
        severity: 0,
        reading: "No outflows recorded yet — runway is effectively unbounded.",
        inputs: [
          { label: "Treasury value", value: formatUsdCompact(vaultValue) },
          { label: "Monthly burn", value: "$0" },
        ],
        drillHref: "/app/treasury",
      });
    }

    // Concentration ← top-token share
    if (Array.isArray(vaultTokens) && vaultTokens.length > 0) {
      const total = vaultTokens.reduce((s: number, t: any) => s + (t?.value ?? 0), 0);
      if (total > 0) {
        const sorted = [...vaultTokens].sort((a: any, b: any) => (b?.value ?? 0) - (a?.value ?? 0));
        const top = sorted[0];
        const share = ((top?.value ?? 0) / total) * 100;
        const sev = share >= 80 ? 0.85 : share >= 60 ? 0.6 : share >= 40 ? 0.35 : 0.1;
        out.push({
          id: "concentration",
          label: "Concentration",
          severity: sev,
          reading:
            share >= 80 ? `${share.toFixed(0)}% in ${String(top?.symbol ?? "one asset").toUpperCase()} — heavily concentrated.` :
            share >= 60 ? `${share.toFixed(0)}% in ${String(top?.symbol ?? "one asset").toUpperCase()} — concentrated, consider trimming.` :
            share >= 40 ? `${share.toFixed(0)}% in ${String(top?.symbol ?? "one asset").toUpperCase()} — tilted but reasonable.` :
                          `Largest position is ${share.toFixed(0)}% — well diversified.`,
          inputs: [
            { label: "Top asset", value: String(top?.symbol ?? "—").toUpperCase() },
            { label: "Top share", value: `${share.toFixed(1)}%` },
            { label: "Positions", value: `${vaultTokens.length}` },
            { label: "Total value", value: formatUsdCompact(total) },
          ],
          drillHref: "/app/treasury",
        });
      }
    }

    // Drift ← realized daily volatility from snapshots
    if (snapshotStats && snapshotStats.samples >= 3) {
      const dailyVol = Math.abs(snapshotStats.volPctPerDay);
      const sev = dailyVol >= 0.05 ? 0.8 : dailyVol >= 0.025 ? 0.5 : dailyVol >= 0.01 ? 0.25 : 0.05;
      out.push({
        id: "drift",
        label: "Drift",
        severity: sev,
        reading:
          dailyVol >= 0.05 ? `Daily swings of ~${(dailyVol * 100).toFixed(1)}% — your treasury is volatile.` :
          dailyVol >= 0.025 ? `Daily swings of ~${(dailyVol * 100).toFixed(1)}% — moderate volatility.` :
          dailyVol >= 0.01 ? `Daily swings of ~${(dailyVol * 100).toFixed(1)}% — calm but not flat.` :
                             `Daily swings of ~${(dailyVol * 100).toFixed(2)}% — very stable.`,
        inputs: [
          { label: "Realized daily vol", value: `${(dailyVol * 100).toFixed(2)}%` },
          { label: "Realized daily drift", value: `${(snapshotStats.driftPctPerDay * 100).toFixed(2)}%` },
          { label: "Snapshots", value: `${snapshotStats.samples}` },
        ],
      });
    }

    // Depletion ← foresight Monte Carlo
    if (foresight) {
      const p = foresight.depletionProbability;
      const sev = p >= 0.5 ? 0.9 : p >= 0.25 ? 0.6 : p >= 0.1 ? 0.35 : 0.1;
      out.push({
        id: "depletion",
        label: "Depletion risk",
        severity: sev,
        reading:
          p >= 0.5 ? `Monte Carlo shows >${Math.round(p * 100)}% chance of depletion in the window.` :
          p >= 0.25 ? `~${Math.round(p * 100)}% of paths run out within the window — meaningful risk.` :
          p >= 0.1 ? `~${Math.round(p * 100)}% of paths run out — small but non-zero risk.` :
                     `<${Math.max(1, Math.round(p * 100))}% of paths deplete — outlook is durable.`,
        inputs: [
          { label: "Depletion probability", value: `${(p * 100).toFixed(1)}%` },
          { label: "Median depletion", value: foresight.medianDepletionMonths != null
            ? `${foresight.medianDepletionMonths} mo`
            : "n/a" },
        ],
      });
    }

    return out;
  }, [vaultValue, vaultTokens, attribution, snapshotStats, foresight]);

  // ── Composite verdict ──────────────────────────────────────────
  const grade: Grade = useMemo(() => {
    if (signals.length === 0) return "unknown";
    const max = Math.max(...signals.map((s) => s.severity));
    const avg = signals.reduce((a, s) => a + s.severity, 0) / signals.length;
    const score = 0.65 * max + 0.35 * avg;
    if (score >= 0.7) return "risk";
    if (score >= 0.4) return "watch";
    return "ok";
  }, [signals]);

  const verdictMeta = {
    ok:      { label: "We're OK",       icon: CheckCircle2,   tone: "emerald" as const, border: "border-emerald-200", dot: "bg-emerald-500", title: "text-emerald-700" },
    watch:   { label: "Worth watching", icon: Info,           tone: "amber"   as const, border: "border-amber-200",   dot: "bg-amber-500",   title: "text-amber-700" },
    risk:    { label: "Action needed",  icon: AlertTriangle,  tone: "rose"    as const, border: "border-rose-200",    dot: "bg-rose-500",    title: "text-rose-700" },
    unknown: { label: "Not enough data", icon: Shield,        tone: "slate"   as const, border: "border-violet-100",  dot: "bg-slate-400",   title: "text-slate-700" },
  }[grade];

  // The one-line "why" surfaces the highest-severity signal
  const lead = signals.length === 0
    ? "We need a few more data points (snapshots, a wallet event, or a vault sync) before we can grade your treasury."
    : [...signals].sort((a, b) => b.severity - a.severity)[0].reading;

  const Icon = verdictMeta.icon;

  return (
    <Surface className="overflow-hidden p-7" >
      {/* Verdict + lead */}
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <StreamIn className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-white ${verdictMeta.border}`}>
            <Icon className={`h-5 w-5 ${verdictMeta.title}`} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
              Are we OK?
            </p>
            <h2 className={`mt-1 font-manrope text-3xl font-semibold tracking-tight md:text-4xl ${verdictMeta.title}`}>
              {verdictMeta.label}.
            </h2>
            <p className="mt-2 max-w-xl text-base leading-relaxed text-slate-700">{lead}</p>
          </div>
        </StreamIn>

        {/* Treasury value + as-of */}
        <StreamIn delay={0.05} className="md:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Treasury</p>
          <div className="mt-1 font-manrope text-3xl font-semibold tracking-tight text-slate-900">
            {typeof vaultValue === "number" && vaultValue > 0
              ? <StreamingNumber value={vaultValue} prefix="$" decimals={0} />
              : <span className="text-slate-300">—</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 md:justify-end">
            <Pill tone="slate">As of {relTime(asOf)}</Pill>
            {snapshotStats && (
              <Pill tone="slate">{snapshotStats.samples} snapshots</Pill>
            )}
            {attribution && (
              <Pill tone="slate">{attribution.sampleSize} events</Pill>
            )}
          </div>
        </StreamIn>
      </div>

      {/* Signal grid (traceability) */}
      {signals.length > 0 && (
        <div className="mt-7 grid gap-3 md:grid-cols-4">
          {signals.map((s, i) => {
            const sevTone =
              s.severity >= 0.7 ? "rose" :
              s.severity >= 0.4 ? "amber" :
                                  "emerald";
            const open = openSignal === s.id;
            return (
              <StreamIn key={s.id} delay={0.06 + i * 0.04}>
                <button
                  type="button"
                  onClick={() => setOpenSignal(open ? null : s.id)}
                  className={`group w-full rounded-2xl border bg-white p-4 text-left transition-all ${
                    open ? "border-violet-300" : "border-violet-100 hover:border-violet-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {s.label}
                    </span>
                    <Pill tone={sevTone as any}>
                      {s.severity >= 0.7 ? "high" : s.severity >= 0.4 ? "watch" : "good"}
                    </Pill>
                  </div>
                  <p className="mt-2 text-sm leading-snug text-slate-800">{s.reading}</p>
                  <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-violet-700">
                    {open ? "Hide inputs" : "What's this from?"}
                    <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                          Inputs
                        </p>
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                          {s.inputs.map((inp) => (
                            <div key={inp.label} className="flex items-center justify-between">
                              <dt className="text-slate-500">{inp.label}</dt>
                              <dd className="font-medium text-slate-900">{inp.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {s.drillHref && (
                          <Link
                            href={s.drillHref}
                            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-800"
                          >
                            Open the source
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </StreamIn>
            );
          })}
        </div>
      )}
    </Surface>
  );
}
