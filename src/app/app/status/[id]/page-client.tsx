"use client";

/**
 * /app/status/[id] — Manage one status page: incidents, maintenance, subscribers.
 * Backed entirely by sla.* registry capabilities via /api/owner/run.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { runCapability } from "@/lib/owner/client";
import { toast } from "@/lib/toast-notifications";
import {
  ArrowLeft,
  Loader2,
  Plus,
  AlertCircle,
  CalendarClock,
  Users,
  Send,
  X,
  CheckCircle2,
} from "lucide-react";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

interface PageRow {
  id: string;
  slug: string;
  title: string;
  isPublic: boolean;
  components: unknown;
}
interface Incident {
  id: string;
  title: string;
  status: string;
  severity: string;
  impact: string;
  startedAt: string;
  resolvedAt: string | null;
}
interface Maintenance {
  id: string;
  title: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
}
interface Subscriber {
  id: string;
  channel: string;
  target: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
}

type Tab = "incidents" | "maintenance" | "subscribers";

export function StatusPageManageClient({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<PageRow | null>(null);
  const [tab, setTab] = useState<Tab>("incidents");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [maint, setMaint] = useState<Maintenance[]>([]);
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);

  // forms
  const [incForm, setIncForm] = useState({ title: "", severity: "minor", impact: "degraded", body: "" });
  const [incBusy, setIncBusy] = useState(false);
  const [updForm, setUpdForm] = useState<{ open: string | null; status: string; body: string }>({
    open: null,
    status: "investigating",
    body: "",
  });
  const [mForm, setMForm] = useState({ title: "", body: "", scheduledStart: "", scheduledEnd: "" });
  const [mBusy, setMBusy] = useState(false);
  const [sForm, setSForm] = useState({ channel: "email", target: "", autoConfirm: true });
  const [sBusy, setSBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await runCapability<{ page: PageRow }>("sla.pages_get", { id: pageId });
      setPage(p.page);
      const [i, m, s] = await Promise.all([
        runCapability<{ incidents: Incident[] }>("sla.incidents_list", { pageId, limit: 50 }),
        runCapability<{ maintenance: Maintenance[] }>("sla.maintenance_list", { pageId, limit: 50 }),
        runCapability<{ subscribers: Subscriber[] }>("sla.subscribers_list", {
          pageId,
          includeUnsubscribed: true,
          limit: 200,
        }),
      ]);
      setIncidents(i.incidents ?? []);
      setMaint(m.maintenance ?? []);
      setSubs(s.subscribers ?? []);
    } catch (e) {
      toast.error(`Failed to load page: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openIncident(e: React.FormEvent) {
    e.preventDefault();
    setIncBusy(true);
    try {
      await runCapability("sla.incidents_open", {
        pageId,
        title: incForm.title,
        severity: incForm.severity,
        impact: incForm.impact,
        body: incForm.body || undefined,
      });
      toast.success("Incident opened.");
      setIncForm({ title: "", severity: "minor", impact: "degraded", body: "" });
      void load();
    } catch (e) {
      toast.error(`Open failed: ${(e as Error).message}`);
    } finally {
      setIncBusy(false);
    }
  }

  async function postUpdate(incidentId: string) {
    try {
      await runCapability("sla.incidents_update", {
        id: incidentId,
        status: updForm.status,
        body: updForm.body,
      });
      toast.success("Update posted.");
      setUpdForm({ open: null, status: "investigating", body: "" });
      void load();
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  }

  async function scheduleMaint(e: React.FormEvent) {
    e.preventDefault();
    setMBusy(true);
    try {
      await runCapability("sla.maintenance_schedule", {
        pageId,
        title: mForm.title,
        body: mForm.body || undefined,
        scheduledStart: new Date(mForm.scheduledStart).toISOString(),
        scheduledEnd: new Date(mForm.scheduledEnd).toISOString(),
      });
      toast.success("Maintenance scheduled.");
      setMForm({ title: "", body: "", scheduledStart: "", scheduledEnd: "" });
      void load();
    } catch (e) {
      toast.error(`Schedule failed: ${(e as Error).message}`);
    } finally {
      setMBusy(false);
    }
  }

  async function cancelMaint(id: string) {
    if (!confirm("Cancel this maintenance window?")) return;
    try {
      await runCapability("sla.maintenance_cancel", { id });
      toast.success("Cancelled.");
      void load();
    } catch (e) {
      toast.error(`Cancel failed: ${(e as Error).message}`);
    }
  }

  async function addSub(e: React.FormEvent) {
    e.preventDefault();
    setSBusy(true);
    try {
      await runCapability("sla.subscribers_add", {
        pageId,
        channel: sForm.channel,
        target: sForm.target.trim(),
        autoConfirm: sForm.autoConfirm,
      });
      toast.success("Subscriber added.");
      setSForm({ channel: "email", target: "", autoConfirm: true });
      void load();
    } catch (e) {
      toast.error(`Add failed: ${(e as Error).message}`);
    } finally {
      setSBusy(false);
    }
  }

  async function removeSub(s: Subscriber) {
    if (!confirm(`Remove ${s.target}?`)) return;
    try {
      await runCapability("sla.subscribers_remove", { id: s.id });
      toast.success("Removed.");
      void load();
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`);
    }
  }

  const components = useMemo(
    () => (Array.isArray(page?.components) ? (page!.components as Array<{ id: string; name: string }>) : []),
    [page],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 font-manrope">
      <Link
        href="/app/status"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-700"
      >
        <ArrowLeft size={12} /> All status pages
      </Link>

      <header className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {page?.title ?? (loading ? "Loading…" : "Status page")}
          </h1>
          {page && (
            <p className="mt-1 text-xs text-slate-500 font-mono">
              /status/{page.slug} · {components.length} component{components.length === 1 ? "" : "s"} ·{" "}
              {page.isPublic ? "Published" : "Draft"}
            </p>
          )}
        </div>
      </header>

      <div className="mb-6 flex gap-2 border-b border-violet-100">
        {(["incidents", "maintenance", "subscribers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "incidents" && <AlertCircle size={12} className="inline mr-1" />}
            {t === "maintenance" && <CalendarClock size={12} className="inline mr-1" />}
            {t === "subscribers" && <Users size={12} className="inline mr-1" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-3xl border border-violet-100 bg-white p-10 text-center text-sm text-slate-500">
          <Loader2 size={16} className="inline animate-spin mr-2" />
          Loading…
        </div>
      ) : tab === "incidents" ? (
        <div className="grid gap-6">
          <form onSubmit={openIncident} className="rounded-3xl border border-violet-200 bg-white p-6 grid gap-3 md:grid-cols-2">
            <h3 className="md:col-span-2 text-sm font-semibold text-slate-900">Open a new incident</h3>
            <input
              required
              placeholder="Title (e.g. Elevated 5xx on /api/v1/portfolio)"
              value={incForm.title}
              onChange={(e) => setIncForm((f) => ({ ...f, title: e.target.value }))}
              className="md:col-span-2 rounded-xl border border-violet-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <select
              value={incForm.severity}
              onChange={(e) => setIncForm((f) => ({ ...f, severity: e.target.value }))}
              className="rounded-xl border border-violet-200 px-3 py-2 text-sm bg-white"
            >
              <option value="minor">Severity · minor</option>
              <option value="major">Severity · major</option>
              <option value="critical">Severity · critical</option>
            </select>
            <select
              value={incForm.impact}
              onChange={(e) => setIncForm((f) => ({ ...f, impact: e.target.value }))}
              className="rounded-xl border border-violet-200 px-3 py-2 text-sm bg-white"
            >
              <option value="none">Impact · none</option>
              <option value="degraded">Impact · degraded</option>
              <option value="partial_outage">Impact · partial outage</option>
              <option value="major_outage">Impact · major outage</option>
            </select>
            <textarea
              rows={2}
              placeholder="First update body (optional but recommended)"
              value={incForm.body}
              onChange={(e) => setIncForm((f) => ({ ...f, body: e.target.value }))}
              className="md:col-span-2 rounded-xl border border-violet-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" disabled={incBusy} className={marketingPrimaryCtaSm}>
                {incBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Open incident
              </button>
            </div>
          </form>

          {incidents.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No incidents yet — nice.</p>
          ) : (
            <ul className="grid gap-3">
              {incidents.map((i) => (
                <li key={i.id} className="rounded-2xl border border-violet-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{i.title}</div>
                      <div className="mt-1 text-[11px] font-mono uppercase tracking-wider text-slate-500">
                        {i.status} · {i.severity} · {i.impact} · started {new Date(i.startedAt).toLocaleString()}
                        {i.resolvedAt && ` · resolved ${new Date(i.resolvedAt).toLocaleString()}`}
                      </div>
                    </div>
                    {i.status !== "resolved" && (
                      <button
                        onClick={() =>
                          setUpdForm((f) =>
                            f.open === i.id ? { open: null, status: i.status, body: "" } : { open: i.id, status: i.status, body: "" },
                          )
                        }
                        className="text-xs font-semibold text-violet-700 hover:text-violet-900"
                      >
                        Post update
                      </button>
                    )}
                  </div>

                  {updForm.open === i.id && (
                    <div className="mt-3 grid gap-2 md:grid-cols-[160px_1fr_auto]">
                      <select
                        value={updForm.status}
                        onChange={(e) => setUpdForm((f) => ({ ...f, status: e.target.value }))}
                        className="rounded-xl border border-violet-200 px-3 py-2 text-sm bg-white"
                      >
                        <option value="investigating">Investigating</option>
                        <option value="identified">Identified</option>
                        <option value="monitoring">Monitoring</option>
                        <option value="resolved">Resolved</option>
                      </select>
                      <input
                        placeholder="What's the update?"
                        value={updForm.body}
                        onChange={(e) => setUpdForm((f) => ({ ...f, body: e.target.value }))}
                        className="rounded-xl border border-violet-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
                      />
                      <button
                        onClick={() => postUpdate(i.id)}
                        disabled={!updForm.body.trim()}
                        className={marketingPrimaryCtaSm}
                      >
                        <Send size={12} /> Post
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === "maintenance" ? (
        <div className="grid gap-6">
          <form onSubmit={scheduleMaint} className="rounded-3xl border border-violet-200 bg-white p-6 grid gap-3 md:grid-cols-2">
            <h3 className="md:col-span-2 text-sm font-semibold text-slate-900">Schedule maintenance</h3>
            <input
              required
              placeholder="Title (e.g. Postgres failover drill)"
              value={mForm.title}
              onChange={(e) => setMForm((f) => ({ ...f, title: e.target.value }))}
              className="md:col-span-2 rounded-xl border border-violet-200 px-3 py-2 text-sm"
            />
            <label className="text-xs text-slate-600">
              Start
              <input
                required
                type="datetime-local"
                value={mForm.scheduledStart}
                onChange={(e) => setMForm((f) => ({ ...f, scheduledStart: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              End
              <input
                required
                type="datetime-local"
                value={mForm.scheduledEnd}
                onChange={(e) => setMForm((f) => ({ ...f, scheduledEnd: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm"
              />
            </label>
            <textarea
              rows={2}
              placeholder="Body (impact, what to expect)"
              value={mForm.body}
              onChange={(e) => setMForm((f) => ({ ...f, body: e.target.value }))}
              className="md:col-span-2 rounded-xl border border-violet-200 px-3 py-2 text-sm"
            />
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" disabled={mBusy} className={marketingPrimaryCtaSm}>
                {mBusy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                Schedule
              </button>
            </div>
          </form>

          {maint.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No maintenance windows scheduled.</p>
          ) : (
            <ul className="grid gap-3">
              {maint.map((m) => (
                <li key={m.id} className="rounded-2xl border border-violet-200 bg-white p-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900 text-sm">{m.title}</div>
                    <div className="mt-1 text-[11px] font-mono uppercase tracking-wider text-slate-500">
                      {m.status} · {new Date(m.scheduledStart).toLocaleString()} →{" "}
                      {new Date(m.scheduledEnd).toLocaleString()}
                    </div>
                  </div>
                  {m.status === "scheduled" && (
                    <button
                      onClick={() => cancelMaint(m.id)}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-800"
                    >
                      Cancel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid gap-6">
          <form onSubmit={addSub} className="rounded-3xl border border-violet-200 bg-white p-6 grid gap-3 md:grid-cols-[140px_1fr_auto]">
            <h3 className="md:col-span-3 text-sm font-semibold text-slate-900">Add subscriber</h3>
            <select
              value={sForm.channel}
              onChange={(e) => setSForm((f) => ({ ...f, channel: e.target.value }))}
              className="rounded-xl border border-violet-200 px-3 py-2 text-sm bg-white"
            >
              <option value="email">Email</option>
              <option value="webhook">Webhook URL</option>
            </select>
            <input
              required
              placeholder={sForm.channel === "email" ? "ops@acme.com" : "https://example.com/hooks/status"}
              value={sForm.target}
              onChange={(e) => setSForm((f) => ({ ...f, target: e.target.value }))}
              className="rounded-xl border border-violet-200 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={sBusy} className={marketingPrimaryCtaSm}>
              {sBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add
            </button>
            <label className="md:col-span-3 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={sForm.autoConfirm}
                onChange={(e) => setSForm((f) => ({ ...f, autoConfirm: e.target.checked }))}
              />
              Skip confirmation (you own this destination)
            </label>
          </form>

          {subs.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No subscribers yet.</p>
          ) : (
            <ul className="grid gap-2">
              {subs.map((s) => (
                <li key={s.id} className="rounded-2xl border border-violet-200 bg-white p-4 flex items-center gap-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700">
                    {s.channel}
                  </span>
                  <span className="flex-1 font-mono text-xs text-slate-800 break-all">{s.target}</span>
                  {s.unsubscribedAt ? (
                    <span className="text-[11px] text-slate-400">unsubscribed</span>
                  ) : s.confirmedAt ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                      <CheckCircle2 size={12} /> confirmed
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-600">pending confirm</span>
                  )}
                  <button
                    onClick={() => removeSub(s)}
                    className="text-rose-500 hover:text-rose-700"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
