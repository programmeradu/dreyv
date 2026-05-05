"use client";

/**
 * MoneyMovementLedger
 * ───────────────────
 * Replacement for the old PnL waterfall ("Where the money moved").
 *
 * Diverging waterfall + cumulative net line + crosshair + biggest-movers rail.
 * If the wallet has no tagged treasury events yet, we synthesize a *provisional*
 * ledger from snapshot deltas (the wallet's own value history) so the card is
 * never empty as long as we have at least 2 snapshots — clearly labeled
 * "auto-detected".
 *
 * FLAT only. Solid violet. No gradients. No shadows. Manrope. Streams in.
 */

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface DayRow {
  day: string;            // YYYY-MM-DD
  inflow_usd: number;
  outflow_usd: number;
  yield_usd: number;
  fee_usd: number;
  net_usd: number;
  event_count: number;
  source?: "events" | "snapshots";
}

interface SnapshotPoint { date: string; value: number }

interface Props {
  wallet: string | null;
  range?: "7d" | "30d" | "90d";
  /** Provisional fallback when no events exist. */
  snapshotSeries?: SnapshotPoint[];
  /** When provided (sim mode), bypass /api/treasury/pnl-daily and synthesize rows from these events. */
  simulatedEvents?: Array<{ id: string; type: string; category: string; amountUsd: number; capturedAt: string }> | null;
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtDay(d: string): string {
  const dt = new Date(d);
  if (isNaN(+dt)) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Synthesize ledger rows from snapshot deltas (sign decides inflow/outflow). */
function synthesizeFromSnapshots(snaps: SnapshotPoint[]): DayRow[] {
  if (!snaps || snaps.length < 2) return [];
  // Bucket by day, take last value of each day.
  const byDay = new Map<string, number>();
  for (const s of snaps) {
    const d = new Date(s.date);
    if (isNaN(+d)) continue;
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, s.value);
  }
  const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const rows: DayRow[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1][1];
    const cur = sorted[i][1];
    const delta = cur - prev;
    if (Math.abs(delta) < Math.max(1, prev * 0.0005)) continue; // ignore noise
    rows.push({
      day: sorted[i][0],
      inflow_usd: delta > 0 ? delta : 0,
      outflow_usd: delta < 0 ? -delta : 0,
      yield_usd: 0,
      fee_usd: 0,
      net_usd: delta,
      event_count: 1,
      source: "snapshots",
    });
  }
  return rows;
}

export function MoneyMovementLedger({ wallet, range = "30d", snapshotSeries = [] }: Props) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!wallet) { setDays([]); return; }
    setLoading(true);
    fetch(`/api/treasury/pnl-daily?wallet=${encodeURIComponent(wallet)}&range=${range}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => {
        const rows: DayRow[] = Array.isArray(j?.days)
          ? j.days.map((d: any) => ({ ...d, source: "events" as const }))
          : [];
        setDays(rows);
      })
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [wallet, range]);

  // Decide source: events first, else synthesize from snapshots.
  const { rows, isProvisional } = useMemo(() => {
    if (days.length > 0) return { rows: days, isProvisional: false };
    const synth = synthesizeFromSnapshots(snapshotSeries);
    return { rows: synth, isProvisional: synth.length > 0 };
  }, [days, snapshotSeries]);

  // Cumulative net + max scaling
  const { cum, maxAbs, maxCum, minCum, totalNet, totalIn, totalOut, totalYield, totalFee, biggest } = useMemo(() => {
    let running = 0;
    const cumArr: number[] = [];
    let mx = 1, mxC = 0, mnC = 0;
    let tIn = 0, tOut = 0, tY = 0, tF = 0;
    for (const r of rows) {
      running += r.net_usd;
      cumArr.push(running);
      const local = Math.max(r.inflow_usd, r.outflow_usd, r.yield_usd, r.fee_usd, Math.abs(r.net_usd));
      if (local > mx) mx = local;
      if (running > mxC) mxC = running;
      if (running < mnC) mnC = running;
      tIn += r.inflow_usd; tOut += r.outflow_usd; tY += r.yield_usd; tF += r.fee_usd;
    }
    const indexed = rows.map((r, i) => ({ r, i, mag: Math.abs(r.net_usd) }));
    const big = indexed.sort((a, b) => b.mag - a.mag).slice(0, 3).filter((x) => x.mag > 0);
    return { cum: cumArr, maxAbs: mx, maxCum: mxC, minCum: mnC, totalNet: running, totalIn: tIn, totalOut: tOut, totalYield: tY, totalFee: tF, biggest: big };
  }, [rows]);

  const activeIdx = pinnedIdx ?? hoverIdx;
  const active = activeIdx != null ? rows[activeIdx] : null;
  const activeCum = activeIdx != null ? cum[activeIdx] : null;

  // ─── Empty / loading states ───────────────────────────────────────
  if (!wallet) {
    return (
      <Shell>
        <p className="text-sm text-slate-500">Connect a wallet to read your money movement.</p>
      </Shell>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <Shell>
        <SkeletonBars />
      </Shell>
    );
  }
  if (rows.length === 0) {
    return (
      <Shell>
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-violet-700">
            <DreyvStar size={10} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Awaiting movement</span>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-slate-600">
            No tagged events yet, and not enough wallet history to infer one.
            Tag your first inflow or outflow on the treasury page — the ledger
            will fill itself in as the days pass.
          </p>
        </div>
      </Shell>
    );
  }

  // ─── Chart geometry ───────────────────────────────────────────────
  const W = 720;            // viewBox width
  const H = 200;            // viewBox height
  const padX = 14;
  const padY = 16;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const zeroY = padY + innerH * (maxAbs / (maxAbs * 2));     // == padY + innerH/2
  const colW = innerW / Math.max(rows.length, 1);
  const barW = Math.max(2, Math.min(10, colW * 0.55));

  const cumScale = Math.max(Math.abs(maxCum), Math.abs(minCum), maxAbs);
  const cumY = (v: number) => zeroY - (v / cumScale) * (innerH / 2);

  const cumPath = cum
    .map((v, i) => {
      const x = padX + colW * (i + 0.5);
      const y = cumY(v);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const handleMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.getBoundingClientRect();
    const x = ((e.clientX - pt.left) / pt.width) * W - padX;
    const i = Math.max(0, Math.min(rows.length - 1, Math.floor(x / colW)));
    setHoverIdx(i);
  };

  return (
    <Shell>
      {/* Top — anchored stats with provisional flag */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-700">
            <DreyvStar size={9} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              Net over window {isProvisional && <span className="ml-1 text-amber-700">· auto-detected</span>}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <motion.span
              key={totalNet}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`font-manrope text-3xl font-semibold tracking-tight tabular-nums ${
                totalNet >= 0 ? "text-slate-900" : "text-amber-700"
              }`}
            >
              {totalNet >= 0 ? "+" : "−"}
              {fmtCompact(Math.abs(totalNet))}
            </motion.span>
            <span className="text-[11px] text-slate-500">
              across {rows.length} day{rows.length === 1 ? "" : "s"} · {range}
            </span>
          </div>
        </div>
        <LegendStrip />
      </div>

      {/* Chart */}
      <div
        className="relative mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/30"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          preserveAspectRatio="none"
          onMouseMove={handleMove}
          onClick={() => setPinnedIdx(hoverIdx === pinnedIdx ? null : hoverIdx)}
        >
          {/* zero axis */}
          <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke="#c4b5fd" strokeWidth={0.6} />

          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((t) => (
            <g key={t}>
              <line x1={padX} x2={W - padX} y1={padY + innerH * t} y2={padY + innerH * t}
                stroke="#ede9fe" strokeWidth={0.5} strokeDasharray="2 4" />
            </g>
          ))}

          {/* bars */}
          {rows.map((r, i) => {
            const cx = padX + colW * (i + 0.5);
            // Stack inflow + yield above zero, outflow + fee below zero.
            const upParts: { v: number; fill: string }[] = [];
            if (r.inflow_usd > 0) upParts.push({ v: r.inflow_usd, fill: "#7c3aed" });
            if (r.yield_usd > 0) upParts.push({ v: r.yield_usd, fill: "#0f172a" });
            const dnParts: { v: number; fill: string }[] = [];
            if (r.outflow_usd > 0) dnParts.push({ v: r.outflow_usd, fill: "#c4b5fd" });
            if (r.fee_usd > 0) dnParts.push({ v: r.fee_usd, fill: "#94a3b8" });

            let yTop = zeroY;
            const upRects = upParts.map((p, k) => {
              const h = (p.v / maxAbs) * (innerH / 2);
              yTop -= h;
              return (
                <motion.rect
                  key={`u${k}`}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ duration: 0.5, delay: 0.005 * i, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformOrigin: `${cx}px ${zeroY}px` }}
                  x={cx - barW / 2}
                  y={yTop}
                  width={barW}
                  height={Math.max(0.6, h)}
                  fill={p.fill}
                  rx={1.2}
                />
              );
            });
            let yBot = zeroY;
            const dnRects = dnParts.map((p, k) => {
              const h = (p.v / maxAbs) * (innerH / 2);
              const y = yBot;
              yBot += h;
              return (
                <motion.rect
                  key={`d${k}`}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ duration: 0.5, delay: 0.005 * i + 0.05, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformOrigin: `${cx}px ${zeroY}px` }}
                  x={cx - barW / 2}
                  y={y}
                  width={barW}
                  height={Math.max(0.6, h)}
                  fill={p.fill}
                  rx={1.2}
                />
              );
            });
            return <g key={r.day}>{upRects}{dnRects}</g>;
          })}

          {/* cumulative net line */}
          <motion.path
            d={cumPath}
            fill="none"
            stroke="#7c3aed"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
          {/* terminal dot for cum line */}
          {cum.length > 0 && (
            <circle
              cx={padX + colW * (cum.length - 1 + 0.5)}
              cy={cumY(cum[cum.length - 1])}
              r={2.6}
              fill="#7c3aed"
            />
          )}

          {/* crosshair */}
          {activeIdx != null && (
            <g>
              <line
                x1={padX + colW * (activeIdx + 0.5)}
                x2={padX + colW * (activeIdx + 0.5)}
                y1={padY}
                y2={H - padY}
                stroke="#0f172a"
                strokeOpacity={0.18}
                strokeDasharray="2 3"
              />
              <circle
                cx={padX + colW * (activeIdx + 0.5)}
                cy={cumY(cum[activeIdx])}
                r={3.4}
                fill="#fff"
                stroke="#7c3aed"
                strokeWidth={1.4}
              />
            </g>
          )}

          {/* axis ticks (start / mid / end day labels) */}
          {[0, Math.floor(rows.length / 2), rows.length - 1].map((i) => (
            <text
              key={`t${i}`}
              x={padX + colW * (i + 0.5)}
              y={H - 2}
              fontSize={8}
              textAnchor="middle"
              fill="#94a3b8"
              fontFamily="ui-sans-serif, system-ui"
            >
              {fmtDay(rows[i].day)}
            </text>
          ))}
        </svg>

        {/* Hover readout */}
        <AnimatePresence>
          {active && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute left-3 top-3 rounded-xl border border-violet-200 bg-white/95 px-3 py-2 text-[11px]"
            >
              <div className="font-semibold text-slate-900">{fmtDay(active.day)}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-slate-500">Inflow</span>
                <span className="text-right text-violet-700">{fmtCompact(active.inflow_usd)}</span>
                <span className="text-slate-500">Outflow</span>
                <span className="text-right text-violet-300">{fmtCompact(active.outflow_usd)}</span>
                <span className="text-slate-500">Yield</span>
                <span className="text-right text-slate-900">{fmtCompact(active.yield_usd)}</span>
                <span className="text-slate-500">Fees</span>
                <span className="text-right text-slate-500">{fmtCompact(active.fee_usd)}</span>
                <span className="mt-1 col-span-1 border-t border-violet-100 pt-1 text-slate-700">Net</span>
                <span className={`mt-1 col-span-1 border-t border-violet-100 pt-1 text-right font-semibold ${active.net_usd >= 0 ? "text-slate-900" : "text-amber-700"}`}>
                  {active.net_usd >= 0 ? "+" : "−"}{fmtCompact(Math.abs(active.net_usd))}
                </span>
                <span className="text-slate-500">Running</span>
                <span className={`text-right font-semibold ${(activeCum ?? 0) >= 0 ? "text-violet-700" : "text-amber-700"}`}>
                  {(activeCum ?? 0) >= 0 ? "+" : "−"}{fmtCompact(Math.abs(activeCum ?? 0))}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Biggest movers rail */}
      {biggest.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-violet-700">
            <DreyvStar size={9} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Biggest movers</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {biggest.map(({ r, i }) => {
              const driver =
                r.inflow_usd >= Math.max(r.outflow_usd, r.yield_usd, r.fee_usd)
                  ? "inflow"
                  : r.outflow_usd >= Math.max(r.yield_usd, r.fee_usd)
                  ? "outflow"
                  : r.yield_usd >= r.fee_usd
                  ? "yield"
                  : "fees";
              const isPos = r.net_usd >= 0;
              const active = pinnedIdx === i;
              return (
                <button
                  key={r.day}
                  onClick={() => setPinnedIdx(active ? null : i)}
                  className={`group flex flex-col items-start gap-1 rounded-2xl border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-violet-400 bg-violet-50/60"
                      : "border-violet-100 bg-white hover:border-violet-300"
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {fmtDay(r.day)}
                  </span>
                  <span
                    className={`font-manrope text-lg font-semibold tabular-nums ${
                      isPos ? "text-slate-900" : "text-amber-700"
                    }`}
                  >
                    {isPos ? "+" : "−"}
                    {fmtCompact(Math.abs(r.net_usd))}
                  </span>
                  <span className="text-[10.5px] text-slate-500">
                    led by <span className="text-violet-700">{driver}</span>
                    {r.event_count > 0 && r.source === "events" && (
                      <> · {r.event_count} event{r.event_count === 1 ? "" : "s"}</>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Component totals strip (replaces bar legend cards) */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-violet-100 pt-3 text-[11px]">
        <span className="text-slate-500">Components</span>
        <Total label="Inflow" value={totalIn} swatch="#7c3aed" />
        <Total label="Outflow" value={totalOut} swatch="#c4b5fd" />
        <Total label="Yield" value={totalYield} swatch="#0f172a" />
        <Total label="Fees" value={totalFee} swatch="#94a3b8" />
      </div>
    </Shell>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border border-violet-100 bg-white p-5 sm:p-6">{children}</div>;
}

function LegendStrip() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-slate-500">
      <Swatch color="#7c3aed" label="Inflow" />
      <Swatch color="#0f172a" label="Yield" />
      <Swatch color="#c4b5fd" label="Outflow" />
      <Swatch color="#94a3b8" label="Fees" />
      <span className="ml-1 inline-flex items-center gap-1.5">
        <span className="block h-[2px] w-5 bg-violet-600" />
        <span>Cum. net</span>
      </span>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="block h-2 w-2 rounded-[2px]" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function Total({ label, value, swatch }: { label: string; value: number; swatch: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="block h-1.5 w-1.5 rounded-[1px]" style={{ background: swatch }} />
      <span className="text-slate-500">{label}</span>
      <span className="font-manrope font-semibold tabular-nums text-slate-900">{fmtCompact(value)}</span>
    </span>
  );
}

function SkeletonBars() {
  return (
    <div className="flex h-44 items-end gap-1">
      {Array.from({ length: 30 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: `${20 + (i * 13) % 70}%`, opacity: 0.35 }}
          transition={{ duration: 0.6, delay: i * 0.02 }}
          className="w-2 flex-1 rounded-[2px] bg-violet-100"
        />
      ))}
    </div>
  );
}
