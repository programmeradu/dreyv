"use client";

/**
 * DACS Phase 5.2 — Specialist handoffs timeline.
 *
 * Compact list of recent AgentReports for the connected wallet, grouped by
 * commandId. Shows specialist, status, summary, duration. Wired to
 * /api/dacs/handoffs.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet/compat";
import { Network, Loader2, CheckCircle2, XCircle, Clock, PauseCircle } from "lucide-react";

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

const STATUS_META: Record<HandoffRow["status"], { label: string; cls: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30", Icon: CheckCircle2 },
  accepted: { label: "Accepted", cls: "bg-primary/10 text-primary border-primary/30", Icon: Clock },
  deferred: { label: "Deferred to HITL", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30", Icon: PauseCircle },
  rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: XCircle },
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
    if (!wallet) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/dacs/handoffs?wallet=${wallet}&limit=25`);
      const data = await r.json();
      if (data.ok) setRows(data.handoffs ?? []);
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
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

  if (!wallet) return null;

  return (
    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <Network size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">Specialist handoffs</h2>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              CATP v1.0 reports from agent fabric
            </p>
          </div>
        </div>
        {loading && <Loader2 className="animate-spin text-muted-foreground" size={16} />}
      </div>

      {grouped.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-xl">
          No handoffs yet. Submit a command to see specialist activity.
        </div>
      ) : (
        <ul className="space-y-2">
          {grouped.map(([commandId, reports]) => (
            <li
              key={commandId}
              className="border border-border rounded-xl p-3 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-[10px] font-mono text-muted-foreground truncate">
                    {commandId.slice(0, 14)}…
                  </code>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    · {reports[0].intentKind}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatRelative(reports[0].createdAt)}
                </span>
              </div>
              <div className="space-y-1.5">
                {reports.map((r) => {
                  const meta = STATUS_META[r.status] ?? STATUS_META.accepted;
                  const Icon = meta.Icon;
                  return (
                    <div key={r.id} className="flex items-start gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${meta.cls}`}
                      >
                        <Icon size={10} />
                        {shortSpecialist(r.specialist)}
                      </span>
                      <p className="text-xs text-foreground/80 leading-relaxed flex-1">
                        {r.summary}
                      </p>
                      {typeof r.durationMs === "number" && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
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
    </section>
  );
}
