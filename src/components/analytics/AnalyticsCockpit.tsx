"use client";

/**
 * AnalyticsCockpit — the single bespoke "answer-first" surface for /app/analytics.
 *
 * Replaces the older split layout (AreWeOkHero + four detached KPI tiles +
 * separate composition + trend cards) with one cohesive cockpit:
 *
 *   • Left  : oversized streaming valuation, signed 24h chip, 30d ribbon,
 *             composite verdict ("We're OK" / "Worth watching" / "Action needed")
 *             with traceable signal tiles, and a quiet KPI ladder.
 *   • Right : animated composition donut with a centered "top asset" label
 *             and a streamed legend (rank · symbol · share · USD).
 *   • Floating: Dryv mascot greeting (celebrate / think / alert) chosen from
 *             live verdict; DreyvStar accents — no dots, no sparkles.
 *
 * FLAT only — no shadow, no backdrop-blur, no gradient fills, no ring.
 * Solid violet (#7c3aed) for accents. Per analytics design rules.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { ChevronRight, Wallet, ShieldCheck, AlertTriangle, Eye } from "lucide-react";
import { DryvMascot } from "@/components/brand/dryv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TokenAvatar } from "@/components/TokenAvatar";
import { SignalBadge, severityFromScore } from "./SignalBadge";
import { estimateLstYield, fetchLiveLstRates, type LiveRatesMap } from "@/lib/foresight/lst-yield";

/* ────────────────────────────── Types ───────────────────────────── */

interface Aggregates {
  inflowUsd: number; outflowUsd: number; yieldUsd: number; feeUsd: number;
  netUsd: number; monthlyBurnRate: number; monthlyInflow: number;
  annualYieldRate: number; sampleSize: number;
}
interface SnapshotStats { driftPctPerDay: number; volPctPerDay: number; samples: number }
interface ForesightSummary { depletionProbability: number; medianDepletionMonths: number | null }

interface CockpitProps {
  activeVault: string | null;
  vaultValue: number | null;
  vaultChange24h: number | null;
  vaultTokens: any[];
  attribution: Aggregates | null;
  snapshotStats: SnapshotStats | null;
  foresight: ForesightSummary | null;
  /** ISO timestamp of newest snapshot */
  asOf: string | null;
  /** 30d value series (USD) used for the ribbon */
  trend: number[];
}

type Grade = "ok" | "watch" | "risk" | "unknown";

interface Signal {
  id: "runway" | "concentration" | "drift" | "depletion";
  label: string;
  reading: string;
  severity: number;        // 0 good → 1 bad
  inputs: { label: string; value: string }[];
  drillHref?: string;
}

/* ────────────────────────────── Helpers ─────────────────────────── */

const VIOLET_RAMP = ["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
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

/* ───────────────────────────── Ribbon ───────────────────────────── */

function ValueRibbon({ values }: { values: number[] }) {
  const path = useMemo(() => {
    if (!values || values.length < 2) return null;
    const w = 640;
    const h = 72;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = w / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 10) - 5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return { line: `M${pts.join(" L ")}`, w, h, last: pts[pts.length - 1] };
  }, [values]);

  if (!path) {
    return (
      <div className="flex h-[72px] items-center rounded-2xl border border-dashed border-violet-200 px-4 text-[11px] text-slate-400">
        Accumulating snapshots — your 30d ribbon will draw here.
      </div>
    );
  }

  const [lx, ly] = path.last.split(",").map(Number);

  return (
    <svg viewBox={`0 0 ${path.w} ${path.h}`} className="h-[72px] w-full" preserveAspectRatio="none">
      {/* Baseline tick rail (flat, solid violet-100) */}
      <line x1={0} x2={path.w} y1={path.h - 1} y2={path.h - 1} stroke="#ede9fe" strokeWidth="1" />
      <motion.path
        d={path.line}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.circle
        cx={lx}
        cy={ly}
        r={3.2}
        fill="#7c3aed"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1 }}
      />
    </svg>
  );
}

/* ───────────────────────────── Donut ────────────────────────────── */

function CompositionDonut({ holdings }: { holdings: any[] }) {
  const data = useMemo(() => {
    const list = (holdings ?? []).filter((t: any) => (t?.value ?? 0) > 0);
    const total = list.reduce((s: number, t: any) => s + (t?.value ?? 0), 0);
    if (total <= 0) return null;
    const sorted = [...list].sort((a: any, b: any) => (b?.value ?? 0) - (a?.value ?? 0));
    let acc = 0;
    const slices = sorted.slice(0, 6).map((t: any, i: number) => {
      const share = (t.value ?? 0) / total;
      const start = acc;
      acc += share;
      return {
        symbol: String(t.symbol ?? "—").toUpperCase(),
        mint: t.mint ?? "",
        logo: t.logo ?? t.logoURI ?? undefined,
        value: t.value ?? 0,
        share,
        start,
        color: VIOLET_RAMP[i % VIOLET_RAMP.length],
      };
    });
    return { slices, total, count: sorted.length };
  }, [holdings]);

  if (!data) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-2xl border border-dashed border-violet-200 px-4 text-center text-xs text-slate-400">
        Composition appears once your treasury holds assets.
      </div>
    );
  }

  const cx = 100;
  const cy = 100;
  const r = 78;
  const stroke = 16;
  const c = 2 * Math.PI * r;
  const top = data.slices[0];

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: 200, height: 200 }}>
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx={cx} cy={cy} r={r} stroke="#f5f3ff" strokeWidth={stroke} fill="none" />
          {data.slices.map((s, i) => (
            <motion.circle
              key={`${s.symbol}-${i}`}
              cx={cx}
              cy={cy}
              r={r}
              stroke={s.color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="butt"
              transform={`rotate(${-90 + s.start * 360} ${cx} ${cy})`}
              strokeDasharray={`${c * s.share} ${c}`}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: 0.95, delay: 0.07 * i, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
        </svg>
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5"
        >
          <TokenAvatar symbol={top.symbol} mint={top.mint} logo={top.logo} size={56} />
          <span className="font-manrope text-sm font-semibold text-slate-900">{top.symbol}</span>
          <span className="text-[10px] font-semibold tabular-nums text-violet-600">
            {(top.share * 100).toFixed(1)}%
          </span>
        </motion.div>
      </div>

      <ul className="w-full flex-1 space-y-2.5">
        {data.slices.map((s, i) => (
          <motion.li
            key={`${s.symbol}-${i}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.05 * i }}
            className="flex items-center gap-2.5"
          >
            <TokenAvatar symbol={s.symbol} mint={s.mint} logo={s.logo} size={20} />
            <span className="w-14 truncate text-xs font-semibold text-slate-800">{s.symbol}</span>
            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-violet-50">
              <motion.div
                className="absolute inset-y-0 left-0"
                style={{ backgroundColor: s.color }}
                initial={{ width: 0 }}
                animate={{ width: `${s.share * 100}%` }}
                transition={{ duration: 0.85, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
              {(s.share * 100).toFixed(0)}%
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
              {fmtCompact(s.value)}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/* ──────────────────────────── KPI Tile ──────────────────────────── */

function KpiTile({
  label,
  value,
  hint,
  emphasis = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: "default" | "violet" | "ink" | "amber";
}) {
  const tones = {
    default: "border-violet-100 bg-white",
    violet: "border-violet-200 bg-violet-50/60",
    ink: "border-slate-900 bg-slate-900 text-white",
    amber: "border-amber-200 bg-amber-50/60",
  } as const;
  const isInk = emphasis === "ink";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tones[emphasis]}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${isInk ? "text-violet-300" : "text-violet-600"}`}>
        <DreyvStar size={9} className={isInk ? "text-violet-300" : "text-violet-500"} />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1.5 font-manrope text-lg font-semibold tracking-tight ${isInk ? "text-white" : "text-slate-900"}`}>
        {value}
      </div>
      {hint && <div className={`mt-0.5 text-[11px] ${isInk ? "text-slate-300" : "text-slate-500"}`}>{hint}</div>}
    </div>
  );
}

/* ──────────────────────────── Cockpit ───────────────────────────── */

export function AnalyticsCockpit({
  activeVault,
  vaultValue,
  vaultChange24h,
  vaultTokens,
  attribution,
  snapshotStats,
  foresight,
  asOf,
  trend,
}: CockpitProps) {
  const [openSignal, setOpenSignal] = useState<string | null>(null);
  const [liveRates, setLiveRates] = useState<LiveRatesMap>({});

  /* ── Live LST APYs (refreshed every 5 min) ──────────────────── */
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    fetchLiveLstRates(ctrl.signal).then((r) => { if (!cancelled) setLiveRates(r); });
    const id = setInterval(() => {
      fetchLiveLstRates().then((r) => { if (!cancelled) setLiveRates(r); });
    }, 5 * 60 * 1000);
    return () => { cancelled = true; ctrl.abort(); clearInterval(id); };
  }, []);

  /* ── Streaming USD value (manual spring so we can split the $ glyph) ── */
  const target = vaultValue ?? 0;
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1200, bounce: 0 });
  const display = useTransform(spring, (v) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
  useEffect(() => {
    mv.set(target);
  }, [target, mv]);

  /* ── Empty state ────────────────────────────────────────────── */
  if (!activeVault) {
    return (
      <section className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-violet-300/35 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-32 bottom-[-220px] h-[360px] w-[360px] rounded-full bg-violet-200/40 blur-3xl" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:p-10">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <DreyvStar size={11} />
              <span>Treasury verdict</span>
            </div>
            <h1 className="mt-3 font-manrope text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl md:text-[56px]">
              Connect a wallet —<br /> we&apos;ll grade your treasury.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600">
              Dreyv blends runway, concentration, drift, and depletion risk from your live treasury into a single,
              traceable verdict. Nothing here is a demo.
            </p>
            <Link
              href="/app"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Wallet className="h-4 w-4" />
              Connect wallet
            </Link>
          </div>
          <div className="hidden items-center justify-center lg:flex">
            <DryvMascot pose="greet" size={180} />
          </div>
        </div>
      </section>
    );
  }

  /* ── Compute signals ────────────────────────────────────────── */
  const signals: Signal[] = useMemo(() => {
    const out: Signal[] = [];

    // Runway
    if (attribution && vaultValue && vaultValue > 0 && attribution.monthlyBurnRate > 0) {
      const months = vaultValue / attribution.monthlyBurnRate;
      const sev = months >= 24 ? 0 : months >= 12 ? 0.25 : months >= 6 ? 0.55 : months >= 3 ? 0.8 : 0.95;
      out.push({
        id: "runway",
        label: "Runway",
        severity: sev,
        reading:
          months >= 24 ? `~${Math.round(months)} months — comfortable.` :
          months >= 12 ? `~${months.toFixed(1)} months — healthy.` :
          months >= 6  ? `~${months.toFixed(1)} months — plan the next inflow.` :
          months >= 3  ? `~${months.toFixed(1)} months — short, act this quarter.` :
                         `<${Math.max(1, Math.round(months))} months — critical.`,
        inputs: [
          { label: "Treasury", value: fmtCompact(vaultValue) },
          { label: "Monthly burn", value: fmtCompact(attribution.monthlyBurnRate) },
          { label: "Net 30d", value: fmtCompact(attribution.netUsd) },
          { label: "Sample", value: `${attribution.sampleSize} events` },
        ],
        drillHref: "/app/treasury",
      });
    }

    // Concentration
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
            share >= 80 ? `${share.toFixed(0)}% in ${String(top?.symbol ?? "one").toUpperCase()} — heavy.` :
            share >= 60 ? `${share.toFixed(0)}% in ${String(top?.symbol ?? "one").toUpperCase()} — concentrated.` :
            share >= 40 ? `${share.toFixed(0)}% in ${String(top?.symbol ?? "one").toUpperCase()} — tilted.` :
                          `Top is ${share.toFixed(0)}% — well diversified.`,
          inputs: [
            { label: "Top asset", value: String(top?.symbol ?? "—").toUpperCase() },
            { label: "Top share", value: `${share.toFixed(1)}%` },
            { label: "Positions", value: `${vaultTokens.length}` },
            { label: "Total value", value: fmtCompact(total) },
          ],
          drillHref: "/app/treasury",
        });
      }
    }

    // Drift
    if (snapshotStats && snapshotStats.samples >= 3) {
      const dailyVol = Math.abs(snapshotStats.volPctPerDay);
      const sev = dailyVol >= 0.05 ? 0.8 : dailyVol >= 0.025 ? 0.5 : dailyVol >= 0.01 ? 0.25 : 0.05;
      out.push({
        id: "drift",
        label: "Drift",
        severity: sev,
        reading:
          dailyVol >= 0.05 ? `±${(dailyVol * 100).toFixed(1)}% / day — volatile.` :
          dailyVol >= 0.025 ? `±${(dailyVol * 100).toFixed(1)}% / day — moderate.` :
          dailyVol >= 0.01 ? `±${(dailyVol * 100).toFixed(1)}% / day — calm.` :
                             `±${(dailyVol * 100).toFixed(2)}% / day — very stable.`,
        inputs: [
          { label: "Daily vol", value: `${(dailyVol * 100).toFixed(2)}%` },
          { label: "Daily drift", value: `${(snapshotStats.driftPctPerDay * 100).toFixed(2)}%` },
          { label: "Snapshots", value: `${snapshotStats.samples}` },
        ],
      });
    }

    // Depletion
    if (foresight) {
      const p = foresight.depletionProbability;
      const sev = p >= 0.5 ? 0.9 : p >= 0.25 ? 0.6 : p >= 0.1 ? 0.35 : 0.1;
      out.push({
        id: "depletion",
        label: "Depletion",
        severity: sev,
        reading:
          p >= 0.5  ? `>${Math.round(p * 100)}% chance of depletion in window.` :
          p >= 0.25 ? `~${Math.round(p * 100)}% paths deplete — meaningful risk.` :
          p >= 0.1  ? `~${Math.round(p * 100)}% paths deplete — small risk.` :
                      `<${Math.max(1, Math.round(p * 100))}% paths deplete — durable.`,
        inputs: [
          { label: "Depletion P", value: `${(p * 100).toFixed(1)}%` },
          { label: "Median depl.", value: foresight.medianDepletionMonths != null ? `${foresight.medianDepletionMonths} mo` : "n/a" },
        ],
      });
    }

    return out;
  }, [vaultValue, vaultTokens, attribution, snapshotStats, foresight]);

  /* ── Composite verdict ──────────────────────────────────────── */
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
    ok:      { label: "We're OK",        title: "text-violet-700",  border: "border-violet-200", bg: "bg-violet-50/70",  icon: ShieldCheck,    pose: "celebrate" as const },
    watch:   { label: "Worth watching",  title: "text-amber-800",   border: "border-amber-200",  bg: "bg-amber-50/60",   icon: Eye,             pose: "think" as const },
    risk:    { label: "Action needed",   title: "text-white",       border: "border-slate-900",  bg: "bg-slate-900",     icon: AlertTriangle,   pose: "alert" as const },
    unknown: { label: "Reading…",        title: "text-slate-700",   border: "border-violet-100", bg: "bg-white",         icon: Eye,             pose: "think" as const },
  }[grade];

  const positive24h = (vaultChange24h ?? 0) >= 0;

  /* ── KPI ladder values ──────────────────────────────────────── */
  const positions = (vaultTokens ?? []).filter((t: any) => (t?.value ?? 0) > 0).length;
  const runwayMonths = attribution && attribution.monthlyBurnRate > 0 && vaultValue
    ? vaultValue / attribution.monthlyBurnRate
    : null;

  const Icon = verdictMeta.icon;

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white">
      {/* page-level ambient glow (not a card shadow) */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-violet-300/35 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-32 bottom-[-220px] h-[360px] w-[360px] rounded-full bg-violet-200/40 blur-3xl" />

      {/* Floating mascot */}
      {vaultValue != null && vaultValue > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 hidden md:block">
          <DryvMascot pose={verdictMeta.pose} size={96} />
        </div>
      )}

      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:p-10">
        {/* ── LEFT ── */}
        <div className="flex min-w-0 flex-col">
          {/* eyebrow + verdict pill */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <DreyvStar size={11} />
              Treasury verdict
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${verdictMeta.border} ${verdictMeta.bg} ${verdictMeta.title}`}>
              <Icon className="h-3 w-3" />
              {verdictMeta.label}
            </span>
          </div>

          {/* Big streaming valuation */}
          <div className="mt-3 font-manrope text-5xl font-semibold leading-[1.02] tracking-tight text-slate-900 sm:text-6xl md:text-[68px]">
            {vaultValue == null ? (
              <span className="text-slate-300">—</span>
            ) : (
              <>
                <span className="mr-1 align-top text-3xl text-violet-500 sm:text-4xl md:text-[42px]">$</span>
                <motion.span>{display}</motion.span>
              </>
            )}
          </div>

          {/* 24h chip + as-of */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SignalBadge severity={positive24h ? "good" : "watch"}>
              {vaultChange24h == null ? "no 24h baseline" : `${positive24h ? "+" : ""}${vaultChange24h.toFixed(2)}% · 24h`}
            </SignalBadge>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
              As of {relTime(asOf)}
            </span>
            {snapshotStats && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {snapshotStats.samples} snapshots
              </span>
            )}
            {attribution && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {attribution.sampleSize} events
              </span>
            )}
          </div>

          {/* 30d ribbon */}
          <div className="mt-6">
            <ValueRibbon values={trend} />
          </div>

          {/* Signal verdict tiles */}
          {signals.length > 0 && (
            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {signals.map((s, i) => {
                const sev = severityFromScore(s.severity);
                const ring =
                  sev === "risk"  ? "border-slate-300" :
                  sev === "watch" ? "border-amber-200" :
                                    "border-violet-100";
                const open = openSignal === s.id;
                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 * i }}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenSignal(open ? null : s.id)}
                      className={`group w-full rounded-2xl border bg-white p-3.5 text-left transition-colors ${
                        open ? "border-violet-300" : ring + " hover:border-violet-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {s.label}
                        </span>
                        <SignalBadge severity={sev} />
                      </div>
                      <p className="mt-2 text-sm leading-snug text-slate-800">{s.reading}</p>
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700">
                        {open ? "Hide inputs" : "Why?"}
                        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-3.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                              Inputs
                            </p>
                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                              {s.inputs.map((inp) => (
                                <div key={inp.label} className="flex items-center justify-between">
                                  <dt className="text-slate-500">{inp.label}</dt>
                                  <dd className="font-medium text-slate-900 tabular-nums">{inp.value}</dd>
                                </div>
                              ))}
                            </dl>
                            {s.drillHref && (
                              <Link
                                href={s.drillHref}
                                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-800"
                              >
                                Open the source <ChevronRight className="h-3 w-3" />
                              </Link>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* KPI ladder */}
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <KpiTile
              label="Inflows · 30d"
              value={fmtCompact(attribution?.inflowUsd ?? 0)}
              hint={`${fmtCompact(attribution?.monthlyInflow ?? 0)}/mo`}
              emphasis={(attribution?.inflowUsd ?? 0) > 0 ? "violet" : "default"}
            />
            <KpiTile
              label="Outflows · 30d"
              value={fmtCompact(attribution?.outflowUsd ?? 0)}
              hint={`${fmtCompact(attribution?.monthlyBurnRate ?? 0)}/mo burn`}
              emphasis={(attribution?.outflowUsd ?? 0) > 0 ? "amber" : "default"}
            />
            {(() => {
              const realizedApy = attribution?.annualYieldRate ?? 0;
              const realizedUsd = attribution?.yieldUsd ?? 0;
              const lst = estimateLstYield(
                (vaultTokens ?? []).map((t: any) => ({
                  symbol: t.symbol ?? "",
                  amount: Number(t.amount ?? 0),
                  priceUsd: Number(t.price ?? t.priceUsd ?? 0),
                })),
              );
              const useLst = realizedApy <= 0 && lst.blendedApy > 0;
              const apy = useLst ? lst.blendedApy : realizedApy;
              const annualUsd = useLst ? lst.annualYieldUsd : realizedUsd;
              return (
                <KpiTile
                  label={useLst ? "Yield · est. APY" : "Yield · APY"}
                  value={apy > 0 ? `${(apy * 100).toFixed(2)}%` : "—"}
                  hint={useLst
                    ? `${fmtCompact(annualUsd)}/yr · ${lst.positions} LST`
                    : fmtCompact(realizedUsd)}
                  emphasis={apy > 0 ? "ink" : "default"}
                />
              );
            })()}
            <KpiTile
              label="Runway"
              value={runwayMonths == null ? "—" : runwayMonths >= 60 ? "60+ mo" : `${runwayMonths.toFixed(1)} mo`}
              hint={positions ? `${positions} positions` : "—"}
            />
          </div>
        </div>

        {/* ── RIGHT — Composition ── */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <DreyvStar size={11} />
              Composition
            </span>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {positions === 0 ? "—" : `${Math.min(positions, 6)} of ${positions}`}
            </span>
          </div>

          <div className="mt-5 rounded-2xl border border-violet-100 bg-white p-5">
            <CompositionDonut holdings={vaultTokens ?? []} />
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            Every headline above traces back to live snapshots and on-chain events.
            Open any signal to see exactly which inputs produced it.
          </p>
        </div>
      </div>
    </section>
  );
}
