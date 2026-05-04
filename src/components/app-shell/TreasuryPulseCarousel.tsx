"use client";

/**
 * TreasuryPulseCarousel — replaces the static "Treasury trend · 7d" chart
 * with a rotating set of dynamic, treasury-aware cards. Each card pulls from
 * live data already in scope (vault holdings, trend series, canvas activity)
 * and is interactive: clicking the action chip dispatches AGENT_COMMAND so
 * Dreyv runs the relevant capability.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendCurve } from "./Composition";
import { useVault } from "@/lib/contexts/VaultContext";
import { useTreasuryTrend } from "@/lib/hooks/useTreasuryTrend";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { AppEventBus } from "@/lib/events";
import { TokenLogo } from "@/components/commandbar/TokenLogo";

type CardKind = "trend" | "mover" | "agents" | "risk" | "insight";

interface PulseCard {
  kind: CardKind;
  eyebrow: string;
  render: () => React.ReactNode;
}

const ROTATE_MS = 7000;

export function TreasuryPulseCarousel() {
  const { vaultTokens, vaultValue, activeVault } = useVault();
  const trend = useTreasuryTrend("7d");
  const { blocks } = useCanvas();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // ── Derived signals ──────────────────────────────────────────────────────
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

  // ── Card definitions ─────────────────────────────────────────────────────
  const cards: PulseCard[] = useMemo(() => {
    const list: PulseCard[] = [];

    // 1. Trend (always present)
    list.push({
      kind: "trend",
      eyebrow: "Pulse · 7d",
      render: () => (
        <TrendCurve
          values={trend.series.length > 0 ? trend.series : [100, 100, 100, 100, 100]}
          label="Treasury trend · 7d"
          changePct={trend.changePct}
        />
      ),
    });

    // 2. Top mover
    if (topMover) {
      list.push({
        kind: "mover",
        eyebrow: "Top mover · 24h",
        render: () => <MoverCard token={topMover} />,
      });
    }

    // 3. Risk / concentration
    if (topHolding && topHolding.share > 0) {
      list.push({
        kind: "risk",
        eyebrow: "Concentration",
        render: () => <RiskCard symbol={topHolding.token.symbol} share={topHolding.share} />,
      });
    }

    // 4. Agent activity
    list.push({
      kind: "agents",
      eyebrow: "Agent activity",
      render: () => <AgentsCard count={recentAgentBlocks} hasVault={!!activeVault} />,
    });

    // 5. Personalized insight
    if (insightSet.length > 0) {
      list.push({
        kind: "insight",
        eyebrow: "For your treasury",
        render: () => <InsightCard insights={insightSet} />,
      });
    }

    return list;
  }, [trend.series, trend.changePct, topMover, topHolding, recentAgentBlocks, activeVault, insightSet]);

  // Keep index in range as cards array changes.
  useEffect(() => {
    if (index >= cards.length) setIndex(0);
  }, [cards.length, index]);

  // Auto-rotate.
  useEffect(() => {
    if (paused || cards.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % cards.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, cards.length]);

  const current = cards[index] ?? cards[0];

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={current?.kind ?? "empty"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {current?.render()}
        </motion.div>
      </AnimatePresence>

      {/* Dots + arrows */}
      {cards.length > 1 && (
        <div className="mt-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            {cards.map((c, i) => (
              <button
                key={c.kind}
                onClick={() => setIndex(i)}
                aria-label={`Show ${c.eyebrow}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-violet-600" : "w-1.5 bg-violet-200 hover:bg-violet-400"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <NavBtn dir="prev" onClick={() => setIndex((i) => (i - 1 + cards.length) % cards.length)} />
            <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {current?.eyebrow}
            </span>
            <NavBtn dir="next" onClick={() => setIndex((i) => (i + 1) % cards.length)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-cards ──────────────────────────────────────────────────────────────

function CardShell({ children, accent = "violet" }: { children: React.ReactNode; accent?: "violet" | "rose" | "emerald" }) {
  const tone =
    accent === "rose"
      ? "from-rose-50 to-white border-rose-200"
      : accent === "emerald"
        ? "from-emerald-50 to-white border-emerald-200"
        : "from-violet-50 to-white border-violet-200";
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${tone} p-6 shadow-[0_18px_40px_-30px_rgba(124,58,237,0.4)]`}>
      {children}
    </div>
  );
}

function MoverCard({ token }: { token: any }) {
  const change = Number(token?.change24h ?? 0);
  const positive = change >= 0;
  const symbol = String(token?.symbol ?? "—");
  const value = Number(token?.value ?? 0);
  return (
    <CardShell accent={positive ? "emerald" : "rose"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top mover · 24h</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="font-manrope text-3xl font-semibold tracking-tight text-slate-900">{symbol}</h3>
        <span className={`font-manrope text-2xl font-semibold ${positive ? "text-emerald-600" : "text-rose-600"}`}>
          {positive ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Holding worth ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </p>
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
    </CardShell>
  );
}

function RiskCard({ symbol, share }: { symbol: string; share: number }) {
  const concentrated = share >= 60;
  return (
    <CardShell accent={concentrated ? "rose" : "violet"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Concentration</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="font-manrope text-3xl font-semibold tracking-tight text-slate-900">{symbol}</h3>
        <span className="font-manrope text-2xl font-semibold text-slate-900">{share.toFixed(1)}%</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {concentrated
          ? `${symbol} dominates the treasury — single-asset exposure is high.`
          : `${symbol} is your largest holding — well within a balanced range.`}
      </p>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${concentrated ? "bg-rose-500" : "bg-violet-600"}`}
          style={{ width: `${Math.min(100, share)}%` }}
        />
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
    </CardShell>
  );
}

function AgentsCard({ count, hasVault }: { count: number; hasVault: boolean }) {
  return (
    <CardShell>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Agent activity</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="font-manrope text-3xl font-semibold tracking-tight text-slate-900">{count}</h3>
        <span className="text-xs text-slate-500">
          {count === 0 ? "no actions yet" : count === 1 ? "action this session" : "actions this session"}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
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
    </CardShell>
  );
}

function InsightCard({ insights }: { insights: { title: string; detail: string; command: string }[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (insights.length <= 1) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % insights.length), 4500);
    return () => window.clearInterval(id);
  }, [insights.length]);
  const cur = insights[i] ?? insights[0];
  if (!cur) return null;
  return (
    <CardShell>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">For your treasury</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={cur.title}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28 }}
        >
          <h3 className="mt-2 font-manrope text-xl font-semibold leading-snug tracking-tight text-slate-900">
            {cur.title}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{cur.detail}</p>
        </motion.div>
      </AnimatePresence>
      <ActionChip
        label="Ask Dreyv"
        onRun={() => AppEventBus.emit("AGENT_COMMAND", { command: cur.command, autoSubmit: true })}
      />
    </CardShell>
  );
}

function ActionChip({ label, onRun }: { label: string; onRun: () => void }) {
  return (
    <button
      onClick={onRun}
      className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
    >
      {label}
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" />
      </svg>
    </button>
  );
}

function NavBtn({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous card" : "Next card"}
      className="flex h-6 w-6 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700 transition-colors hover:border-violet-400 hover:text-violet-900"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === "prev" ? <path d="M7.5 3 4.5 6l3 3" /> : <path d="M4.5 3 7.5 6l-3 3" />}
      </svg>
    </button>
  );
}

// ── Personalized insight builder ──────────────────────────────────────────

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
