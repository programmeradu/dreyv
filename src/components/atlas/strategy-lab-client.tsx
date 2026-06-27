"use client";

/**
 * Dreyv Lab — Hindsight · Foresight · Stress · Playbooks
 *
 * Design language: "Numbers as monuments."
 *   - Bone-white surfaces, hairline borders, oversized tabular numerics.
 *   - Custom hand-drawn SVG charts (donut, waterfall, delta-area, scatter).
 *   - Motion is restrained: spring-eased cross-fades, no bouncy easings.
 *
 * All data is real (Helius DAS + CoinGecko + our /api/lab/* routes).
 */

import Image, { type StaticImageData } from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Loader2, X } from "lucide-react";
import labCrystal from "@/assets/lab-crystal.png";
import labHeroHindsight from "@/assets/lab-hero-hindsight.png";
import labHeroForesight from "@/assets/lab-hero-foresight.png";
import labHeroStress from "@/assets/lab-hero-stress.png";
import labHeroPlaybooks from "@/assets/lab-hero-playbooks.png";
import glyphHindsight from "@/assets/lab-glyph-hindsight.png";
import glyphForesight from "@/assets/lab-glyph-foresight.png";
import glyphStress from "@/assets/lab-glyph-stress.png";
import glyphPlaybooks from "@/assets/lab-glyph-playbooks.png";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type {
  LabPosition,
  LabRotation,
  LabMissedRotation,
  LabStressResult,
  LabPlaybook,
  LabBacktestResult,
} from "@/lib/lab/types";

type Mode = "hindsight" | "foresight" | "stress" | "playbooks";

const MODES: Array<{ id: Mode; label: string; hint: string; glyph: StaticImageData }> = [
  { id: "hindsight", label: "Hindsight", hint: "What you missed", glyph: glyphHindsight },
  { id: "foresight", label: "Foresight", hint: "Where to move", glyph: glyphForesight },
  { id: "stress", label: "Stress", hint: "What breaks you", glyph: glyphStress },
  { id: "playbooks", label: "Playbooks", hint: "What to deploy", glyph: glyphPlaybooks },
];

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const VIOLET_PALETTE = ["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

// ─── Atomic primitives ──────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-zinc-200/70 bg-white ${className}`}>{children}</div>;
}

function Numeric({
  value,
  prefix = "",
  suffix = "",
  size = "xl",
  tone = "ink",
}: {
  value: number | string;
  prefix?: string;
  suffix?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "mono";
  tone?: "ink" | "positive" | "negative" | "muted" | "violet";
}) {
  const sizes = {
    sm: "text-xs",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-4xl",
    "2xl": "text-[56px] leading-[1] sm:text-6xl",
    mono: "text-sm",
  };
  const tones = {
    ink: "text-zinc-900",
    positive: "text-emerald-600",
    negative: "text-rose-600",
    muted: "text-zinc-400",
    violet: "text-violet-600",
  };
  return (
    <span
      className={`font-mono tabular-nums tracking-tight ${sizes[size]} ${tones[tone]}`}
      style={{ fontFeatureSettings: '"ss01","cv11"', fontVariantNumeric: "tabular-nums" }}
    >
      {prefix}
      {typeof value === "number" ? formatNum(value) : value}
      {suffix}
    </span>
  );
}

function formatNum(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return (n / 1000).toFixed(1) + "k";
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

function formatUsd(n: number): string {
  const s = Math.abs(n) >= 1000 ? formatNum(Math.abs(n)) : Math.abs(n).toFixed(2);
  return (n < 0 ? "−" : "") + "$" + s;
}

function formatPct(n: number, digits = 2): string {
  return (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(digits) + "%";
}

// ─── Custom SVG charts ──────────────────────────────────────────────

/** Concentric donut — composition signature chart. */
function RadialDonut({
  segments,
  size = 168,
  thickness = 14,
  centerLabel,
  centerValue,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f4f4f5" strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const len = frac * c;
          const offset = c - acc;
          acc += len;
          return (
            <motion.circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${len} ${c}`}
              strokeDashoffset={-offset + c}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 * i, duration: 0.4 }}
            />
          );
        })}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-400">{centerLabel}</div>}
          {centerValue && (
            <div className="mt-1 font-mono text-lg tabular-nums tracking-tight text-zinc-900">{centerValue}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Waterfall — cumulative impact chart with axis ticks, gradient bars, glow. */
function WaterfallChart({
  items,
  height = 260,
}: {
  items: Array<{ label: string; delta: number; before: number }>;
  height?: number;
}) {
  const width = 880;
  const padL = 64;
  const padR = 28;
  const padT = 24;
  const padB = 40;
  const innerH = height - padT - padB;
  const innerW = width - padL - padR;

  const startTotal = items.reduce((s, x) => s + x.before, 0);
  let running = startTotal;
  const points: Array<{ y0: number; y1: number; delta: number; label: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const before = running;
    running += items[i].delta;
    points.push({ y0: before, y1: running, delta: items[i].delta, label: items[i].label });
  }
  const allVals = [startTotal, running, ...points.flatMap((p) => [p.y0, p.y1])];
  const maxV = Math.max(...allVals);
  const minV = Math.min(0, ...allVals);
  const range = maxV - minV || 1;
  const cols = items.length + 2; // start + items + end
  const slot = innerW / cols;
  const barW = slot * 0.62;
  const scaleY = (v: number) => padT + innerH - ((v - minV) / range) * innerH;

  // Y-axis ticks (4 levels)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => minV + range * t);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="wf-pos" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="wf-neg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb7185" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#e11d48" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="wf-start" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#27272a" />
          <stop offset="100%" stopColor="#52525b" />
        </linearGradient>
        <linearGradient id="wf-end" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
        <filter id="wf-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Gridlines + Y ticks */}
      {ticks.map((tv, i) => {
        const y = scaleY(tv);
        return (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke={tv === 0 ? "#d4d4d8" : "#f4f4f5"} strokeDasharray={tv === 0 ? "0" : "2 4"} />
            <text x={padL - 10} y={y + 3} textAnchor="end" fontSize="10" fill="#a1a1aa" fontFamily="ui-monospace,monospace">
              ${tv >= 0 ? "" : "−"}{Math.abs(tv) >= 1000 ? (Math.abs(tv) / 1000).toFixed(1) + "k" : Math.abs(tv).toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Start column */}
      {(() => {
        const cx = padL + slot * 0.5 - barW / 2;
        const y = scaleY(startTotal);
        return (
          <g>
            <motion.rect x={cx} y={y} width={barW} height={Math.max(2, scaleY(0) - y)} fill="url(#wf-start)" rx="4"
              initial={{ opacity: 0, y: y + 8 }} animate={{ opacity: 1, y }} transition={{ duration: 0.4 }} />
            <text x={cx + barW / 2} y={y - 8} textAnchor="middle" fontSize="10" fill="#27272a" fontFamily="ui-monospace,monospace" fontWeight="600">
              ${startTotal >= 1000 ? (startTotal / 1000).toFixed(1) + "k" : startTotal.toFixed(0)}
            </text>
            <text x={cx + barW / 2} y={height - 14} textAnchor="middle" fontSize="10" fill="#71717a" fontWeight="500">Before</text>
          </g>
        );
      })()}

      {/* Delta bars */}
      {points.map((p, i) => {
        const cx = padL + slot * (i + 1.5) - barW / 2;
        const top = scaleY(Math.max(p.y0, p.y1));
        const bot = scaleY(Math.min(p.y0, p.y1));
        const isNeg = p.delta < 0;
        return (
          <g key={i}>
            <motion.rect x={cx} width={barW} y={top} height={Math.max(2, bot - top)} fill={isNeg ? "url(#wf-neg)" : "url(#wf-pos)"} rx="4"
              filter="url(#wf-glow)"
              initial={{ opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }}
              transition={{ delay: 0.06 * i, duration: 0.4, ease: [0.2, 0, 0, 1] }}
              style={{ transformOrigin: `${cx + barW / 2}px ${scaleY(p.y0)}px` }} />
            <text x={cx + barW / 2} y={top - 6} textAnchor="middle" fontSize="10" fill={isNeg ? "#e11d48" : "#059669"} fontFamily="ui-monospace,monospace" fontWeight="600">
              {p.delta >= 0 ? "+" : "−"}${Math.abs(p.delta) >= 1000 ? (Math.abs(p.delta) / 1000).toFixed(1) + "k" : Math.abs(p.delta).toFixed(0)}
            </text>
            <text x={cx + barW / 2} y={height - 14} textAnchor="middle" fontSize="10" fill="#71717a">
              {p.label.length > 8 ? p.label.slice(0, 7) + "…" : p.label}
            </text>
            {i < points.length - 1 && (
              <line x1={cx + barW} x2={padL + slot * (i + 2.5) - barW / 2} y1={scaleY(p.y1)} y2={scaleY(p.y1)} stroke="#d4d4d8" strokeDasharray="2 3" />
            )}
          </g>
        );
      })}

      {/* End column */}
      {(() => {
        const cx = padL + slot * (cols - 0.5) - barW / 2;
        const y = scaleY(running);
        return (
          <g>
            <motion.rect x={cx} y={y} width={barW} height={Math.max(2, scaleY(0) - y)} fill="url(#wf-end)" rx="4"
              filter="url(#wf-glow)"
              initial={{ opacity: 0, y: y + 8 }} animate={{ opacity: 1, y }} transition={{ delay: 0.06 * points.length + 0.1, duration: 0.45 }} />
            <text x={cx + barW / 2} y={y - 8} textAnchor="middle" fontSize="10" fill="#5b21b6" fontFamily="ui-monospace,monospace" fontWeight="700">
              ${running >= 1000 ? (running / 1000).toFixed(1) + "k" : running.toFixed(0)}
            </text>
            <text x={cx + barW / 2} y={height - 14} textAnchor="middle" fontSize="10" fill="#5b21b6" fontWeight="600">After</text>
          </g>
        );
      })()}
    </svg>
  );
}

/** Delta-area — backtest playbook vs baseline with axis ticks, glow, $ labels. */
function DeltaArea({
  playbook,
  baseline,
  height = 300,
}: {
  playbook: number[];
  baseline: number[];
  height?: number;
}) {
  if (playbook.length < 2 || baseline.length < 2) return <div className="h-72 w-full" />;
  const width = 880;
  const padL = 56;
  const padR = 24;
  const padT = 16;
  const padB = 30;
  const innerH = height - padT - padB;
  const innerW = width - padL - padR;
  const all = [...playbook, ...baseline];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const dx = innerW / (playbook.length - 1);
  const x = (i: number) => padL + i * dx;
  const y = (v: number) => padT + innerH - ((v - min) / range) * innerH;

  const pathOf = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");

  const upper = playbook.map((v, i) => Math.max(v, baseline[i]));
  const lower = playbook.map((v, i) => Math.min(v, baseline[i]));
  const upperPath = upper.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const lowerPathRev = lower.slice().reverse().map((v, i) => {
    const idx = lower.length - 1 - i;
    return `L${x(idx).toFixed(2)},${y(v).toFixed(2)}`;
  }).join(" ");
  const deltaPath = `${upperPath} ${lowerPathRev} Z`;

  const endP = playbook[playbook.length - 1];
  const endB = baseline[baseline.length - 1];
  const ahead = endP >= endB;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + range * t);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * (playbook.length - 1)));

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="da-delta" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity={ahead ? 0.22 : 0.12} />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="da-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <filter id="da-glow" x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Y ticks */}
        {ticks.map((tv, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(tv)} y2={y(tv)} stroke="#f4f4f5" strokeDasharray="2 4" />
            <text x={padL - 8} y={y(tv) + 3} textAnchor="end" fontSize="10" fill="#a1a1aa" fontFamily="ui-monospace,monospace">
              ${Math.abs(tv) >= 1000 ? (tv / 1000).toFixed(1) + "k" : tv.toFixed(0)}
            </text>
          </g>
        ))}
        {/* X ticks (day markers) */}
        {xTicks.map((xi, i) => (
          <text key={i} x={x(xi)} y={height - 10} textAnchor="middle" fontSize="10" fill="#a1a1aa">
            d{xi}
          </text>
        ))}

        <path d={deltaPath} fill="url(#da-delta)" />
        <path d={pathOf(baseline)} fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="5 4" />
        <motion.path d={pathOf(playbook)} fill="none" stroke="url(#da-stroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#da-glow)"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.2, 0, 0, 1] }} />

        {/* End markers */}
        <circle cx={x(playbook.length - 1)} cy={y(endP)} r="11" fill="#7c3aed" fillOpacity="0.14" />
        <circle cx={x(playbook.length - 1)} cy={y(endP)} r="5" fill="#7c3aed" stroke="#fff" strokeWidth="1.5" />
        <circle cx={x(playbook.length - 1)} cy={y(endB)} r="3.5" fill="#a1a1aa" stroke="#fff" strokeWidth="1.5" />
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-5 text-[11px] text-zinc-500">
        <span className="flex items-center gap-2"><span className="h-[3px] w-6 rounded-full bg-gradient-to-r from-violet-400 to-violet-600" /> Playbook</span>
        <span className="flex items-center gap-2"><span className="h-[2px] w-6" style={{ backgroundImage: "linear-gradient(to right,#a1a1aa 50%,transparent 50%)", backgroundSize: "6px 2px" }} /> Hold baseline</span>
        <span className="ml-auto flex items-center gap-2 text-zinc-400"><span className="h-2.5 w-3.5 rounded bg-violet-100" /> Δ region</span>
      </div>
    </div>
  );
}

/** Risk-Return scatter — quadrant guides, gradient bubbles, glow halo. */
function RiskReturnScatter({
  rotations,
  height = 260,
}: {
  rotations: LabRotation[];
  height?: number;
}) {
  if (rotations.length === 0) return null;
  const width = 820;
  const padL = 52;
  const padR = 20;
  const padT = 20;
  const padB = 38;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const apys = rotations.map((r) => r.to.apy);
  const vols = rotations.map((r) => r.vol * 100);
  const maxApy = Math.max(...apys) * 1.15 || 1;
  const maxVol = Math.max(...vols) * 1.18 || 1;
  const maxGain = Math.max(...rotations.map((r) => Math.abs(r.projectedDeltaUsd)), 1);

  const x = (v: number) => padL + (v / maxVol) * innerW;
  const yScale = (v: number) => padT + innerH - (v / maxApy) * innerH;
  const midX = padL + innerW / 2;
  const midY = padT + innerH / 2;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="rr-bubble" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.05" />
        </radialGradient>
        <filter id="rr-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Quadrant guides */}
      <line x1={midX} x2={midX} y1={padT} y2={padT + innerH} stroke="#f4f4f5" strokeDasharray="3 4" />
      <line x1={padL} x2={padL + innerW} y1={midY} y2={midY} stroke="#f4f4f5" strokeDasharray="3 4" />
      <text x={padL + innerW - 6} y={padT + 14} textAnchor="end" fontSize="9" fill="#c4b5fd" fontWeight="600">HIGH RISK · HIGH YIELD</text>
      <text x={padL + 6} y={padT + 14} fontSize="9" fill="#34d399" fontWeight="600">SWEET SPOT</text>
      <text x={padL + 6} y={padT + innerH - 6} fontSize="9" fill="#a1a1aa">low yield · low risk</text>
      <text x={padL + innerW - 6} y={padT + innerH - 6} textAnchor="end" fontSize="9" fill="#fda4af">danger zone</text>

      {/* Axes */}
      <line x1={padL} x2={padL + innerW} y1={padT + innerH} y2={padT + innerH} stroke="#e4e4e7" />
      <line x1={padL} x2={padL} y1={padT} y2={padT + innerH} stroke="#e4e4e7" />

      {/* Y ticks (APY %) */}
      {[0.25, 0.5, 0.75, 1].map((t) => {
        const v = maxApy * t;
        return (
          <text key={t} x={padL - 6} y={yScale(v) + 3} textAnchor="end" fontSize="9" fill="#a1a1aa" fontFamily="ui-monospace,monospace">
            {v.toFixed(1)}%
          </text>
        );
      })}
      {/* X ticks (vol %) */}
      {[0.25, 0.5, 0.75, 1].map((t) => {
        const v = maxVol * t;
        return (
          <text key={t} x={x(v)} y={padT + innerH + 14} textAnchor="middle" fontSize="9" fill="#a1a1aa" fontFamily="ui-monospace,monospace">
            {v.toFixed(0)}%
          </text>
        );
      })}

      {/* Axis labels */}
      <text x={padL} y={padT - 6} fontSize="10" fill="#52525b" fontWeight="600">APY</text>
      <text x={padL + innerW} y={height - 4} textAnchor="end" fontSize="10" fill="#52525b" fontWeight="600">Volatility →</text>

      {rotations.map((r, i) => {
        const cx = x(r.vol * 100);
        const cy = yScale(r.to.apy);
        const radius = 7 + (Math.abs(r.projectedDeltaUsd) / maxGain) * 18;
        return (
          <g key={i}>
            <motion.circle cx={cx} cy={cy} r={radius * 1.4} fill="url(#rr-bubble)" filter="url(#rr-glow)"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.06 * i, duration: 0.5, ease: [0.2, 0, 0, 1] }}
              style={{ transformOrigin: `${cx}px ${cy}px` }} />
            <motion.circle cx={cx} cy={cy} r={radius} fill="#7c3aed" fillOpacity="0.85" stroke="#fff" strokeWidth="1.5"
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.08 * i + 0.05, duration: 0.4 }}
              style={{ transformOrigin: `${cx}px ${cy}px` }} />
            <text x={cx} y={cy - radius - 6} textAnchor="middle" fontSize="10" fill="#27272a" fontWeight="600">
              {r.to.symbol}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Hero / address input ───────────────────────────────────────────

function AddressGate({ onResolve, address, busy }: {
  onResolve: (addr: string) => void;
  address: string;
  busy: boolean;
}) {
  const [v, setV] = useState(address);
  const valid = SOL_ADDR_RE.test(v.trim());
  return (
    <div className="mx-auto max-w-2xl">
      <div className="relative text-center">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300/20 blur-[80px]" />
        <div className="flex items-center justify-center gap-1.5 text-[13px] leading-none text-violet-700">
          <span className="font-semibold lowercase tracking-tight" style={{ fontFamily: "Urbanist, ui-sans-serif, system-ui" }}>dreyv</span>
          <span className="font-black uppercase tracking-[0.18em]">LAB</span>
        </div>
        <h1 className="mt-4 font-display text-2xl font-medium tracking-tight text-zinc-900 sm:text-3xl">
          Decide with hindsight.
          <br />
          <span className="text-zinc-400">Act with foresight.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-zinc-500">
          Paste a Solana address to begin.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onResolve(v.trim());
        }}
        className="mt-6"
      >
        <div className={`group flex items-center gap-1.5 rounded-full border bg-white p-1.5 pl-2 transition-all ${valid ? "border-violet-300 shadow-[0_0_0_6px_rgba(124,58,237,0.08)]" : "border-violet-100 hover:border-violet-200"}`}>
          <input
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="Paste a Solana address…"
            className="flex-1 bg-transparent px-3 py-2 font-mono text-[12px] tracking-tight text-zinc-900 outline-none placeholder:font-sans placeholder:text-[13px] placeholder:tracking-normal placeholder:text-zinc-400"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="submit"
            disabled={!valid || busy}
            className="flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-200 disabled:text-white/80"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Open <ArrowUpRight className="h-3.5 w-3.5" /></>}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Mode dock ──────────────────────────────────────────────────────

function ModeDock({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const active = MODES.find((m) => m.id === mode)!;
  return (
    <div className="sticky top-2 z-30 mx-auto w-full max-w-3xl px-4">
      <div className="flex items-center justify-center gap-1 rounded-full border border-zinc-200/80 bg-white/85 p-1 shadow-[0_1px_0_rgba(0,0,0,0.02)] backdrop-blur-xl">
        {MODES.map((m) => {
          const isActive = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={`relative flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? "text-white" : "text-zinc-600 hover:text-zinc-900"}`}
            >
              {isActive && (
                <motion.span
                  layoutId="mode-pill"
                  className="absolute inset-0 rounded-full bg-zinc-900"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative">{m.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        <Image src={active.glyph} alt="" width={16} height={16} className="h-4 w-4 object-contain opacity-80" />
        <span>{active.hint}</span>
      </div>
    </div>
  );
}

// ─── Hero header (post-resolve) ─────────────────────────────────────

function HeroHeader({
  address,
  positions,
  totalUsd,
  onClear,
}: {
  address: string;
  positions: LabPosition[];
  totalUsd: number;
  onClear: () => void;
}) {
  const top = positions.slice(0, 5);
  const otherUsd = positions.slice(5).reduce((s, p) => s + p.valueUsd, 0);
  const segments = [
    ...top.map((p, i) => ({ label: p.symbol, value: p.valueUsd, color: VIOLET_PALETTE[i] })),
    ...(otherUsd > 0 ? [{ label: "Other", value: otherUsd, color: VIOLET_PALETTE[5] }] : []),
  ];

  const idleUsd = positions.filter((p) => p.category === "IDLE").reduce((s, p) => s + p.valueUsd, 0);
  const yieldUsd = positions.filter((p) => p.category === "YIELD_BEARING").reduce((s, p) => s + p.valueUsd, 0);
  const specUsd = positions.filter((p) => p.category === "SPECULATIVE").reduce((s, p) => s + p.valueUsd, 0);

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      {/* Crystal accent */}
      <div className="pointer-events-none absolute -right-6 -top-6 hidden h-44 w-44 opacity-90 sm:block">
        <Image src={labCrystal} alt="" width={176} height={176} className="h-full w-full object-contain drop-shadow-[0_18px_40px_rgba(124,58,237,0.25)]" priority />
      </div>
      <div className="pointer-events-none absolute -right-24 top-12 h-56 w-56 rounded-full bg-violet-300/30 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase leading-none text-violet-600 tracking-[0.2em]">
            <span className="font-semibold lowercase tracking-tight" style={{ fontFamily: "Urbanist, ui-sans-serif, system-ui", letterSpacing: 0 }}>dreyv</span>
            <span className="font-black tracking-[0.22em]">LAB</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="font-mono text-[11px] tracking-tight text-zinc-600">
              {address.slice(0, 6)}…{address.slice(-6)}
            </span>
            <button onClick={onClear} className="text-[11px] text-zinc-400 underline-offset-2 hover:text-zinc-900 hover:underline">
              change
            </button>
          </div>
        </div>
      </div>

      <div className="relative mt-6 grid items-center gap-6 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Portfolio value</div>
          <div className="mt-2"><Numeric value={totalUsd} prefix="$" size="2xl" /></div>
          <div className="mt-4 flex flex-wrap gap-4 text-[11px]">
            <CatChip label="Idle" valueUsd={idleUsd} totalUsd={totalUsd} tone="zinc" />
            <CatChip label="Yield" valueUsd={yieldUsd} totalUsd={totalUsd} tone="violet" />
            <CatChip label="Speculative" valueUsd={specUsd} totalUsd={totalUsd} tone="amber" />
          </div>
        </div>

        {totalUsd > 0 && (
          <div className="flex items-center gap-5">
            <RadialDonut
              segments={segments}
              centerLabel={`${positions.length} assets`}
              centerValue={top[0]?.symbol}
            />
            <div className="hidden flex-col gap-1.5 sm:flex">
              {segments.slice(0, 6).map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-[11px]">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  <span className="min-w-[44px] font-medium text-zinc-700">{s.label}</span>
                  <span className="font-mono tabular-nums text-zinc-500">{((s.value / totalUsd) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function CatChip({ label, valueUsd, totalUsd, tone }: { label: string; valueUsd: number; totalUsd: number; tone: "zinc" | "violet" | "amber" }) {
  const pct = totalUsd > 0 ? (valueUsd / totalUsd) * 100 : 0;
  const tones = {
    zinc: "bg-zinc-50 text-zinc-700 ring-zinc-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
  } as const;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 ring-1 ${tones[tone]}`}>
      <span className="font-medium">{label}</span>
      <span className="font-mono tabular-nums">{pct.toFixed(1)}%</span>
      <span className="font-mono tabular-nums text-[10px] opacity-70">{formatUsd(valueUsd)}</span>
    </span>
  );
}

// ─── Mode panels ────────────────────────────────────────────────────

function HindsightPanel({ address }: { address: string }) {
  const [data, setData] = useState<null | {
    positions: LabPosition[];
    totalUsd: number;
    missed: LabMissedRotation[];
    totalOppCostUsd: number;
    windowDays: 30 | 90 | 365;
  }>(null);
  const [windowDays, setWindowDays] = useState<30 | 90 | 365>(90);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    setErr(null);
    fetch(`/api/lab/hindsight?address=${address}&window=${windowDays}`)
      .then((r) => r.json())
      .then((j) => { if (!live) return; if (j.error) setErr(j.error); else setData(j); })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [address, windowDays]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Opportunity cost · last {windowDays}d</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={200} /> :
                <Numeric
                  value={data ? data.totalOppCostUsd : 0}
                  prefix={data && data.totalOppCostUsd >= 0 ? "+$" : "−$"}
                  size="2xl"
                  tone={data && data.totalOppCostUsd >= 0 ? "violet" : "muted"}
                />}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              {data ? "If you'd held the best alternative at the same size." : "Resolving holdings + price history…"}
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-1">
            {([30, 90, 365] as const).map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${windowDays === d ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </Card>

      {err && <ErrorBanner message={err} />}

      {data && data.missed.length === 0 && !busy && (
        <Card className="p-5 text-center">
          <Check className="mx-auto h-6 w-6 text-emerald-600" />
          <div className="mt-3 text-sm text-zinc-700">No regret. Your composition outperformed the alternatives we tracked.</div>
        </Card>
      )}

      {data && data.missed.length > 0 && (
        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="text-sm font-medium text-zinc-900">Missed rotations, ranked</div>
            <div className="text-xs text-zinc-400">Realized USD cost over {windowDays}d</div>
          </div>
          <div className="divide-y divide-zinc-100">
            {data.missed.slice(0, 6).map((m, i) => (
              <RotationRow key={i} rotation={m} highlight={`+$${m.realizedOppCostUsd.toFixed(2)}`} highlightLabel="missed" />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ForesightPanel({ address }: { address: string }) {
  const [data, setData] = useState<null | { rotations: LabRotation[]; positions: LabPosition[]; totalUsd: number }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    fetch(`/api/lab/foresight?address=${address}`)
      .then((r) => r.json())
      .then((j) => { if (!live) return; if (j.error) setErr(j.error); else setData(j); })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [address]);

  const totalDelta = data?.rotations.reduce((s, r) => s + r.projectedDeltaUsd, 0) ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Projected 90-day gain · risk-adjusted</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={200} /> :
                <Numeric value={totalDelta} prefix="+$" size="2xl" tone={totalDelta > 0 ? "violet" : "muted"} />}
            </div>
            <div className="mt-2 text-sm text-zinc-500">Sum of top-ranked rotations net of 30 bps swap cost.</div>
          </div>
          {data && data.rotations.length > 0 && (
            <div className="w-full max-w-[420px]">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400">Risk · Return surface</div>
              <RiskReturnScatter rotations={data.rotations} />
            </div>
          )}
        </div>
      </Card>

      {err && <ErrorBanner message={err} />}

      {data && data.rotations.length === 0 && !busy && (
        <Card className="p-5 text-center text-sm text-zinc-600">
          No qualifying rotations. Your composition already captures the best risk-adjusted yield we can see.
        </Card>
      )}

      {data && data.rotations.length > 0 && (
        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="text-sm font-medium text-zinc-900">Suggested rotations</div>
            <div className="text-xs text-zinc-400">Ranked by risk-adjusted score</div>
          </div>
          <div className="divide-y divide-zinc-100">
            {data.rotations.map((r, i) => (
              <RotationRow key={i} rotation={r} highlight={`+$${r.projectedDeltaUsd.toFixed(2)}`} highlightLabel="/ 90d" />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function RotationRow({ rotation, highlight, highlightLabel }: { rotation: LabRotation; highlight: string; highlightLabel: string }) {
  const apyDelta = rotation.to.apy - rotation.from.currentApy;
  return (
    <div className="group grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 px-1 py-4 transition">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400">From</div>
        <div className="mt-1 truncate text-sm font-medium text-zinc-900">{rotation.from.symbol}</div>
        <div className="text-[11px] text-zinc-500">
          <span className="font-mono tabular-nums">${rotation.from.valueUsd.toFixed(2)}</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono tabular-nums">{rotation.from.currentApy.toFixed(2)}%</span>
        </div>
      </div>
      <div className="flex flex-col items-center">
        <ArrowUpRight className="h-4 w-4 text-zinc-300 transition group-hover:text-violet-600" />
        <span className="mt-0.5 font-mono text-[10px] tabular-nums text-violet-600">+{apyDelta.toFixed(2)}%</span>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Into</div>
        <div className="mt-1 truncate text-sm font-medium text-zinc-900">
          {rotation.to.symbol} <span className="text-zinc-400">· {rotation.to.protocol}</span>
        </div>
        <div className="text-[11px] text-zinc-500">
          <span className="font-mono tabular-nums text-violet-600">{rotation.to.apy.toFixed(2)}%</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono tabular-nums">vol {(rotation.vol * 100).toFixed(0)}%</span>
          <span className="mx-1.5">·</span>
          <span>exit ~{rotation.liquidityExitHours}h</span>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular-nums text-emerald-600">{highlight}</div>
        <div className="mt-0.5 text-[10px] text-zinc-400">{highlightLabel} · break-even {rotation.breakEvenDays}d</div>
      </div>
    </div>
  );
}

const STRESS_SCENARIOS = [
  { key: "sol_crash", label: "SOL −40%" },
  { key: "sol_crash_deep", label: "SOL −60%" },
  { key: "usdc_depeg", label: "USDC depeg" },
  { key: "lst_slashing", label: "LST slashing" },
  { key: "lst_liquidity_drain", label: "Liquidity drain" },
  { key: "validator_outage", label: "Validator outage" },
];

function StressPanel({ address }: { address: string }) {
  const [scenario, setScenario] = useState<string>("sol_crash");
  const [data, setData] = useState<null | { result: LabStressResult; totalUsd: number }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    fetch(`/api/lab/stress?address=${address}&scenario=${scenario}`)
      .then((r) => r.json())
      .then((j) => { if (!live) return; if (j.error) setErr(j.error); else setData(j); })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [address, scenario]);

  const waterfallItems = useMemo(() => {
    if (!data) return [];
    return data.result.perAsset
      .slice()
      .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd))
      .slice(0, 8)
      .map((p) => ({ label: p.symbol, delta: p.deltaUsd, before: p.beforeUsd }));
  }, [data]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {STRESS_SCENARIOS.map((s) => (
            <button
              key={s.key}
              onClick={() => setScenario(s.key)}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition ${scenario === s.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700 hover:border-zinc-400"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Drawdown</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={140} /> :
                <Numeric value={data ? (data.result.drawdownPct * 100).toFixed(2) : "0.00"} suffix="%" size="xl" tone={data && data.result.drawdownPct < 0 ? "negative" : "ink"} />}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Loss</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={160} /> :
                <Numeric value={data ? Math.abs(data.result.totalLossUsd) : 0} prefix={data && data.result.totalLossUsd < 0 ? "−$" : "$"} size="xl" tone={data && data.result.totalLossUsd < 0 ? "negative" : "ink"} />}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Recovery (at +10%/yr)</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={120} /> :
                <Numeric value={data ? data.result.recoveryDays : 0} suffix="d" size="xl" />}
            </div>
          </div>
        </div>
      </Card>

      {err && <ErrorBanner message={err} />}

      {data && waterfallItems.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-sm font-medium text-zinc-900">Cascade · per-asset impact</div>
            <div className="text-[11px] text-zinc-400">Cumulative path from start to stressed end</div>
          </div>
          <WaterfallChart items={waterfallItems} />
        </Card>
      )}

      {data && (
        <Card className="p-5">
          <div className="mb-3 text-sm font-medium text-zinc-900">Hardening</div>
          {data.result.hardening.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-5 text-sm text-emerald-800">
              Resilient to this scenario. No structural changes recommended.
            </div>
          ) : (
            <div className="space-y-3">
              {data.result.hardening.map((h) => {
                const sev = h.severity;
                const tone = sev === "critical" ? "text-rose-500" : sev === "warn" ? "text-amber-500" : "text-violet-500";
                return (
                  <div key={h.id} className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
                    <DreyvStar className={`mt-0.5 shrink-0 ${tone}`} size={14} />
                    <div>
                      <div className="text-sm font-medium text-zinc-900">{h.title}</div>
                      <div className="mt-1 text-[13px] leading-relaxed text-zinc-600">{h.rationale}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function PlaybooksPanel({ address }: { address: string }) {
  const [list, setList] = useState<LabPlaybook[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<LabBacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lab/playbooks").then((r) => r.json()).then((j) => setList(j.playbooks || []));
  }, []);

  const runBacktest = useCallback((id: string) => {
    setSelected(id);
    setBusy(true);
    setErr(null);
    setBacktest(null);
    fetch(`/api/lab/playbooks/backtest?address=${address}&id=${id}`)
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setBacktest(j.result); })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, [address]);

  const sel = list.find((p) => p.id === selected);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((pb) => (
          <button
            key={pb.id}
            onClick={() => runBacktest(pb.id)}
            className={`group rounded-3xl border bg-white p-5 text-left transition ${selected === pb.id ? "border-violet-400 shadow-[0_0_0_4px_rgba(124,58,237,0.10)]" : "border-zinc-200 hover:border-zinc-400"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-violet-600">
                  <DreyvStar size={9} />
                  <span>{pb.riskTier} risk</span>
                </div>
                <div className="mt-2 text-lg font-medium text-zinc-900">{pb.name}</div>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-900" />
            </div>
            <div className="mt-2 text-sm text-zinc-600">{pb.tagline}</div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {pb.nodes.map((n, i) => (
                <span key={i} className="rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
                  {n.type.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {sel && (
          <motion.div
            key={sel.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          >
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">365-day backtest · {sel.name}</div>
                  <div className="mt-2 max-w-xl text-sm text-zinc-600">{sel.thesis}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">vs hold-baseline</div>
                  <div className="mt-2">
                    {busy || !backtest ? <Skeleton h={42} w={120} /> :
                      <Numeric value={formatPct(backtest.deltaPct)} size="lg" tone={backtest.deltaPct >= 0 ? "positive" : "negative"} />}
                  </div>
                  {backtest && (
                    <div className="font-mono text-[11px] tabular-nums text-zinc-500">
                      {formatUsd(backtest.deltaUsd)}
                    </div>
                  )}
                </div>
              </div>
              {err && <div className="mt-6"><ErrorBanner message={err} /></div>}
              {busy && !backtest && <div className="mt-8 h-64 animate-pulse rounded-2xl bg-zinc-50" />}
              {backtest && backtest.series.length > 1 && (
                <div className="mt-6">
                  <DeltaArea
                    playbook={backtest.series.map((s) => s.playbook)}
                    baseline={backtest.series.map((s) => s.baseline)}
                  />
                  <div className="mt-6 grid gap-6 sm:grid-cols-3">
                    <Stat label="End · playbook" value={formatUsd(backtest.endUsdPlaybook)} />
                    <Stat label="End · baseline" value={formatUsd(backtest.endUsdBaseline)} />
                    <Stat label="Max drawdown" value={`${(backtest.maxDrawdownPct * 100).toFixed(2)}%`} />
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">{label}</div>
      <div className="mt-1.5 font-mono text-xl tabular-nums text-zinc-900">{value}</div>
    </div>
  );
}

function Skeleton({ h, w }: { h: number; w: number }) {
  return <div className="animate-pulse rounded bg-zinc-100" style={{ height: h, width: w }} />;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200/70 bg-rose-50/50 p-5">
      <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
      <div className="text-sm text-rose-900">{message}</div>
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────────────

export function StrategyLabClient() {
  const [address, setAddress] = useState("");
  const [resolved, setResolved] = useState(false);
  const [positions, setPositions] = useState<LabPosition[]>([]);
  const [totalUsd, setTotalUsd] = useState(0);
  const [mode, setMode] = useState<Mode>("foresight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const onResolve = useCallback(async (addr: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/lab/positions?address=${addr}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Resolution failed");
      setPositions(j.positions || []);
      setTotalUsd(j.totalUsd || 0);
      setAddress(addr);
      setResolved(true);
      setTimeout(() => headerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = () => { setResolved(false); setPositions([]); setTotalUsd(0); setAddress(""); };

  return (
    <div
      className="-m-4 sm:-m-6 lg:-m-8 min-h-full bg-white text-zinc-900"
      style={{
        backgroundImage:
          "radial-gradient(700px 360px at 50% -10%, rgba(124,58,237,0.06), transparent 60%), radial-gradient(560px 280px at 110% 10%, rgba(167,139,250,0.05), transparent 60%)",
      }}
    >
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6">
        {!resolved ? (
          <>
            <AddressGate onResolve={onResolve} address={address} busy={busy} />
            {err && <div className="mx-auto mt-6 max-w-2xl"><ErrorBanner message={err} /></div>}
          </>
        ) : (
          <div ref={headerRef} className="space-y-5">
            <HeroHeader address={address} positions={positions} totalUsd={totalUsd} onClear={clear} />

            <ModeDock mode={mode} onChange={setMode} />

            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
              >
                {mode === "hindsight" && <HindsightPanel address={address} />}
                {mode === "foresight" && <ForesightPanel address={address} />}
                {mode === "stress" && <StressPanel address={address} />}
                {mode === "playbooks" && <PlaybooksPanel address={address} />}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

export default StrategyLabClient;
