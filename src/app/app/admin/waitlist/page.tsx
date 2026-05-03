"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Send, Search, Download, RefreshCw } from "lucide-react";

type Row = {
  id: string;
  email: string;
  name: string | null;
  organization: string | null;
  role: string | null;
  orgType: string | null;
  chains: string[] | null;
  currentStack: string | null;
  aumBand: string | null;
  useCase: string | null;
  referralSource: string | null;
  status: "pending" | "invited" | "onboarded" | "rejected";
  position: number;
  invitedAt: string | null;
  onboardedAt: string | null;
  createdAt: string;
};

type Kpis = {
  total: number;
  pending: number;
  invited: number;
  onboarded: number;
  rejected: number;
  conversion: number;
  last7d: number;
};

const STATUSES = ["", "pending", "invited", "onboarded", "rejected"] as const;
const ORG_TYPES = ["", "dao", "fund", "protocol", "startup", "solo"] as const;

export default function AdminWaitlistPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [orgType, setOrgType] = useState<string>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [confirmInvite, setConfirmInvite] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (status) sp.set("status", status);
      if (orgType) sp.set("orgType", orgType);
      if (q) sp.set("q", q);
      sp.set("limit", "100");
      const res = await fetch(`/api/admin/waitlist?${sp.toString()}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error("Admin access required.");
        throw new Error(`Failed to load (${res.status})`);
      }
      const data = await res.json();
      setRows(data.rows || []);
      setKpis(data.kpis || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, orgType]);

  const allOnPageSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );

  function toggleAll() {
    if (allOnPageSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function sendInvites() {
    if (selected.size === 0) return;
    setInviting(true);
    try {
      const res = await fetch("/api/waitlist/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setSelected(new Set());
      setConfirmInvite(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  function exportCsv() {
    if (rows.length === 0) return;
    const headers = [
      "position", "email", "name", "organization", "role", "orgType", "chains",
      "currentStack", "aumBand", "useCase", "referralSource", "status",
      "invitedAt", "onboardedAt", "createdAt",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : Array.isArray(v) ? v.join("|") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        headers.map((h) => escape((r as Record<string, unknown>)[h])).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusPill: Record<Row["status"], string> = {
    pending: "bg-violet-50 text-violet-700 border-violet-200",
    invited: "bg-amber-50 text-amber-700 border-amber-200",
    onboarded: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
  };

  return (
    <main className="relative isolate h-full overflow-y-auto bg-white text-slate-900">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[460px] w-[1100px] rounded-full bg-violet-300/25 blur-[160px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-600" aria-hidden />
              Admin · Waitlist
            </span>
            <h1 className="mt-3 text-3xl lg:text-4xl font-bold tracking-tight">
              Cohort pipeline
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review qualified signups and invite the next cohort.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </header>

        {/* KPIs */}
        <section className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total", value: kpis?.total ?? 0 },
            { label: "Pending", value: kpis?.pending ?? 0 },
            { label: "Invited", value: kpis?.invited ?? 0 },
            { label: "Onboarded", value: kpis?.onboarded ?? 0 },
            { label: "Conversion", value: `${kpis?.conversion ?? 0}%` },
            { label: "Last 7d", value: kpis?.last7d ?? 0 },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-violet-200 bg-white/85 p-4 backdrop-blur"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {k.label}
              </p>
              <p className="mt-1 text-2xl font-bold text-violet-700">{k.value}</p>
            </div>
          ))}
        </section>

        {/* Filters */}
        <section className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-white/85 p-3 backdrop-blur">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Search email, org, name…"
              className="w-full rounded-lg border border-violet-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? s : "All statuses"}</option>
            ))}
          </select>
          <select
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm"
          >
            {ORG_TYPES.map((s) => (
              <option key={s} value={s}>{s ? s : "All org types"}</option>
            ))}
          </select>
          <button
            onClick={() => setConfirmInvite(true)}
            disabled={selected.size === 0 || inviting}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Invite selected ({selected.size})
          </button>
        </section>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        {/* Table */}
        <section className="mt-6 overflow-hidden rounded-2xl border border-violet-200 bg-white/85 backdrop-blur">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">No entries match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-violet-50/60 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        className="rounded border-violet-300 text-violet-600 focus:ring-violet-400"
                      />
                    </th>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Email / Org</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Chains</th>
                    <th className="px-4 py-3 text-left">AUM</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-violet-100 hover:bg-violet-50/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          className="rounded border-violet-300 text-violet-600 focus:ring-violet-400"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.position}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{r.email}</div>
                        <div className="text-xs text-slate-500">
                          {r.organization || "—"} {r.name ? `· ${r.name}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.role || "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{r.orgType || "—"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {(r.chains || []).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.aumBand || "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPill[r.status]}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Confirm invite modal */}
      {confirmInvite && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !inviting && setConfirmInvite(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-violet-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Send invites?</h2>
            <p className="mt-2 text-sm text-slate-600">
              You're about to send a single-use invite email to{" "}
              <span className="font-semibold text-violet-700">{selected.size}</span> recipient{selected.size === 1 ? "" : "s"}.
              Each link is valid for 14 days.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmInvite(false)}
                disabled={inviting}
                className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-violet-400"
              >
                Cancel
              </button>
              <button
                onClick={sendInvites}
                disabled={inviting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
              >
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
