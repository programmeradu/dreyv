"use client";

import { useState } from "react";
import { ArrowUpRight, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

type RecordReport = {
  name: string;
  endpoint: string;
  action: "created" | "updated" | "unchanged";
  id: string;
};

type Result =
  | { ok: true; summary: { created: number; updated: number; unchanged: number }; records: RecordReport[] }
  | { ok: false; error: string };

export function DnsAidPublishButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function publish() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/dns-aid/publish", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setResult({ ok: false, error: data.error ?? `Request failed (${res.status})` });
      } else {
        setResult(data as Result);
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Publishing to Cloudflare…
          </>
        ) : (
          <>
            Publish DNS-AID records
            <ArrowUpRight className="h-4 w-4" />
          </>
        )}
      </button>

      {result && !result.ok && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">Publish failed</div>
            <div className="mt-1 break-words font-mono text-xs">{result.error}</div>
          </div>
        </div>
      )}

      {result && result.ok && (
        <div className="space-y-3 rounded-2xl border border-violet-200 bg-white p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-violet-900">
            <CheckCircle2 className="h-4 w-4 text-violet-600" />
            {result.summary.created} created · {result.summary.updated} updated · {result.summary.unchanged} unchanged
          </div>
          <ul className="divide-y divide-violet-100">
            {result.records.map((r) => (
              <li
                key={r.name}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 font-mono text-xs"
              >
                <span className="break-all text-violet-950">{r.name}</span>
                <span className="break-all text-violet-700/80">{r.endpoint}</span>
                <span
                  className={
                    r.action === "created"
                      ? "rounded-full bg-violet-100 px-2 py-0.5 text-violet-800"
                      : r.action === "updated"
                      ? "rounded-full bg-amber-100 px-2 py-0.5 text-amber-800"
                      : "rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"
                  }
                >
                  {r.action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
