"use client";

/**
 * TreasuryPulseCarousel — the dynamic right-rail on /app.
 *
 * Brand-strict: solid violet only, NO gradients, NO emerald/rose accents
 * for state, NO dot bullets (DreyvStar instead). Each card is a bespoke
 * composition (sparkline ribbon, radial gauge, allocation arcs, agent
 * pulse waveform, narrative wedge) — not a generic "stat card".
 *
 * Cards rotate every 7s, pause on hover, swipe-able dot/arrow nav.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useVault } from "@/lib/contexts/VaultContext";
import { useTreasuryTrend } from "@/lib/hooks/useTreasuryTrend";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { AppEventBus } from "@/lib/events";
import { TokenLogo } from "@/components/commandbar/TokenLogo";
import { DreyvStar } from "@/components/studio/DreyvStar";

type CardKind = "trend" | "mover" | "agents" | "risk" | "insight";

interface PulseCard {
  kind: CardKind;
  eyebrow: string;
  render: () => React.ReactNode;
}

const ROTATE_MS = 7500;

export function TreasuryPulseCarousel() {
  const { vaultTokens, vaultValue, activeVault } = useVault();
  const trend = useTreasuryTrend("7d");
  const { blocks } = useCanvas();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [direction, setDirection] = useState(1);

  const tokens = useMemo(
    () => (vaultTokens ?? []).filter((t: any) => (t?.value ?? 0) > 0),
    [vaultTokens],
  );
  const topMover = useMemo(() => {
    if (tokens.length === 0) return null;
    return [...tokens].sort(
      (a: any, b: any) => Math.abs(b?.change24h ?? 0) - Math.abs(a?.change24h ?? 0),
    )[0];
  }, [tokens]);
  const topHolding = useMemo(() => {
    if (tokens.length === 0 || !vaultValue || vaultValue <= 0) return null;
    const top = [...tokens].sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))[0];
    return { token: top, share: ((top.value ?? 0) / vaultValue) * 100 };
  }, [tokens, vaultValue]);
  const recentAgentBlocks = useMemo(
    () =>
      blocks.filter(
        (b) =>
          b.source === "agent" || b.source === "commandbar" || b.type === "plan" || b.type === "capability-result",
      ).length,
    [blocks],
  );

  const insightSet = useMemo(() => buildInsights({ tokens, topHolding, topMover }), [tokens, topHolding, topMover]);

  const cards: PulseCard[] = useMemo(() => {
    const list: PulseCard[] = [];
    list.push({
      kind: "trend",
      eyebrow: "Pulse · 7 days",
      render: () => (
        <TrendRibbonCard
          values={trend.series.length > 0 ? trend.series : [100, 100, 100, 100, 100]}
          changePct={trend.changePct}
          totalValue={vaultValue ?? null}
        />
      ),
    });
    if (topMover) {
      list.push({
        kind: "mover",
        eyebrow: "Top mover · 24h",
        render: () => <MoverCard token={topMover as any} />,
      });
    }
    if (topHolding && topHolding.share > 0) {
      list.push({
        kind: "risk",
        eyebrow: "Concentration",
        render: () => (
          <RiskGaugeCard
            symbol={topHolding.token.symbol}
            mint={(topHolding.token as any)?.mint ?? (topHolding.token as any)?.address}
            share={topHolding.share}
          />
        ),
      });
    }
    list.push({
      kind: "agents",
      eyebrow: "Agent pulse",
      render: () => <AgentsCard count={recentAgentBlocks} hasVault={!!activeVault} />,
    });
    if (insightSet.length > 0) {
      list.push({
        kind: "insight",
        eyebrow: "For your treasury",
        render: () => <InsightCard insights={insightSet} />,
      });
    }
    return list;
  }, [trend.series, trend.changePct, vaultValue, topMover, topHolding, recentAgentBlocks, activeVault, insightSet]);

  useEffect(() => {
    if (index >= cards.length) setIndex(0);
  }, [cards.length, index]);

  useEffect(() => {
    if (paused || cards.length <= 1) return;
    const id = window.setInterval(() => {
      setDirection(1);
      setIndex((i) => (i + 1) % cards.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, cards.length]);

  const current = cards[index] ?? cards[0];

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white">
        {/* Ambient violet wash — flat, no shadow */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-violet-300/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 bottom-[-120px] h-56 w-56 rounded-full bg-violet-200/40 blur-3xl" />

        {/* Eyebrow */}
        <div className="relative flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
            <DreyvStar size={10} />
            <span>{current?.eyebrow}</span>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
            {String(index + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}
          </span>
        </div>

        {/* Body */}
        <div className="relative px-5 pb-5 pt-3 sm:px-6 sm:pb-6">
          <div className="relative min-h-[260px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={current?.kind ?? "empty"}
                custom={direction}
                initial={{ opacity: 0, x: direction > 0 ? 24 : -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction > 0 ? -24 : 24 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              >
                {current?.render()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer nav */}
        {cards.length > 1 && (
          <div className="relative flex items-center justify-between border-t border-violet-100 bg-white/60 px-5 py-3 backdrop-blur">
            <div className="flex items-center gap-1.5">
              {cards.map((c, i) => (
                <button
                  key={c.kind}
                  onClick={() => { setDirection(i > index ? 1 : -1); setIndex(i); }}
                  aria-label={`Show ${c.eyebrow}`}
                  className={`h-1 rounded-full transition-all ${
                    i === index ? "w-7 bg-violet-600" : "w-1.5 bg-violet-200 hover:bg-violet-400"
                  }`}
                />
              ))}
              {!paused && cards.length > 1 && (
                <div className="ml-2 h-1 w-7 overflow-hidden rounded-full bg-violet-50">
                  <motion.div
                    key={`prog-${index}`}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: ROTATE_MS / 1000, ease: "linear" }}
                    className="h-full bg-violet-300"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <NavBtn dir="prev" onClick={() => { setDirection(-1); setIndex((i) => (i - 1 + cards.length) % cards.length); }} />
              <NavBtn dir="next" onClick={() => { setDirection(1); setIndex((i) => (i + 1) % cards.length); }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────── Card: Trend Ribbon ───────────────────────── */

function TrendRibbonCard({
  values,
  changePct,
  totalValue,
}: {
  values: number[];
  changePct: number | null;
  totalValue: number | null;
}) {
  const w = 600;
  const h = 150;
  const padX = 6;
  const padY = 14;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : innerW;

  const pts = values.map((v, i) => ({
    x: padX + i * step,
    y: padY + (1 - (v - min) / range) * innerH,
    v,
  }));

  // Catmull-Rom smoothed path
  const segs: string[] = [`M ${pts[0].x},${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
  }
  const line = segs.join(" ");
  const area = `${line} L ${pts[pts.length - 1].x},${h - 2} L ${pts[0].x},${h - 2} Z`;

  const positive = (changePct ?? 0) >= 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-manrope text-3xl font-semibold tracking-tight text-slate-900 sm:text-[34px]">
            {totalValue == null ? "—" : `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">Composite treasury · 7-day shape</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2.5 py-1">
          <DreyvStar size={9} className="text-violet-600" />
          <span className="text-[11px] font-semibold tabular-nums text-slate-900">
            {positive ? "+" : ""}{(changePct ?? 0).toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="mt-4">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-[150px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pulse-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* grid */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line key={t} x1={padX} x2={w - padX} y1={padY + innerH * t} y2={padY + innerH * t}
              stroke="#ede9fe" strokeWidth={1} strokeDasharray="2 4" />
          ))}
          <motion.path d={area} fill="url(#pulse-fill)"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7 }} />
          <motion.path d={line} fill="none" stroke="#7c3aed" strokeWidth={2.25} strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
          {/* end dot */}
          <motion.circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4}
            fill="#7c3aed" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.0, type: "spring" }} />
          <motion.circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={9}
            fill="#7c3aed" fillOpacity="0.15" initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ delay: 1.1, type: "spring" }} />
        </svg>
      </div>
      <ActionChip
        label="Brief me on the week"
        onRun={() =>
          AppEventBus.emit("AGENT_COMMAND", {
            command: "Give me a 30-second briefing on what changed in my treasury this week",
            autoSubmit: true,
          })
        }
      />
    </div>
  );
}

/* ────────────────────────── Card: Top Mover ──────────────────────────── */

function MoverCard({ token }: { token: any }) {
  const change = Number(token?.change24h ?? 0);
  const positive = change >= 0;
  const symbol = String(token?.symbol ?? "—");
  const mint = (token?.mint ?? token?.address) as string | undefined;
  const value = Number(token?.value ?? 0);

  // Animated bar that visualises magnitude (clamped to 25%).
  const magnitude = Math.min(25, Math.abs(change));
  const pct = (magnitude / 25) * 100;

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <TokenLogo symbol={symbol} mint={mint} size={48} hideFallback />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-violet-600">
            <DreyvStar size={9} className="text-white" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-manrope text-2xl font-semibold tracking-tight text-slate-900">{symbol}</h3>
          <p className="text-xs text-slate-500">Holding worth ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="font-manrope text-4xl font-semibold tabular-nums text-slate-900">
            {positive ? "+" : ""}{change.toFixed(2)}<span className="text-2xl text-slate-400">%</span>
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">24h move</span>
        </div>

        {/* Bidirectional magnitude bar — solid violet only */}
        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-violet-50">
          <div className="flex h-full w-1/2 justify-end">
            {!positive && (
              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-l-full bg-violet-300" />
            )}
          </div>
          <div className="h-full w-px bg-violet-200" />
          <div className="flex h-full w-1/2">
            {positive && (
              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-r-full bg-violet-600" />
            )}
          </div>
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
          <span>−25%</span><span>0</span><span>+25%</span>
        </div>
      </div>

      <ActionChip
        label={positive ? `Trim ${symbol} into stables` : `Hedge ${symbol} downside`}
        onRun={() =>
          AppEventBus.emit("AGENT_COMMAND", {
            command: positive
              ? `Suggest a trim plan for ${symbol} given today's +${change.toFixed(2)}% move`
              : `Propose a hedge or DCA plan for ${symbol} given today's ${change.toFixed(2)}% drawdown`,
            autoSubmit: true,
          })
        }
      />
    </div>
  );
}

/* ────────────────────────── Card: Risk Gauge ─────────────────────────── */

function RiskGaugeCard({ symbol, mint, share }: { symbol: string; mint?: string; share: number }) {
  // Half-donut gauge — angle from -90° (0%) to +90° (100%)
  const r = 70;
  const cx = 90;
  const cy = 90;
  const c = Math.PI * r; // half circumference
  const offset = c * (1 - share / 100);

  const concentrated = share >= 60;

  // Animated digit
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1100, bounce: 0 });
  const display = useTransform(spring, (v) => v.toFixed(1));
  useEffect(() => { mv.set(share); }, [mv, share]);

  return (
    <div>
      <div className="flex items-start gap-4">
        <div className="relative shrink-0" style={{ width: 180, height: 100 }}>
          <svg width="180" height="100" viewBox="0 0 180 100">
            {/* Track */}
            <path
              d={`M 20,90 A ${r} ${r} 0 0 1 160,90`}
              fill="none" stroke="#f5f3ff" strokeWidth={14} strokeLinecap="round"
            />
            {/* Fill */}
            <motion.path
              d={`M 20,90 A ${r} ${r} 0 0 1 160,90`}
              fill="none" stroke="#7c3aed" strokeWidth={14} strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
            />
            {/* Tick at 60% — danger threshold */}
            <line
              x1={cx + Math.cos(Math.PI * (1 - 0.6)) * (r - 11)}
              y1={cy - Math.sin(Math.PI * (1 - 0.6)) * (r - 11)}
              x2={cx + Math.cos(Math.PI * (1 - 0.6)) * (r + 11)}
              y2={cy - Math.sin(Math.PI * (1 - 0.6)) * (r + 11)}
              stroke="#7c3aed" strokeWidth={1.5} strokeLinecap="round"
            />
          </svg>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center pb-1">
            <motion.span className="font-manrope text-2xl font-semibold tabular-nums text-slate-900">
              {display}
            </motion.span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-violet-600">% of treasury</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TokenLogo symbol={symbol} mint={mint} size={22} hideFallback />
            <span className="font-manrope text-lg font-semibold text-slate-900">{symbol}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {concentrated
              ? `${symbol} dominates the treasury. Single-asset exposure is high — a staged rebalance can de-risk without forced selling.`
              : `${symbol} is your largest holding, well within a balanced range.`}
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
            <DreyvStar size={8} />
            {concentrated ? "Concentrated" : "Balanced"}
          </div>
        </div>
      </div>

      <ActionChip
        label="Plan a rebalance"
        onRun={() =>
          AppEventBus.emit("AGENT_COMMAND", {
            command: `Propose a rebalance to bring ${symbol} from ${share.toFixed(0)}% down to a safer concentration`,
            autoSubmit: true,
          })
        }
      />
    </div>
  );
}

/* ────────────────────────── Card: Agent Pulse ────────────────────────── */

function AgentsCard({ count, hasVault }: { count: number; hasVault: boolean }) {
  // Generative waveform — purely decorative, conveys "alive"
  const bars = useMemo(() => Array.from({ length: 22 }, (_, i) => 0.35 + Math.abs(Math.sin(i * 0.9 + count * 0.3)) * 0.65), [count]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-manrope text-5xl font-semibold tabular-nums text-slate-900">
            {count.toString().padStart(2, "0")}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {count === 0 ? "no agent actions yet this session" : count === 1 ? "agent action this session" : "agent actions this session"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2.5 py-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">Live</span>
        </div>
      </div>

      <div className="mt-5 flex h-16 items-end gap-[3px]">
        {bars.map((b, i) => (
          <motion.span
            key={i}
            initial={{ height: 4, opacity: 0.3 }}
            animate={{ height: `${b * 100}%`, opacity: 0.85 }}
            transition={{ duration: 0.6, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 rounded-sm bg-violet-500"
          />
        ))}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-600">
        {hasVault
          ? "Dreyv is watching prices, yields, and risk in the background. Ask for a daily briefing anytime."
          : "Connect a wallet so Dreyv can start watching the moments worth your attention."}
      </p>

      <ActionChip
        label={hasVault ? "Brief me on today" : "Get started"}
        onRun={() =>
          AppEventBus.emit("AGENT_COMMAND", {
            command: hasVault
              ? "Give me a 30-second briefing on what changed in my treasury today"
              : "Walk me through connecting a wallet and setting up my first vault",
            autoSubmit: true,
          })
        }
      />
    </div>
  );
}

/* ────────────────────────── Card: Insight ────────────────────────────── */

function InsightCard({ insights }: { insights: { title: string; detail: string; command: string }[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (insights.length <= 1) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % insights.length), 5500);
    return () => window.clearInterval(id);
  }, [insights.length]);
  const cur = insights[i] ?? insights[0];
  if (!cur) return null;
  return (
    <div>
      <div className="relative rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
        <DreyvStar size={14} className="absolute -left-1.5 -top-1.5 rounded-full bg-white p-0.5 text-violet-600 ring-1 ring-violet-200" />
        <AnimatePresence mode="wait">
          <motion.div
            key={cur.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32 }}
          >
            <h3 className="font-manrope text-lg font-semibold leading-snug tracking-tight text-slate-900">
              {cur.title}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{cur.detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      {insights.length > 1 && (
        <div className="mt-2 flex items-center gap-1">
          {insights.map((_, k) => (
            <span key={k} className={`h-0.5 flex-1 rounded-full ${k === i ? "bg-violet-600" : "bg-violet-100"}`} />
          ))}
        </div>
      )}
      <ActionChip
        label="Ask Dreyv"
        onRun={() => AppEventBus.emit("AGENT_COMMAND", { command: cur.command, autoSubmit: true })}
      />
    </div>
  );
}

/* ────────────────────────── Shared bits ──────────────────────────────── */

function ActionChip({ label, onRun }: { label: string; onRun: () => void }) {
  return (
    <button
      onClick={onRun}
      className="group mt-5 inline-flex w-full items-center justify-between gap-2 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-700 sm:w-auto"
    >
      <span>{label}</span>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 transition-transform group-hover:translate-x-0.5">
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" />
        </svg>
      </span>
    </button>
  );
}

function NavBtn({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous card" : "Next card"}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700 transition-colors hover:border-violet-400 hover:bg-violet-50"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === "prev" ? <path d="M7.5 3 4.5 6l3 3" /> : <path d="M4.5 3 7.5 6l-3 3" />}
      </svg>
    </button>
  );
}

/* ────────────────────────── Insight builder ──────────────────────────── */

function buildInsights({
  tokens,
  topHolding,
  topMover,
}: {
  tokens: any[];
  topHolding: { token: any; share: number } | null;
  topMover: any | null;
}): { title: string; detail: string; command: string }[] {
  const out: { title: string; detail: string; command: string }[] = [];
  const symbols = tokens.map((t: any) => String(t.symbol ?? "")).filter(Boolean);
  const hasSol = symbols.some((s) => s.toUpperCase() === "SOL");
  const hasStables = symbols.some((s) => /USDC|USDT|PYUSD/i.test(s));

  if (hasSol) {
    out.push({
      title: "Your idle SOL could be earning",
      detail: "Liquid staking through Marinade or Jito turns parked SOL into yield without locking it up.",
      command: "Compare LST options for my SOL — Marinade vs Jito vs Sanctum — with current APYs and risks",
    });
  }
  if (hasStables) {
    out.push({
      title: "Stables on the sidelines",
      detail: "Kamino and MarginFi vaults are paying real yield on USDC right now. Want a side-by-side?",
      command: "Show me the safest USDC yield options on Solana with TVL, APY, and audit history",
    });
  }
  if (topHolding && topHolding.share >= 60) {
    out.push({
      title: `${String(topHolding.token.symbol)} is doing the heavy lifting`,
      detail: `It's ${topHolding.share.toFixed(0)}% of the treasury. A staged rebalance could de-risk without a tax hit.`,
      command: `Draft a 4-week staged rebalance plan to lower ${String(topHolding.token.symbol)} concentration`,
    });
  }
  if (topMover && Math.abs(Number(topMover.change24h ?? 0)) >= 8) {
    const ch = Number(topMover.change24h);
    out.push({
      title: `${String(topMover.symbol)} just moved ${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`,
      detail: ch >= 0
        ? "A trim into stables locks in some of the move without exiting the position."
        : "A scaled DCA back in spreads the entry across the next 7 days.",
      command: ch >= 0
        ? `Propose a ${String(topMover.symbol)} trim into USDC — keep most of the upside, lock 20%`
        : `Propose a 7-day DCA back into ${String(topMover.symbol)} from USDC`,
    });
  }
  if (out.length === 0) {
    out.push({
      title: "Tell Dreyv what to watch",
      detail: "Set a price, yield, or balance trigger and Dreyv will surface the moment something matters.",
      command: "Help me set up a watcher — alert me if SOL drops 5% in an hour",
    });
  }
  return out.slice(0, 4);
}
