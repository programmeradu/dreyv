"use client";

/**
 * /app/workflows — Owner UI for the workflow DAG engine (Pillar AV).
 *
 * Backed by workflows.* registry capabilities via /api/owner/run.
 * - Lists workflows
 * - Create via JSON DAG editor (name, trigger, nodes[])
 * - Run (dryRun + live), see node log timeline
 * - Recent runs across all workflows
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { runCapability } from "@/lib/owner/client";
import { toast } from "@/lib/toast-notifications";
import {
  Plus,
  Loader2,
  Play,
  Trash2,
  Workflow,
  CheckCircle2,
  AlertCircle,
  Clock,
  Power,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

interface WfRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  nodes: unknown;
  trigger: unknown;
  lastRunAt: string | null;
  updatedAt: string;
}
interface RunRow {
  id: string;
  workflowId: string;
  status: string;
  durationMs: number | null;
  nodeLog: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const SAMPLE_DAG = JSON.stringify(
  {
    name: "morning-treasury-pulse",
    description: "Snapshot holdings, run PnL, post a digest",
    trigger: { kind: "cron", cron: "0 9 * * *" },
    nodes: [
      { id: "snap", kind: "capability", capability: "portfolio.holdings", with: { chain: "solana" }, next: ["pnl"] },
      { id: "pnl", kind: "capability", capability: "portfolio.pnl", with: { window: "24h" }, next: ["digest"] },
      { id: "digest", kind: "capability", capability: "digests.send_now", with: { channel: "default" }, next: [] },
    ],
  },
  null,
  2,
);

export function WorkflowsClient() {
  const [wfs, setWfs] = useState<WfRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [dagText, setDagText] = useState(SAMPLE_DAG);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, r] = await Promise.all([
        runCapability<{ workflows: WfRow[] }>("workflows.list", { limit: 100 }),
        runCapability<{ runs: RunRow[] }>("workflows.runs_list", { limit: 25 }),
      ]);
      setWfs(w.workflows ?? []);
      setRuns(r.runs ?? []);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const parsed = JSON.parse(dagText) as Record<string, unknown>;
      if (!parsed.name || !Array.isArray(parsed.nodes)) {
        throw new Error("DAG must include `name` and `nodes[]`");
      }
      await runCapability("workflows.create", parsed);
      toast.success("Workflow created.");
      setShowCreate(false);
      void load();
    } catch (e) {
      toast.error(`Create failed: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function runWf(id: string, dryRun: boolean) {
    setRunning(id);
    try {
      const res = await runCapability<{ run: RunRow }>("workflows.run", { id, dryRun });
      toast.success(dryRun ? `Dry-run ${res.run.status}` : `Run ${res.run.status}`);
      setOpenRun(res.run.id);
      void load();
    } catch (e) {
      toast.error(`Run failed: ${(e as Error).message}`);
    } finally {
      setRunning(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete workflow "${name}"?`)) return;
    try {
      await runCapability("workflows.delete", { id });
      toast.success("Deleted.");
      void load();
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  }

  const runByWf = useMemo(() => {
    const map = new Map<string, RunRow>();
    for (const r of runs) if (!map.has(r.workflowId)) map.set(r.workflowId, r);
    return map;
  }, [runs]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 font-manrope">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-slate-400">
            <DreyvStar size={12} className="text-violet-500" /> Owner · Pillar AV
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Workflows</h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl">
            Chain capabilities into typed DAGs. Same registry that powers REST + MCP — runs are auditable, dry-runnable, and topologically validated.
          </p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className={marketingPrimaryCtaSm}>
          <Plus size={14} /> {showCreate ? "Cancel" : "New workflow"}
        </button>
      </header>

      {showCreate && (
        <div className="rounded-3xl border border-violet-200 bg-white p-6 mb-8">
          <p className="text-xs text-slate-500 mb-2">
            Paste a DAG. Node kinds: <code className="text-violet-700">capability</code>,{" "}
            <code className="text-violet-700">delay</code>, <code className="text-violet-700">branch</code>.
          </p>
          <textarea
            value={dagText}
            onChange={(e) => setDagText(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full rounded-2xl border border-violet-200 bg-slate-950 text-violet-100 font-mono text-xs p-4 outline-none focus:border-violet-400"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDagText(SAMPLE_DAG)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Reset sample
            </button>
            <button onClick={create} disabled={creating} className={marketingPrimaryCtaSm}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create workflow
            </button>
          </div>
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3">Workflows</h2>
        {loading ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-10 text-center text-sm text-slate-500">
            <Loader2 size={16} className="inline animate-spin mr-2" />
            Loading…
          </div>
        ) : wfs.length === 0 ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-12 text-center">
            <Workflow size={28} className="mx-auto text-violet-400" />
            <p className="mt-3 text-sm font-semibold text-slate-900">No workflows yet</p>
            <p className="mt-1 text-xs text-slate-500">Create one to orchestrate capabilities on a schedule, event, or manual trigger.</p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {wfs.map((w) => {
              const nodes = Array.isArray(w.nodes) ? w.nodes : [];
              const lastRun = runByWf.get(w.id);
              const trigger = (w.trigger as { kind?: string; cron?: string })?.kind ?? "manual";
              return (
                <li key={w.id} className="rounded-3xl border border-violet-200 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-slate-900">{w.name}</span>
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700">
                          {trigger}
                        </span>
                        {!w.enabled && (
                          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-500">
                            disabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {w.description ?? "No description"} · {nodes.length} node{nodes.length === 1 ? "" : "s"}
                      </p>
                      {lastRun && (
                        <p className="mt-1 text-[11px] font-mono text-slate-400">
                          last run: {lastRun.status} · {lastRun.durationMs ?? 0}ms ·{" "}
                          {new Date(lastRun.createdAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => runWf(w.id, true)}
                        disabled={running === w.id}
                        className="text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-slate-700 hover:bg-violet-50"
                      >
                        {running === w.id ? <Loader2 size={12} className="inline animate-spin" /> : "Dry-run"}
                      </button>
                      <button
                        onClick={() => runWf(w.id, false)}
                        disabled={running === w.id || !w.enabled}
                        className={marketingPrimaryCtaSm}
                      >
                        <Play size={12} /> Run
                      </button>
                      <button
                        onClick={() => remove(w.id, w.name)}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No runs yet.</p>
        ) : (
          <ul className="grid gap-2">
            {runs.map((r) => {
              const wf = wfs.find((w) => w.id === r.workflowId);
              const log = Array.isArray(r.nodeLog)
                ? (r.nodeLog as Array<{ nodeId: string; kind: string; status: string; output?: unknown; error?: string }>)
                : [];
              const isOpen = openRun === r.id;
              return (
                <li key={r.id} className="rounded-2xl border border-violet-200 bg-white p-4">
                  <button
                    onClick={() => setOpenRun(isOpen ? null : r.id)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      {r.status === "succeeded" ? (
                        <CheckCircle2 size={16} className="text-emerald-600" />
                      ) : r.status === "failed" ? (
                        <AlertCircle size={16} className="text-rose-600" />
                      ) : (
                        <Clock size={16} className="text-amber-600" />
                      )}
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{wf?.name ?? r.workflowId}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {r.status} · {r.durationMs ?? 0}ms · {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <Power size={12} className={`transition-transform ${isOpen ? "rotate-90 text-violet-600" : "text-slate-300"}`} />
                  </button>
                  {isOpen && (
                    <div className="mt-3 grid gap-2">
                      {r.error && <p className="text-xs text-rose-600">{r.error}</p>}
                      {log.map((n) => (
                        <div
                          key={n.nodeId}
                          className={`rounded-xl border px-3 py-2 text-xs font-mono ${
                            n.status === "succeeded" ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"
                          }`}
                        >
                          <div className="text-slate-900">
                            {n.nodeId} <span className="text-slate-400">·</span> {n.kind} <span className="text-slate-400">·</span>{" "}
                            <span className={n.status === "succeeded" ? "text-emerald-700" : "text-rose-700"}>{n.status}</span>
                          </div>
                          {n.output != null && (
                            <pre className="mt-1 text-[10px] text-slate-600 whitespace-pre-wrap break-all">
                              {JSON.stringify(n.output, null, 2)}
                            </pre>
                          )}
                          {n.error && <p className="mt-1 text-[10px] text-rose-700">{n.error}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
