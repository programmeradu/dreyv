"use client";

/**
 * /app/observability — Owner UI for Pillar AP (traces) + AR (audit).
 *
 * - Traces: list recent traces, drill into spans
 * - Audit: scroll the hash-chained log + run an integrity verify
 * Backed by obs.* and audit.* capabilities via /api/owner/run.
 */
import React, { useCallback, useEffect, useState } from "react";
import { runCapability } from "@/lib/owner/client";
import { toast } from "@/lib/toast-notifications";
import { Loader2, Activity, ShieldCheck, AlertCircle, CheckCircle2, RefreshCw, FileSearch } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

interface Trace {
  id: string;
  traceId: string;
  service: string;
  rootName: string | null;
  durationMs: number;
  status: string;
  spanCount: number;
  createdAt: string;
}
interface Span {
  id: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  durationMs: number;
  status: string;
}
interface AuditEntry {
  id: number;
  action: string;
  target: string | null;
  meta: unknown;
  prevHash: string;
  hash: string;
  ts: string;
}

type Tab = "traces" | "audit";

export function ObservabilityClient() {
  const [tab, setTab] = useState<Tab>("traces");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [spans, setSpans] = useState<Record<string, Span[]>>({});
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [capabilityMissing, setCapabilityMissing] = useState(false);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; firstBadAt?: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "traces") {
        const t = await runCapability<{ traces: Trace[] }>("obs.trace_list", { limit: 50 });
        setTraces(t.traces ?? []);
      } else {
        const a = await runCapability<{ entries: AuditEntry[] }>("audit.list", { limit: 100 });
        setAudit(a.entries ?? []);
      }
      setCapabilityMissing(false);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/not.?(registered|found)|capability_failed|404/i.test(msg)) {
        setCapabilityMissing(true);
      } else {
        toast.error(`Load failed: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadSpans(traceId: string) {
    if (spans[traceId]) {
      setOpenTrace(openTrace === traceId ? null : traceId);
      return;
    }
    try {
      const s = await runCapability<{ spans: Span[] }>("obs.span_list", { traceId, limit: 200 });
      setSpans((prev) => ({ ...prev, [traceId]: s.spans ?? [] }));
      setOpenTrace(traceId);
    } catch (e) {
      toast.error(`Spans failed: ${(e as Error).message}`);
    }
  }

  async function runVerify() {
    setVerifying(true);
    try {
      const r = await runCapability<{ ok: boolean; checked: number; firstBadAt?: string }>("audit.verify");
      setVerify(r);
      toast.success(r.ok ? `Verified ${r.checked} entries — chain intact.` : "Tamper detected!");
    } catch (e) {
      toast.error(`Verify failed: ${(e as Error).message}`);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 font-manrope">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-slate-400">
            <DreyvStar size={12} className="text-violet-500" /> Owner · Pillars AP + AR
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Observability</h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl">
            OTel-shaped traces and a hash-chained audit log — every capability call leaves cryptographic evidence.
          </p>
        </div>
        <button onClick={load} className="text-xs font-semibold inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-violet-200 text-slate-700 hover:bg-violet-50">
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      <div className="mb-6 flex gap-2 border-b border-violet-100">
        {(["traces", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "traces" ? <Activity size={12} className="inline mr-1" /> : <ShieldCheck size={12} className="inline mr-1" />}
            {t === "traces" ? "Traces" : "Audit chain"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-3xl border border-violet-100 bg-white p-10 text-center text-sm text-slate-500">
          <Loader2 size={16} className="inline animate-spin mr-2" />
          Loading…
        </div>
      ) : tab === "traces" ? (
        traces.length === 0 ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-12 text-center">
            <FileSearch size={28} className="mx-auto text-violet-400" />
            <p className="mt-3 text-sm font-semibold text-slate-900">No traces ingested yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Send spans via <code className="text-violet-700">obs.trace_ingest</code> or the OTel exporter.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {traces.map((t) => {
              const open = openTrace === t.traceId;
              const tSpans = spans[t.traceId] ?? [];
              return (
                <li key={t.id} className="rounded-2xl border border-violet-200 bg-white p-4">
                  <button onClick={() => loadSpans(t.traceId)} className="w-full text-left flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {t.rootName ?? "(root)"} <span className="text-slate-400">·</span>{" "}
                        <span className="font-mono text-xs text-slate-500">{t.service}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-500">
                        {t.traceId.slice(0, 16)}… · {t.spanCount} span{t.spanCount === 1 ? "" : "s"} · {t.durationMs}ms ·{" "}
                        {new Date(t.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        t.status === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
                      }`}
                    >
                      {t.status}
                    </span>
                  </button>
                  {open && (
                    <div className="mt-3 grid gap-1">
                      {tSpans.length === 0 ? (
                        <p className="text-xs text-slate-400">No spans.</p>
                      ) : (
                        tSpans.map((s) => (
                          <div key={s.id} className="rounded-lg border border-violet-100 bg-violet-50/30 px-3 py-1.5 text-xs font-mono flex items-center gap-2">
                            <span className="text-slate-400">{s.parentSpanId ? "↳" : "●"}</span>
                            <span className="flex-1 text-slate-800 truncate">{s.name}</span>
                            <span className="text-slate-500">{s.durationMs}ms</span>
                            <span className={s.status === "ok" ? "text-emerald-700" : "text-rose-700"}>{s.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="grid gap-4">
          <div className="rounded-3xl border border-violet-200 bg-white p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Tamper-evidence check</div>
              <p className="text-xs text-slate-500 mt-1">
                Re-hashes the entire chain and confirms each link matches its <code className="text-violet-700">prevHash</code>.
              </p>
              {verify && (
                <p className={`mt-2 text-xs font-mono ${verify.ok ? "text-emerald-700" : "text-rose-700"}`}>
                  {verify.ok ? (
                    <CheckCircle2 size={12} className="inline mr-1" />
                  ) : (
                    <AlertCircle size={12} className="inline mr-1" />
                  )}
                  {verify.ok
                    ? `Verified ${verify.checked} entries.`
                    : `Chain broken — first bad entry at ${verify.firstBadAt ?? "(unknown)"}`}
                </p>
              )}
            </div>
            <button onClick={runVerify} disabled={verifying} className={marketingPrimaryCtaSm}>
              {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Verify chain
            </button>
          </div>

          {audit.length === 0 ? (
            <div className="rounded-3xl border border-violet-100 bg-white p-12 text-center">
              <ShieldCheck size={28} className="mx-auto text-violet-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">No audit entries yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Every policy change, key rotation, and elevated capability call appends here.
              </p>
            </div>
          ) : (
            <ul className="grid gap-1.5">
              {audit.map((a) => (
                <li key={a.id} className="rounded-xl border border-violet-100 bg-white px-4 py-3 grid grid-cols-[140px_1fr_auto] gap-3 items-center text-xs">
                  <span className="font-mono text-slate-500">{new Date(a.ts).toLocaleString()}</span>
                  <div>
                    <div className="font-semibold text-slate-900">{a.action}</div>
                    {a.target && <div className="text-[11px] font-mono text-slate-500 truncate">{a.target}</div>}
                  </div>
                  <span className="font-mono text-[10px] text-slate-400" title={a.hash}>
                    {a.hash.slice(0, 10)}…
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
