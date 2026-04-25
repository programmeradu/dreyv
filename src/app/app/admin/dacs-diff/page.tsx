/**
 * DACS Phase 1 — admin shadow-mode diff viewer.
 *
 * Lists recent CommandBar invocations with both legacy and DACS pipeline
 * snapshots side-by-side, plus aggregate parity counts. Used during the
 * 1-week shadow rollout to validate decision parity before Phase 6 cutover.
 *
 * Light Stitch-inspired theme (consistent with /pricing + admin metrics).
 */
"use client";

import React, { useEffect, useState } from "react";
import { GitCompare, RefreshCw, AlertCircle, CheckCircle2, MinusCircle } from "lucide-react";

interface DiffRow {
  id: string;
  commandId: string;
  walletAddress: string | null;
  rawText: string;
  promptMode: string;
  legacyDecisionKind: string | null;
  legacyLatencyMs: number | null;
  dacsDecisionKind: string | null;
  dacsDecisionReason: string | null;
  dacsLatencyMs: number | null;
  parity: string | null;
  parityNotes: string | null;
  createdAt: string;
}

interface ParityCount {
  parity: string | null;
  n: number;
}

const PARITY_STYLE: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  match: { label: "match", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  drift: { label: "drift", cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: AlertCircle },
  legacy_only: { label: "legacy only", cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: MinusCircle },
  dacs_only: { label: "dacs only", cls: "bg-violet-50 text-violet-700 border-violet-200", Icon: MinusCircle },
  error: { label: "error", cls: "bg-red-50 text-red-700 border-red-200", Icon: AlertCircle },
};

export default function DacsDiffPage() {
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [counts, setCounts] = useState<ParityCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filter ? `/api/admin/dacs-diff?parity=${filter}&limit=100` : `/api/admin/dacs-diff?limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setCounts(data.counts ?? []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

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
              <GitCompare className="h-3.5 w-3.5" /> DACS shadow mode
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Command pipeline diff</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Side-by-side parity between the legacy CommandBar pipeline and the new bus-driven DACS router.
              Drift rows are reviewed before the Phase 6 cutover.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {/* Parity summary */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["match", "drift", "legacy_only", "dacs_only", "error"] as const).map((k) => {
            const n = counts.find((c) => c.parity === k)?.n ?? 0;
            const style = PARITY_STYLE[k];
            const active = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(active ? "" : k)}
                className={`rounded-2xl border bg-white p-4 text-left transition ${style.cls} ${active ? "ring-2 ring-violet-400" : ""}`}
              >
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                  <style.Icon className="h-3.5 w-3.5" /> {style.label}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{n}</div>
              </button>
            );
          })}
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
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Prompt</th>
                <th className="px-4 py-3 text-left">Legacy</th>
                <th className="px-4 py-3 text-left">DACS</th>
                <th className="px-4 py-3 text-left">Parity</th>
                <th className="px-4 py-3 text-right">Lat (l/d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-100">
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No commands recorded yet. Run a CommandBar prompt to populate.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const p = r.parity ? PARITY_STYLE[r.parity] : null;
                return (
                  <tr key={r.id} className="hover:bg-violet-50/40">
                    <td className="px-4 py-3 align-top text-xs text-slate-500 tabular-nums">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 align-top max-w-xs">
                      <div className="truncate font-medium text-slate-800" title={r.rawText}>
                        {r.rawText}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">{r.commandId}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-slate-700">
                        {r.legacyDecisionKind ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      <span className="rounded-md bg-violet-100 px-2 py-1 font-mono text-violet-800">
                        {r.dacsDecisionKind ?? "—"}
                      </span>
                      {r.dacsDecisionReason && (
                        <div className="mt-1 text-xs text-slate-500">{r.dacsDecisionReason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {p ? (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${p.cls}`}>
                          <p.Icon className="h-3 w-3" /> {p.label}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">pending</span>
                      )}
                      {r.parityNotes && (
                        <div className="mt-1 text-xs text-slate-500">{r.parityNotes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right text-xs tabular-nums text-slate-600">
                      {r.legacyLatencyMs ?? "—"} / {r.dacsLatencyMs ?? "—"} ms
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
