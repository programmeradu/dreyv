"use client";

import React, { useEffect, useState } from "react";
import { Workflow, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AdminMetricsPanel } from "@/components/admin/AdminMetricsPanel";

type HealthData = {
  status: "healthy" | "warning" | "down";
  env: { lovableApiKey: boolean; inngestApiKey: boolean; inngestSigningKey: boolean };
  serve: { url: string | null; reachable: boolean; appId?: string; functionCount?: number; error?: string };
  gateway: { verified: boolean; outcome?: string; latencyMs?: number; error?: string };
  runs: { queried: boolean; count?: number; lastRunAt?: string | null; error?: string };
  note: string;
  checkedAt: string;
};

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 size={13} className="text-violet-600" />;
  if (warn) return <AlertTriangle size={13} className="text-amber-600" />;
  return <XCircle size={13} className="text-rose-600" />;
}

function Row({ label, value, ok, warn }: { label: string; value: React.ReactNode; ok: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <div className="flex items-center gap-2 text-slate-600">
        <StatusDot ok={ok} warn={warn} />
        <span>{label}</span>
      </div>
      <span className="font-mono text-[11px] text-slate-700 truncate max-w-[55%] text-right">{value}</span>
    </div>
  );
}

export function InngestHealthPanel() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);
      const r = await fetch("/api/admin/inngest-health", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const status = data?.status ?? (err ? "down" : "warning");

  return (
    <AdminMetricsPanel
      title="Inngest agent runtime"
      icon={<Workflow size={16} />}
      status={status === "healthy" ? "healthy" : status === "warning" ? "warning" : "warning"}
      className="lg:col-span-2"
    >
      {loading && !data ? (
        <p className="text-[11px] text-slate-500">Probing serve endpoint, gateway and Management API…</p>
      ) : err ? (
        <p className="text-[12px] text-rose-600">{err}</p>
      ) : data ? (
        <div className="space-y-1">
          <Row
            label="Gateway credentials"
            value={data.gateway.verified ? `verified · ${data.gateway.latencyMs ?? "?"}ms` : (data.gateway.error ?? "unverified")}
            ok={data.gateway.verified}
          />
          <Row
            label="Serve endpoint /api/inngest"
            value={
              data.serve.reachable
                ? `${data.serve.functionCount ?? "?"} functions${data.serve.appId ? ` · ${data.serve.appId}` : ""}`
                : (data.serve.error ?? "unreachable")
            }
            ok={data.serve.reachable}
          />
          <Row
            label="Recent events (Management API)"
            value={
              data.runs.queried && !data.runs.error
                ? `${data.runs.count ?? 0} in last batch${data.runs.lastRunAt ? ` · last ${new Date(data.runs.lastRunAt).toLocaleTimeString()}` : ""}`
                : (data.runs.error ?? "—")
            }
            ok={Boolean(data.runs.queried && !data.runs.error && (data.runs.count ?? 0) > 0)}
            warn={Boolean(data.runs.queried && !data.runs.error && (data.runs.count ?? 0) === 0)}
          />
          <Row label="LOVABLE_API_KEY" value={data.env.lovableApiKey ? "set" : "missing"} ok={data.env.lovableApiKey} />
          <Row label="INNGEST_API_KEY" value={data.env.inngestApiKey ? "set" : "missing"} ok={data.env.inngestApiKey} />
          <Row label="INNGEST_SIGNING_KEY" value={data.env.inngestSigningKey ? "set" : "missing"} ok={data.env.inngestSigningKey} />

          <p className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-[11px] leading-relaxed text-slate-600">
            {data.note}
          </p>
          <p className="text-[10px] font-mono text-slate-400">checked {new Date(data.checkedAt).toLocaleTimeString()}</p>
        </div>
      ) : null}
    </AdminMetricsPanel>
  );
}
