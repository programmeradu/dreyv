"use client";

/**
 * DACS Phase 4 — Active sub-agents strip.
 *
 * Compact list shown under the Agent Policy panel: title, cadence, next run,
 * pause/resume/cancel actions. Wired to /api/dacs/subagents.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bot, Pause, Play, X, Loader2, Clock } from "lucide-react";
import { toast } from "@/lib/toast-notifications";

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

  return (
    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <Bot size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">Sub-agents</h2>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              Background directives running on schedule
            </p>
          </div>
        </div>
        {loading && <Loader2 className="animate-spin text-muted-foreground" size={16} />}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
            No active sub-agents. Ask the agent to "monitor", "DCA daily", or "check every hour".
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((sa) => (
            <li
              key={sa.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <StatusDot status={sa.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{sa.title}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground uppercase tracking-widest font-medium mt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    every {formatInterval(sa.intervalSeconds)}
                  </span>
                  <span>
                    tick {sa.tickCount}
                    {sa.maxTicks ? `/${sa.maxTicks}` : ""}
                  </span>
                  {sa.status === "active" && (
                    <span>next {formatRelative(sa.nextRunAt)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {sa.status === "active" && (
                  <IconBtn label="Pause" onClick={() => act(sa.id, "pause")} disabled={busyId === sa.id}>
                    <Pause size={14} />
                  </IconBtn>
                )}
                {sa.status === "paused" && (
                  <IconBtn label="Resume" onClick={() => act(sa.id, "resume")} disabled={busyId === sa.id}>
                    <Play size={14} />
                  </IconBtn>
                )}
                {(sa.status === "active" || sa.status === "paused") && (
                  <IconBtn label="Cancel" onClick={() => act(sa.id, "cancel")} disabled={busyId === sa.id}>
                    <X size={14} />
                  </IconBtn>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusDot({ status }: { status: SubagentRow["status"] }) {
  const cls =
    status === "active"
      ? "bg-primary shadow-[0_0_8px_var(--dashboard-accent-muted)]"
      : status === "paused"
        ? "bg-muted-foreground"
        : status === "completed"
          ? "bg-primary/40"
          : "bg-destructive";
  return <span className={`w-2 h-2 rounded-full ${cls}`} aria-label={status} />;
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 rounded-lg border border-border bg-background hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-foreground transition flex items-center justify-center disabled:opacity-50"
    >
      {children}
    </button>
  );
}
