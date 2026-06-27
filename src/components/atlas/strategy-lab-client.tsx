"use client";

/**
 * Dreyv Lab — Hindsight · Foresight · Stress · Playbooks
 *
 * Design language: "Numbers as monuments."
 *   - Bone-white surfaces, hairline borders, oversized tabular numerics.
 *   - Custom hand-drawn SVG sparklines / bars — no chart library.
 *   - Motion is restrained: cross-fade between modes, no bouncy easings.
 *
 * All data is real (Helius DAS + CoinGecko + our /api/lab/* routes).
 * No fabricated figures, no demo wallets, no fake percentages.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Loader2, X } from "lucide-react";
import type {
  LabPosition,
  LabRotation,
  LabMissedRotation,
  LabStressResult,
  LabPlaybook,
  LabBacktestResult,
} from "@/lib/lab/types";

type Mode = "hindsight" | "foresight" | "stress" | "playbooks";

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "hindsight", label: "Hindsight", hint: "What you missed" },
  { id: "foresight", label: "Foresight", hint: "Where to move" },
  { id: "stress", label: "Stress", hint: "What breaks you" },
  { id: "playbooks", label: "Playbooks", hint: "What to deploy" },
];

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ─── Atomic primitives ──────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl border border-zinc-200/70 bg-white ${className}`}
    >
      {children}
    </div>
  );
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
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  tone?: "ink" | "positive" | "negative" | "muted" | "violet";
}) {
  const sizes = {
    sm: "text-xs",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-4xl",
    "2xl": "text-5xl",
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

function formatUsd(n: number, big = false): string {
  const s = Math.abs(n) >= 1000 ? formatNum(n) : n.toFixed(2);
  return (n < 0 ? "−" : big ? "" : "") + "$" + s.replace(/^−/, "");
}

function formatPct(n: number, digits = 2): string {
  return (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(digits) + "%";
}

// ─── Custom SVG charts ──────────────────────────────────────────────

function Sparkline({ series, width = 320, height = 64, color = "#7c3aed" }: {
  series: Array<[number, number]> | number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const pts: number[] = useMemo(() => {
    if (!series || series.length === 0) return [];
    if (typeof series[0] === "number") return series as number[];
    return (series as Array<[number, number]>).map((p) => p[1]);
  }, [series]);
  if (pts.length < 2) return <div className="h-16 w-full" />;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const dx = width / (pts.length - 1);
  const path = pts
    .map((v, i) => {
      const x = i * dx;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DualSparkline({
  a,
  b,
  height = 220,
  labelA = "Playbook",
  labelB = "Hold baseline",
}: {
  a: number[];
  b: number[];
  height?: number;
  labelA?: string;
  labelB?: string;
}) {
  if (a.length < 2 || b.length < 2) return <div className="h-56 w-full" />;
  const all = [...a, ...b];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const width = 800;
  const dx = width / (a.length - 1);
  const toPath = (arr: number[], color: string) => {
    const d = arr
      .map((v, i) => {
        const x = i * dx;
        const y = height - ((v - min) / range) * (height - 16) - 8;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return { d, color };
  };
  const pa = toPath(a, "#7c3aed");
  const pb = toPath(b, "#a1a1aa");

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={width} y1={height * g} y2={height * g} stroke="#e4e4e7" strokeDasharray="2 6" />
        ))}
        <path d={pb.d} fill="none" stroke={pb.color} strokeWidth="1.25" />
        <path d={pa.d} fill="none" stroke={pa.color} strokeWidth="1.75" />
      </svg>
      <div className="mt-3 flex items-center gap-5 text-xs text-zinc-500">
        <span className="flex items-center gap-2"><span className="h-[2px] w-5 bg-violet-600" />{labelA}</span>
        <span className="flex items-center gap-2"><span className="h-[2px] w-5 bg-zinc-400" />{labelB}</span>
      </div>
    </div>
  );
}

function HorizontalBar({ label, value, max, tone = "violet", suffix = "" }: {
  label: string;
  value: number;
  max: number;
  tone?: "violet" | "rose" | "emerald" | "zinc";
  suffix?: string;
}) {
  const w = Math.max(0, Math.min(1, Math.abs(value) / (max || 1)));
  const colors = {
    violet: "bg-violet-600",
    rose: "bg-rose-500",
    emerald: "bg-emerald-500",
    zinc: "bg-zinc-700",
  };
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 py-2.5">
      <div>
        <div className="mb-1.5 text-sm text-zinc-700">{label}</div>
        <div className="h-[6px] w-full overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${w * 100}%` }} />
        </div>
      </div>
      <div className="font-mono text-sm tabular-nums text-zinc-900">
        {value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}{suffix}
      </div>
    </div>
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
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5 text-[13px] leading-none text-violet-700">
          <span className="font-semibold lowercase tracking-tight" style={{ fontFamily: "Urbanist, ui-sans-serif, system-ui" }}>dreyv</span>
          <span className="font-black uppercase tracking-[0.18em]">LAB</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-medium tracking-tight text-zinc-900 sm:text-3xl">
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
        <div className={`flex items-center gap-2 rounded-2xl border bg-white p-2 transition-all ${valid ? "border-violet-300 shadow-[0_0_0_4px_rgba(124,58,237,0.08)]" : "border-zinc-200"}`}>
          <input
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="Solana address (mainnet)"
            className="flex-1 bg-transparent px-3 py-2 font-mono text-xs tracking-tight text-zinc-900 outline-none placeholder:text-zinc-400"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="submit"
            disabled={!valid || busy}
            className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-30 hover:bg-zinc-800"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Open <ArrowUpRight className="h-4 w-4" /></>}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Mode dock ──────────────────────────────────────────────────────

function ModeDock({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="sticky top-2 z-30 mx-auto w-full max-w-3xl px-4">
      <div className="flex items-center justify-center gap-1 rounded-full border border-zinc-200/80 bg-white/85 p-1 shadow-[0_1px_0_rgba(0,0,0,0.02)] backdrop-blur-xl">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={`relative flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? "text-white" : "text-zinc-600 hover:text-zinc-900"}`}
            >
              {active && (
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
      <div className="mt-2 text-center text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        {MODES.find((m) => m.id === mode)?.hint}
      </div>
    </div>
  );
}

// ─── Composition / portfolio strip ─────────────────────────────────

function CompositionStrip({ positions, totalUsd }: { positions: LabPosition[]; totalUsd: number }) {
  const top = positions.slice(0, 6);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Portfolio value</div>
          <div className="mt-2"><Numeric value={totalUsd} prefix="$" size="2xl" /></div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Positions</div>
          <div className="mt-2"><Numeric value={positions.length} size="lg" /></div>
        </div>
      </div>
      {totalUsd > 0 && (
        <div className="mt-6">
          <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100">
            {top.map((p, i) => {
              const w = (p.valueUsd / totalUsd) * 100;
              const palette = ["#7c3aed", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#f4f1ff"];
              return <div key={p.mint + i} style={{ width: `${w}%`, background: palette[i] }} />;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-zinc-500">
            {top.map((p, i) => {
              const palette = ["#7c3aed", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#f4f1ff"];
              return (
                <span key={p.mint + i} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: palette[i] }} />
                  <span className="font-medium text-zinc-700">{p.symbol}</span>
                  <span className="font-mono tabular-nums">{((p.valueUsd / totalUsd) * 100).toFixed(1)}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </Card>
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
      .then((j) => {
        if (!live) return;
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [address, windowDays]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Opportunity cost · last {windowDays}d</div>
            <div className="mt-3">
              {busy ? (
                <div className="h-16 w-48 animate-pulse rounded bg-zinc-100" />
              ) : (
                <Numeric
                  value={data ? data.totalOppCostUsd : 0}
                  prefix={data && data.totalOppCostUsd >= 0 ? "+$" : "−$"}
                  size="2xl"
                  tone={data && data.totalOppCostUsd >= 0 ? "violet" : "muted"}
                />
              )}
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
        <Card className="p-4">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="text-sm font-medium text-zinc-900">Missed rotations, ranked</div>
            <div className="text-xs text-zinc-400">Realized USD cost over {windowDays}d</div>
          </div>
          <div className="space-y-1">
            {data.missed.slice(0, 6).map((m, i) => (
              <RotationRow key={i} rotation={m} highlight={`+$${m.realizedOppCostUsd.toFixed(2)} missed`} />
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
        <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Projected 90-day gain · risk-adjusted</div>
        <div className="mt-3">
          {busy ? <div className="h-16 w-48 animate-pulse rounded bg-zinc-100" /> :
            <Numeric value={totalDelta} prefix="+$" size="2xl" tone={totalDelta > 0 ? "violet" : "muted"} />}
        </div>
        <div className="mt-2 text-sm text-zinc-500">Sum of top-ranked rotations net of 30 bps swap cost.</div>
      </Card>

      {err && <ErrorBanner message={err} />}

      {data && data.rotations.length === 0 && !busy && (
        <Card className="p-5 text-center text-sm text-zinc-600">
          No qualifying rotations. Your composition already captures the best risk-adjusted yield we can see.
        </Card>
      )}

      {data && data.rotations.length > 0 && (
        <Card className="p-4">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="text-sm font-medium text-zinc-900">Suggested rotations</div>
            <div className="text-xs text-zinc-400">Ranked by risk-adjusted score</div>
          </div>
          <div className="space-y-1">
            {data.rotations.map((r, i) => (
              <RotationRow key={i} rotation={r} highlight={`+$${r.projectedDeltaUsd.toFixed(2)} / 90d`} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function RotationRow({ rotation, highlight }: { rotation: LabRotation; highlight: string }) {
  return (
    <div className="group grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 rounded-2xl px-4 py-4 transition hover:bg-zinc-50">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400">From</div>
        <div className="mt-1 truncate text-sm font-medium text-zinc-900">{rotation.from.symbol}</div>
        <div className="text-xs text-zinc-500">
          <span className="font-mono tabular-nums">${rotation.from.valueUsd.toFixed(2)}</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono tabular-nums">{rotation.from.currentApy.toFixed(2)}%</span>
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 text-zinc-300 transition group-hover:text-violet-600" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400">Into</div>
        <div className="mt-1 truncate text-sm font-medium text-zinc-900">
          {rotation.to.symbol} <span className="text-zinc-400">· {rotation.to.protocol}</span>
        </div>
        <div className="text-xs text-zinc-500">
          <span className="font-mono tabular-nums text-violet-600">{rotation.to.apy.toFixed(2)}%</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono tabular-nums">vol {(rotation.vol * 100).toFixed(0)}%</span>
          <span className="mx-1.5">·</span>
          <span>exit ~{rotation.liquidityExitHours}h</span>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular-nums text-emerald-600">{highlight}</div>
        <div className="mt-0.5 text-[11px] text-zinc-400">break-even {rotation.breakEvenDays}d</div>
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

  const maxLoss = data ? Math.max(...data.result.perAsset.map((p) => Math.abs(p.deltaUsd)), 1) : 1;

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
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Drawdown</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={140} /> :
                <Numeric value={data ? (data.result.drawdownPct * 100).toFixed(2) : "0.00"} suffix="%" size="xl" tone={data && data.result.drawdownPct < 0 ? "negative" : "ink"} />}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Loss</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={160} /> :
                <Numeric value={data ? data.result.totalLossUsd : 0} prefix={data && data.result.totalLossUsd < 0 ? "−$" : "$"} size="xl" tone={data && data.result.totalLossUsd < 0 ? "negative" : "ink"} />}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">Recovery (at +10%/yr)</div>
            <div className="mt-3">
              {busy ? <Skeleton h={56} w={120} /> :
                <Numeric value={data ? data.result.recoveryDays : 0} suffix="d" size="xl" />}
            </div>
          </div>
        </div>
      </Card>

      {err && <ErrorBanner message={err} />}

      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-4 text-sm font-medium text-zinc-900">Per-asset impact</div>
            <div>
              {data.result.perAsset.map((p) => (
                <HorizontalBar
                  key={p.mint}
                  label={`${p.symbol} · ${formatUsd(p.beforeUsd)} → ${formatUsd(p.afterUsd)}`}
                  value={p.deltaUsd}
                  max={maxLoss}
                  tone={p.deltaUsd < 0 ? "rose" : "emerald"}
                />
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-4 text-sm font-medium text-zinc-900">Hardening</div>
            {data.result.hardening.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-5 text-sm text-emerald-800">
                Resilient to this scenario. No structural changes recommended.
              </div>
            ) : (
              <div className="space-y-3">
                {data.result.hardening.map((h) => (
                  <div key={h.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-2 w-2 rounded-full ${h.severity === "critical" ? "bg-rose-500" : h.severity === "warn" ? "bg-amber-500" : "bg-violet-500"}`} />
                      <div>
                        <div className="text-sm font-medium text-zinc-900">{h.title}</div>
                        <div className="mt-1 text-[13px] leading-relaxed text-zinc-600">{h.rationale}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
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
            className={`group rounded-3xl border bg-white p-4 text-left transition ${selected === pb.id ? "border-zinc-900 shadow-[0_0_0_3px_rgba(124,58,237,0.10)]" : "border-zinc-200 hover:border-zinc-400"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-violet-600">{pb.riskTier} risk</div>
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
                  <div className="text-xs uppercase tracking-[0.16em] text-zinc-400">365-day backtest · {sel.name}</div>
                  <div className="mt-2 text-sm text-zinc-600">{sel.thesis}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">vs hold-baseline</div>
                  <div className="mt-2">
                    {busy || !backtest ? <Skeleton h={48} w={140} /> :
                      <Numeric value={backtest.deltaPct} prefix="" suffix="" size="lg" tone={backtest.deltaPct >= 0 ? "positive" : "negative"} />}
                  </div>
                  {backtest && (
                    <div className="font-mono text-xs tabular-nums text-zinc-500">
                      {formatPct(backtest.deltaPct)} · {formatUsd(backtest.deltaUsd)}
                    </div>
                  )}
                </div>
              </div>
              {err && <div className="mt-6"><ErrorBanner message={err} /></div>}
              {busy && !backtest && <div className="mt-8 h-56 animate-pulse rounded-2xl bg-zinc-50" />}
              {backtest && backtest.series.length > 1 && (
                <div className="mt-8">
                  <DualSparkline
                    a={backtest.series.map((s) => s.playbook)}
                    b={backtest.series.map((s) => s.baseline)}
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
      <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">{label}</div>
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
      <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 sm:px-6">
        {!resolved ? (
          <>
            <AddressGate onResolve={onResolve} address={address} busy={busy} />
            {err && <div className="mx-auto mt-6 max-w-2xl"><ErrorBanner message={err} /></div>}
          </>
        ) : (
          <div className="space-y-5">
            <div ref={headerRef} className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-violet-600">Dreyv Lab</div>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="font-mono text-xs tracking-tight text-zinc-700">
                    {address.slice(0, 6)}…{address.slice(-6)}
                  </span>
                  <button onClick={clear} className="text-[11px] text-zinc-400 underline-offset-2 hover:text-zinc-900 hover:underline">
                    change
                  </button>
                </div>
              </div>
            </div>

            <CompositionStrip positions={positions} totalUsd={totalUsd} />

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
