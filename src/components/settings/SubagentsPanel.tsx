"use client";

/**
 * DACS Phase 4 — Active sub-agents (Stitch-light Dreyv aesthetic).
 *
 * Background directives running on schedule. Pause / resume / cancel.
 * Wired to /api/dacs/subagents.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/compat";
import { Pause, Play, X, Loader2, Clock, Repeat, Activity } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface SubagentRow {
  id: string;
  title: string;
  status: "active" | "paused" | "completed" | "failed" | "cancelled";
  intervalSeconds: number;
  nextRunAt: string;
  tickCount: number;
  maxTicks: number | null;
  lastTickStatus: string | null;
  lastTickAt: string | null;
}

function formatInterval(seconds: number): string {
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const future = ms > 0;
  let val: string;
  if (abs >= 86400_000) val = `${Math.round(abs / 86400_000)}d`;
  else if (abs >= 3600_000) val = `${Math.round(abs / 3600_000)}h`;
  else if (abs >= 60_000) val = `${Math.round(abs / 60_000)}m`;
  else val = `${Math.round(abs / 1000)}s`;
  return future ? `in ${val}` : `${val} ago`;
}

const STATUS_TONE: Record<SubagentRow["status"], { dot: string; label: string; chip: string }> = {
  active:    { dot: "bg-violet-600 shadow-[0_0_10px_rgba(124,58,237,0.45)]", label: "Active",    chip: "bg-violet-50 text-violet-700 border-violet-200" },
  paused:    { dot: "bg-amber-500",  label: "Paused",    chip: "bg-amber-50 text-amber-700 border-amber-200" },
  completed: { dot: "bg-emerald-500", label: "Completed", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  failed:    { dot: "bg-rose-500",    label: "Failed",    chip: "bg-rose-50 text-rose-700 border-rose-200" },
  cancelled: { dot: "bg-slate-400",   label: "Cancelled", chip: "bg-slate-100 text-slate-600 border-slate-200" },
};

export function SubagentsPanel() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [rows, setRows] = useState<SubagentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/dacs/subagents?wallet=${wallet}`);
      const data = await r.json();
      if (data.ok) setRows(data.subagents ?? []);
    } catch { /* swallow */ } finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (id: string, action: "pause" | "resume" | "cancel") => {
    setBusyId(id);
    try {
      const r = await fetch("/api/dacs/subagents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error ?? "failed");
      toast.success(`Sub-agent ${action}d`);
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!wallet) return null;

  const active = rows.filter((r) => r.status === "active").length;

  return (
    <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-20 h-64 w-64 rounded-full bg-violet-300/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl" />

      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <DreyvStar size={10} className="text-violet-600" />
            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Sub-agents</span>
          </div>
          <h2 className="mt-2 text-[24px] sm:text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
            Background <span className="italic font-light text-violet-600">directives</span> on schedule
          </h2>
          <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
            Long-running watchers spawned by phrases like “monitor”, “DCA daily”, or “check every hour”. Each tick respects your agent policy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-violet-700">
            <Activity size={11} /> {active} active
          </span>
          {loading && <Loader2 className="animate-spin text-violet-600" size={14} />}
        </div>
      </div>

      <div className="relative z-10 mt-6">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/30 px-5 py-10 text-center">
            <DreyvStar size={14} className="text-violet-400 mx-auto" />
            <p className="mt-3 text-[13px] text-slate-600">
              No active sub-agents yet.
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              Try <span className="font-mono text-violet-700">“monitor JUP every hour”</span> or <span className="font-mono text-violet-700">“DCA $50 USDC into SOL daily”</span>.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((sa) => {
              const tone = STATUS_TONE[sa.status];
              return (
                <li
                  key={sa.id}
                  className="group flex items-center gap-4 rounded-2xl border border-violet-100 bg-white px-4 py-3.5 hover:border-violet-300 transition"
                >
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${tone.dot}`} aria-label={tone.label} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-slate-900 truncate">{sa.title}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-semibold tracking-[0.18em] uppercase ${tone.chip}`}>
                        {tone.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-[11px] text-slate-500 font-mono">
                      <span className="inline-flex items-center gap-1"><Repeat size={10} className="text-violet-500" /> every {formatInterval(sa.intervalSeconds)}</span>
                      <span>tick {sa.tickCount}{sa.maxTicks ? `/${sa.maxTicks}` : ""}</span>
                      {sa.status === "active" && (
                        <span className="inline-flex items-center gap-1"><Clock size={10} className="text-violet-500" /> next {formatRelative(sa.nextRunAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sa.status === "active" && (
                      <IconBtn label="Pause" onClick={() => act(sa.id, "pause")} disabled={busyId === sa.id}><Pause size={13} /></IconBtn>
                    )}
                    {sa.status === "paused" && (
                      <IconBtn label="Resume" onClick={() => act(sa.id, "resume")} disabled={busyId === sa.id}><Play size={13} /></IconBtn>
                    )}
                    {(sa.status === "active" || sa.status === "paused") && (
                      <IconBtn label="Cancel" onClick={() => act(sa.id, "cancel")} disabled={busyId === sa.id} danger><X size={13} /></IconBtn>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function IconBtn({
  children, label, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`h-8 w-8 rounded-full border bg-white flex items-center justify-center transition disabled:opacity-40 ${
        danger
          ? "border-violet-100 text-slate-500 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50"
          : "border-violet-100 text-slate-600 hover:text-violet-700 hover:border-violet-300 hover:bg-violet-50"
      }`}
    >
      {children}
    </button>
  );
}
