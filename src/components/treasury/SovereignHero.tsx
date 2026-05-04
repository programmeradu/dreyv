"use client";

/**
 * SovereignHero — the single, bespoke "cockpit" surface that opens
 * /app/treasury. Replaces the previous basic grid (HeadlineValue +
 * CompositionStrip + small stats) with one cohesive composition:
 *
 *  - Left column  : oversized streaming valuation, signed delta chip,
 *                    inline 7d sparkline ribbon (live, fetched from
 *                    /api/treasury/trend), and a quiet KPI ladder.
 *  - Right column : animated radial composition donut with a
 *                    centered "top asset" callout and a stacked
 *                    legend that streams in.
 *  - Floating     : Dryv mascot greeting in the upper-right corner;
 *                    DreyvStar accents — never dots, never sparkles.
 *
 * Pure presentational. Reads from props. Flat-only surfaces per
 * brand rules (no shadows on cards, no gradients on fills, solid
 * violet only). Mobile collapses to a single column with the donut
 * ABOVE the legend.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { DryvMascot } from "@/components/brand/dryv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TokenAvatar } from "@/components/TokenAvatar";
import { SignalBadge, severityFromDelta } from "@/components/analytics/SignalBadge";

export interface HeroHolding {
  symbol: string;
  label: string;
  value: number;
  logo?: string;
  mint?: string;
}

interface Props {
  totalValue: number | null;
  change24h: number | null;
  holdings: HeroHolding[];
  assetCount: number;
  stableBalance: number;
  signers?: { threshold: number; members: number } | null;
  isMultisig: boolean;
  pendingApprovals: number;
  /** Symbols + weights basket for the inline trend ribbon. */
  basket: { symbol: string; weight: number }[];
}

const VIOLET_RAMP = [
  "#7c3aed", // 600
  "#8b5cf6", // 500
  "#a78bfa", // 400
  "#c4b5fd", // 300
  "#ddd6fe", // 200
  "#ede9fe", // 100
];

function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/* ------------------------------- Sparkline -------------------------------- */

function TrendRibbon({
  basket,
  totalValue,
}: {
  basket: { symbol: string; weight: number }[];
  totalValue: number | null;
}) {
  const [series, setSeries] = useState<number[] | null>(null);
  const [changePct, setChangePct] = useState<number | null>(null);

  useEffect(() => {
    if (!basket.length) {
      setSeries(null);
      return;
    }
    const symbols = basket.map((b) => b.symbol).join(",");
    const weights = basket.map((b) => b.weight.toFixed(4)).join(",");
    const url = `/api/treasury/trend?range=7d&symbols=${symbols}&weights=${weights}&totalValue=${totalValue ?? 0}`;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.series) return;
        setSeries(d.series);
        setChangePct(typeof d.changePct === "number" ? d.changePct : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(basket), totalValue]);

  const path = useMemo(() => {
    if (!series || series.length < 2) return null;
    const w = 520;
    const h = 64;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    const step = w / (series.length - 1);
    const pts = series.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 8) - 4}`);
    return {
      line: `M${pts.join(" L ")}`,
      area: `M0,${h} L${pts.join(" L ")} L${w},${h} Z`,
      w,
      h,
      pos: (changePct ?? 0) >= 0,
    };
  }, [series, changePct]);

  if (!path) {
    return <div className="h-16 w-full rounded-2xl border border-dashed border-violet-100" />;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${path.w} ${path.h}`} className="h-16 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sov-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={path.area}
          fill="url(#sov-trend-fill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7 }}
        />
        <motion.path
          d={path.line}
          fill="none"
          stroke="#7c3aed"
          strokeWidth={1.75}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="pointer-events-none absolute right-0 top-0 flex items-center gap-1 text-[10px] font-medium text-slate-500">
        <DreyvStar size={9} className="text-violet-500" />
        <span>7d · {path.pos ? "+" : ""}{(changePct ?? 0).toFixed(2)}%</span>
      </div>
    </div>
  );
}

/* --------------------------------- Donut ---------------------------------- */

function CompositionDonut({ holdings }: { holdings: HeroHolding[] }) {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const slices = useMemo(() => {
    if (total <= 0) return [];
    let acc = 0;
    return holdings.slice(0, 6).map((h, i) => {
      const share = h.value / total;
      const start = acc;
      acc += share;
      return { ...h, share, start, end: acc, color: VIOLET_RAMP[i % VIOLET_RAMP.length] };
    });
  }, [holdings, total]);

  const r = 70;
  const stroke = 14;
  const c = 2 * Math.PI * r;
  const cx = 90;
  const cy = 90;

  if (slices.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-2xl border border-dashed border-violet-100 px-4 text-center text-xs text-slate-400">
        Composition will appear once your treasury holds assets.
      </div>
    );
  }

  const top = slices[0];

  return (
    <div className="flex items-center gap-5">
      <svg width="180" height="180" viewBox="0 0 180 180" className="shrink-0">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} stroke="#f5f3ff" strokeWidth={stroke} fill="none" />
        {slices.map((s, i) => (
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
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - s.share) }}
            transition={{ duration: 0.95, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] }}
            style={{ strokeDasharray: `${c * s.share} ${c}` }}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-slate-500" fontSize="10" letterSpacing="1.5">
          TOP ASSET
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-slate-900 font-manrope" fontSize="22" fontWeight="600">
          {top.symbol}
        </text>
        <text x={cx} y={cy + 32} textAnchor="middle" className="fill-violet-600" fontSize="11" fontWeight="600">
          {(top.share * 100).toFixed(1)}%
        </text>
      </svg>

      <ul className="flex-1 space-y-2.5">
        {slices.map((s, i) => (
          <motion.li
            key={`${s.symbol}-${i}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.05 * i }}
            className="flex items-center gap-2.5"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="w-14 truncate text-xs font-semibold text-slate-800">{s.symbol}</span>
            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-violet-50">
              <motion.div
                className="absolute inset-y-0 left-0"
                style={{ backgroundColor: s.color }}
                initial={{ width: 0 }}
                animate={{ width: `${s.share * 100}%` }}
                transition={{ duration: 0.8, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
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

/* --------------------------------- KPIs ----------------------------------- */

function KpiTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: "default" | "violet";
}) {
  return (
    <div
      className={
        emphasis === "violet"
          ? "rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3"
          : "rounded-2xl border border-violet-100 bg-white px-4 py-3"
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600">
        <DreyvStar size={9} className="text-violet-500" />
        {label}
      </div>
      <div className="mt-1.5 font-manrope text-lg font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

/* --------------------------------- Main ----------------------------------- */

export function SovereignHero({
  totalValue,
  change24h,
  holdings,
  assetCount,
  stableBalance,
  signers,
  isMultisig,
  pendingApprovals,
  basket,
}: Props) {
  const positive = (change24h ?? 0) >= 0;

  // Streaming digits for the headline (split prefix to spec the giant glyphs).
  const target = totalValue ?? 0;
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1200, bounce: 0 });
  const display = useTransform(spring, (v) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
  useEffect(() => {
    mv.set(target);
  }, [target, mv]);

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white">
      {/* ambient violet wash — flat, not a card shadow */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-violet-300/35 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-32 bottom-[-220px] h-[360px] w-[360px] rounded-full bg-violet-200/40 blur-3xl" />

      {/* Mascot — only when there's a treasury to greet */}
      {totalValue != null && totalValue > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 hidden md:block">
          <DryvMascot pose={positive ? "celebrate" : "think"} size={96} />
        </div>
      )}

      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:p-10">
        {/* LEFT — value + ribbon + KPIs */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
            <DreyvStar size={11} />
            <span>Sovereign treasury</span>
          </div>

          <div className="mt-3 font-manrope text-5xl font-semibold leading-[1.02] tracking-tight text-slate-900 sm:text-6xl md:text-[68px]">
            {totalValue == null ? (
              <span className="text-slate-300">—</span>
            ) : (
              <>
                <span className="mr-1 align-top text-3xl text-violet-500 sm:text-4xl md:text-[42px]">$</span>
                <motion.span>{display}</motion.span>
              </>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold " +
                (positive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700")
              }
            >
              <DreyvStar size={9} className={positive ? "text-emerald-600" : "text-rose-600"} />
              {change24h == null ? "no 24h baseline" : `${positive ? "+" : ""}${change24h.toFixed(2)}% · 24h`}
            </span>
            <span className="text-xs text-slate-500">
              {totalValue == null
                ? "Connect a wallet or paste an address to begin."
                : "Live valuation · re-prices every 30s"}
            </span>
          </div>

          {/* 7d ribbon */}
          <div className="mt-6">
            <TrendRibbon basket={basket} totalValue={totalValue} />
          </div>

          {/* KPI ladder */}
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <KpiTile
              label="Assets"
              value={String(assetCount)}
              hint={assetCount === 0 ? "no holdings yet" : `${assetCount} live`}
            />
            <KpiTile
              label="Idle stables"
              value={fmtCompact(stableBalance)}
              hint={stableBalance > 0 ? "available to deploy" : "—"}
              emphasis={stableBalance > 0 ? "violet" : "default"}
            />
            <KpiTile
              label="Signers"
              value={signers ? `${signers.threshold} / ${signers.members}` : isMultisig ? "multisig" : "single"}
              hint={isMultisig ? "Squads multisig" : "hot wallet"}
            />
            <KpiTile
              label="Pending"
              value={String(pendingApprovals)}
              hint={pendingApprovals > 0 ? "awaiting approval" : "all clear"}
              emphasis={pendingApprovals > 0 ? "violet" : "default"}
            />
          </div>
        </div>

        {/* RIGHT — composition donut */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <DreyvStar size={11} />
              <span>Composition</span>
            </div>
            <span className="text-[11px] text-slate-500">
              {holdings.length === 0 ? "—" : `${Math.min(holdings.length, 6)} of ${holdings.length}`}
            </span>
          </div>

          <div className="mt-5 rounded-2xl border border-violet-100 bg-white p-5">
            <CompositionDonut holdings={holdings} />
          </div>

          {/* tiny footer line — what to ask Dreyv next */}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            Dreyv is watching every position. Pin what matters, dismiss what doesn&apos;t — the canvas
            below grows with every question you ask.
          </p>
        </div>
      </div>
    </section>
  );
}
