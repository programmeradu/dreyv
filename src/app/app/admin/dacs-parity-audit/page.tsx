/**
 * DACS shadow-mode parity audit (by command route).
 *
 * Companion to /app/admin/dacs-diff. Where the diff page shows a flat row
 * stream, this view aggregates by route (legacy decision kind) so reviewers
 * can spot which routes drift most before the Phase 6 cutover.
 *
 * Stitch-inspired light theme — solid violet accents, ambient glows, Manrope.
 */
"use client";

import React, { useEffect, useState } from "react";
import { ScanSearch, RefreshCw, AlertCircle, CheckCircle2, ArrowRight, HelpCircle } from "lucide-react";
import Link from "next/link";

interface DriftSample {
  commandId: string;
  rawText: string;
  legacyDecisionKind: string | null;
  dacsDecisionKind: string | null;
  parityNotes: string | null;
  createdAt: string;
}

interface RouteBucket {
  route: string;
  total: number;
  match: number;
  drift: number;
  legacy_only: number;
  dacs_only: number;
  error: number;
  pending: number;
  driftRate: number;
  avgLegacyLatencyMs: number | null;
  avgDacsLatencyMs: number | null;
  sampleDrifts: DriftSample[];
}

interface ParityCount {
  parity: string | null;
  n: number;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function bandClass(rate: number) {
  if (rate === 0) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (rate < 0.05) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

export default function DacsParityAuditPage() {
  const [buckets, setBuckets] = useState<RouteBucket[]>([]);
  const [totals, setTotals] = useState<ParityCount[]>([]);
  const [sampledRows, setSampledRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/dacs-parity-audit");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBuckets(data.buckets ?? []);
      setTotals(data.totals ?? []);
      setSampledRows(data.sampledRows ?? 0);
    } catch (e: any) {
      setError(e.message || "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, []);

  const totalCommands = totals.reduce((s, t) => s + t.n, 0);
  const totalDrift = totals.find((t) => t.parity === "drift")?.n ?? 0;
  const overallDriftRate = totalCommands > 0 ? totalDrift / totalCommands : 0;

  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50/70 px-3 py-1 text-xs font-medium text-violet-700">
              <ScanSearch className="h-3.5 w-3.5" /> Parity audit · by route
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Shadow-mode route audit</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Aggregated parity per command route. Routes with the highest drift rate are reviewed
              first before flipping <code className="rounded bg-violet-50 px-1 py-0.5 text-violet-700">DACS_ENABLED=primary</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/app/admin/dacs-diff"
              className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50"
            >
              Row stream <ArrowRight className="h-3 w-3" />
            </Link>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </header>

        {/* Top-line summary */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-violet-200/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-violet-700">Sampled</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{sampledRows}</div>
            <div className="text-xs text-slate-500">most recent rows</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-violet-700">Routes seen</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{buckets.length}</div>
          </div>
          <div className={`rounded-2xl border p-4 ${bandClass(overallDriftRate)}`}>
            <div className="text-xs uppercase tracking-wide">Overall drift</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{pct(overallDriftRate)}</div>
            <div className="text-xs opacity-80">{totalDrift} / {totalCommands}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
            <div className="text-xs uppercase tracking-wide">Match</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {totals.find((t) => t.parity === "match")?.n ?? 0}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur-sm shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
          <table className="w-full text-sm">
            <thead className="bg-violet-50/70 text-xs uppercase tracking-wide text-violet-700">
              <tr>
                <th className="px-4 py-3 text-left">Route</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Match</th>
                <th className="px-4 py-3 text-right">Drift</th>
                <th className="px-4 py-3 text-right">L-only</th>
                <th className="px-4 py-3 text-right">D-only</th>
                <th className="px-4 py-3 text-right">Drift rate</th>
                <th className="px-4 py-3 text-right">Lat (l/d)</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-100">
              {buckets.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    No commands recorded yet.
                  </td>
                </tr>
              )}
              {buckets.map((b) => {
                const isOpen = expanded === b.route;
                return (
                  <React.Fragment key={b.route}>
                    <tr className="hover:bg-violet-50/40">
                      <td className="px-4 py-3 align-top">
                        <span className="rounded-md bg-violet-100 px-2 py-1 font-mono text-xs text-violet-800">
                          {b.route}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-right tabular-nums">{b.total}</td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-emerald-700">{b.match}</td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-red-700">{b.drift}</td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-slate-600">{b.legacy_only}</td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-violet-700">{b.dacs_only}</td>
                      <td className="px-4 py-3 align-top text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${bandClass(b.driftRate)}`}>
                          {b.driftRate === 0 ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                          {pct(b.driftRate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-right text-xs tabular-nums text-slate-600">
                        {b.avgLegacyLatencyMs ?? "—"} / {b.avgDacsLatencyMs ?? "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        {b.drift > 0 && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : b.route)}
                            className="text-xs font-medium text-violet-700 hover:underline"
                          >
                            {isOpen ? "Hide" : "Inspect"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && b.sampleDrifts.length > 0 && (
                      <tr className="bg-violet-50/30">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-2">
                            Recent drifts ({b.sampleDrifts.length})
                          </div>
                          <ul className="space-y-2">
                            {b.sampleDrifts.map((s) => (
                              <li key={s.commandId} className="rounded-lg border border-violet-200/60 bg-white p-3 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium text-slate-800 truncate" title={s.rawText}>
                                    {s.rawText}
                                  </div>
                                  <div className="text-slate-400 tabular-nums shrink-0">
                                    {new Date(s.createdAt).toLocaleString()}
                                  </div>
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-xs">
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                                    legacy: {s.legacyDecisionKind ?? "—"}
                                  </span>
                                  <ArrowRight className="h-3 w-3 text-slate-400" />
                                  <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-violet-800">
                                    dacs: {s.dacsDecisionKind ?? "—"}
                                  </span>
                                  {s.parityNotes && (
                                    <span className="text-slate-500">· {s.parityNotes}</span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
