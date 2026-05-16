"use client";

/**
 * DACS Phase 5.2 — Specialist handoffs timeline (Stitch-light Dreyv aesthetic).
 *
 * Recent CATP v1.0 reports for the connected wallet, grouped by commandId.
 * Wired to /api/dacs/handoffs.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet/compat";
import { Loader2, CheckCircle2, XCircle, Clock, PauseCircle, GitBranch } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface HandoffRow {
  id: string;
  commandId: string;
  walletAddress: string | null;
  specialist: string;
  intentKind: string;
  status: "accepted" | "completed" | "rejected" | "deferred";
  summary: string;
  durationMs: number | null;
  createdAt: string;
}

const STATUS_META: Record<HandoffRow["status"], { label: string; chip: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  completed: { label: "Completed",        chip: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  accepted:  { label: "Accepted",         chip: "bg-violet-50 text-violet-700 border-violet-200",     Icon: Clock },
  deferred:  { label: "Deferred to HITL", chip: "bg-amber-50 text-amber-700 border-amber-200",        Icon: PauseCircle },
  rejected:  { label: "Rejected",         chip: "bg-rose-50 text-rose-700 border-rose-200",           Icon: XCircle },
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function shortSpecialist(id: string): string {
  return id.replace(/-agent$/, "").replace(/-/g, " ");
}

export function HandoffsPanel() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [rows, setRows] = useState<HandoffRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // When a wallet is connected, scope to that wallet. Otherwise show the
      // most recent platform-wide handoffs so the panel never looks dead.
      const qs = wallet ? `wallet=${wallet}&limit=25` : `limit=15`;
      const r = await fetch(`/api/dacs/handoffs?${qs}`);
      const data = await r.json();
      if (data.ok) setRows(data.handoffs ?? []);
    } catch { /* swallow */ } finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const grouped = useMemo(() => {
    const map = new Map<string, HandoffRow[]>();
    for (const row of rows) {
      const arr = map.get(row.commandId) ?? [];
      arr.push(row);
      map.set(row.commandId, arr);
    }
    return Array.from(map.entries()).slice(0, 12);
  }, [rows]);

  // Note: previously this returned null when no wallet was connected, which
  // made the panel look broken on the settings page. Now we always render so
  // the user can either see platform-wide activity or get a clear empty state.

  return (
    <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />

      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <DreyvStar size={10} className="text-violet-600" />
            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Specialist handoffs</span>
          </div>
          <h2 className="mt-2 text-[24px] sm:text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
            CATP <span className="italic font-light text-violet-600">v1.0</span> reports from the agent fabric
          </h2>
          <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
            Every command can fan out to specialist agents. Each one returns a signed report — accepted, completed, deferred, or rejected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-violet-700">
            <GitBranch size={11} /> {rows.length} reports
          </span>
          {loading && <Loader2 className="animate-spin text-violet-600" size={14} />}
        </div>
      </div>

      <div className="relative z-10 mt-6">
        {grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/30 px-5 py-10 text-center">
            <DreyvStar size={14} className="text-violet-400 mx-auto" />
            <p className="mt-3 text-[13px] text-slate-600">No handoffs yet.</p>
            <p className="mt-1 text-[12px] text-slate-500">
              Submit a command and watch specialists report back here in real time.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {grouped.map(([commandId, reports]) => (
              <li
                key={commandId}
                className="rounded-2xl border border-violet-100 bg-white p-4 hover:border-violet-300 transition"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-[10px] font-mono text-slate-500 truncate">
                      {commandId.slice(0, 18)}…
                    </code>
                    <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">
                      · {reports[0].intentKind}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 whitespace-nowrap font-mono">
                    {formatRelative(reports[0].createdAt)}
                  </span>
                </div>
                <div className="space-y-2">
                  {reports.map((r) => {
                    const meta = STATUS_META[r.status] ?? STATUS_META.accepted;
                    const Icon = meta.Icon;
                    return (
                      <div key={r.id} className="flex items-start gap-2.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap ${meta.chip}`}
                        >
                          <Icon size={10} />
                          {shortSpecialist(r.specialist)}
                        </span>
                        <p className="text-[12.5px] text-slate-700 leading-relaxed flex-1">
                          {r.summary}
                        </p>
                        {typeof r.durationMs === "number" && (
                          <span className="text-[10px] text-slate-400 whitespace-nowrap font-mono">
                            {r.durationMs}ms
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
