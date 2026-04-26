/**
 * DACS Phase 5.3 — Admin handoffs audit page.
 *
 * Aggregates `dacs_handoffs` rows per specialist with status mix, p50/p95
 * duration, and a sample of recent rejections / deferrals. Mirrors the
 * `/app/admin/dacs-parity-audit` aesthetic so the admin dashboard stays
 * consistent.
 *
 * Stitch-inspired light theme — solid violet accents, ambient glows,
 * Manrope. No gradients (per project memory).
 */
"use client";

import React, { useEffect, useState } from "react";
import {
  Network,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  PauseCircle,
  XCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";

interface RecentIssue {
  id: string;
  commandId: string;
  status: string;
  summary: string;
  intentKind: string;
  durationMs: number | null;
  createdAt: string;
}

interface SpecialistBucket {
  specialist: string;
  total: number;
  completed: number;
  accepted: number;
  deferred: number;
  rejected: number;
  failureRate: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  intentKinds: Record<string, number>;
  recentIssues: RecentIssue[];
}

interface Totals {
  total: number;
  completed: number;
  accepted: number;
  deferred: number;
  rejected: number;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function bandClass(rate: number) {
  if (rate === 0) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (rate < 0.05) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function shortSpecialist(id: string): string {
  return id.replace(/-agent$/, "").replace(/-/g, " ");
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return { Icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "accepted":
      return { Icon: Clock, cls: "bg-violet-50 text-violet-700 border-violet-200" };
    case "deferred":
      return { Icon: PauseCircle, cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "rejected":
      return { Icon: XCircle, cls: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { Icon: AlertCircle, cls: "bg-slate-50 text-slate-700 border-slate-200" };
  }
}

export default function DacsHandoffsAuditPage() {
  const [buckets, setBuckets] = useState<SpecialistBucket[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [sampledRows, setSampledRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/dacs-handoffs-audit");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBuckets(data.buckets ?? []);
      setTotals(data.totals ?? null);
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

  const overallFailureRate =
    totals && totals.total > 0 ? totals.rejected / totals.total : 0;

  return (
    <div className="dreyv-marketing-root relative h-full w-full overflow-y-auto font-manrope bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50/70 px-3 py-1 text-xs font-medium text-violet-700">
              <Network className="h-3.5 w-3.5" /> Specialist handoffs · CATP v1.0
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Specialist health audit</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Per-specialist throughput, status mix, and latency. Specialists with the highest
              rejection rate are reviewed first before broader rollout.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/app/admin/dacs-parity-audit"
              className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50"
            >
              Parity audit <ArrowRight className="h-3 w-3" />
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
            <div className="text-xs text-slate-500">most recent reports</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-violet-700">Specialists active</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{buckets.length}</div>
          </div>
          <div className={`rounded-2xl border p-4 ${bandClass(overallFailureRate)}`}>
            <div className="text-xs uppercase tracking-wide">Overall rejection</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{pct(overallFailureRate)}</div>
            <div className="text-xs opacity-80">
              {totals?.rejected ?? 0} / {totals?.total ?? 0}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
            <div className="text-xs uppercase tracking-wide">Completed</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{totals?.completed ?? 0}</div>
            <div className="text-xs opacity-80">deferred {totals?.deferred ?? 0}</div>
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
                <th className="px-4 py-3 text-left">Specialist</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Completed</th>
                <th className="px-4 py-3 text-right">Deferred</th>
                <th className="px-4 py-3 text-right">Rejected</th>
                <th className="px-4 py-3 text-right">Reject rate</th>
                <th className="px-4 py-3 text-right">p50 / p95</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-100">
              {buckets.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No specialist handoffs recorded yet.
                  </td>
                </tr>
              )}
              {buckets.map((b) => {
                const isOpen = expanded === b.specialist;
                const topIntents = Object.entries(b.intentKinds)
                  .sort((a, c) => c[1] - a[1])
                  .slice(0, 3);
                return (
                  <React.Fragment key={b.specialist}>
                    <tr className="hover:bg-violet-50/40">
                      <td className="px-4 py-3 align-top">
                        <span className="rounded-md bg-violet-100 px-2 py-1 font-mono text-xs text-violet-800">
                          {shortSpecialist(b.specialist)}
                        </span>
                        {topIntents.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {topIntents.map(([kind, n]) => (
                              <span
                                key={kind}
                                className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                              >
                                {kind} · {n}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-right tabular-nums">{b.total}</td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-emerald-700">
                        {b.completed}
                      </td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-amber-700">
                        {b.deferred}
                      </td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-red-700">
                        {b.rejected}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${bandClass(
                            b.failureRate,
                          )}`}
                        >
                          {b.failureRate === 0 ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          {pct(b.failureRate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-right text-xs tabular-nums text-slate-600">
                        {b.p50DurationMs ?? "—"} / {b.p95DurationMs ?? "—"} ms
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        {b.recentIssues.length > 0 && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : b.specialist)}
                            className="text-xs font-medium text-violet-700 hover:underline"
                          >
                            {isOpen ? "Hide" : "Inspect"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && b.recentIssues.length > 0 && (
                      <tr className="bg-violet-50/30">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-2">
                            Recent issues ({b.recentIssues.length})
                          </div>
                          <ul className="space-y-2">
                            {b.recentIssues.map((s) => {
                              const badge = statusBadge(s.status);
                              const Icon = badge.Icon;
                              return (
                                <li
                                  key={s.id}
                                  className="rounded-lg border border-violet-200/60 bg-white p-3 text-xs"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}
                                      >
                                        <Icon className="h-3 w-3" />
                                        {s.status}
                                      </span>
                                      <code className="font-mono text-slate-500 truncate">
                                        {s.commandId.slice(0, 14)}…
                                      </code>
                                      <span className="text-slate-500">· {s.intentKind}</span>
                                    </div>
                                    <div className="text-slate-400 tabular-nums shrink-0">
                                      {new Date(s.createdAt).toLocaleString()}
                                    </div>
                                  </div>
                                  <p className="mt-1.5 text-slate-700 leading-relaxed">
                                    {s.summary}
                                  </p>
                                  {typeof s.durationMs === "number" && (
                                    <div className="mt-1 text-[10px] text-slate-500 tabular-nums">
                                      {s.durationMs}ms
                                    </div>
                                  )}
                                </li>
                              );
                            })}
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
