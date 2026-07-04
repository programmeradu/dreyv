"use client";

/**
 * Webhooks panel — create, rotate, test-fire, replay, browse deliveries.
 * All backed by webhooks.* registry capabilities via /api/owner/run.
 */
import React, { useCallback, useEffect, useState } from "react";
import { runCapability } from "@/lib/owner/client";
import { toast } from "@/lib/toast-notifications";
import {
  Plus,
  Loader2,
  RotateCw,
  Send,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
  Power,
  Webhook as WebhookIcon,
} from "lucide-react";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

interface Hook {
  id: string;
  label: string;
  targetUrl: string;
  events: string;
  active: boolean;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  failureStreak: number;
  createdAt: string;
}
interface Delivery {
  id: string;
  webhookId: string;
  event: string;
  attempt: number;
  status: string;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

const COMMON_EVENTS = [
  "intent.submitted",
  "intent.executed",
  "intent.failed",
  "status.incident_opened",
  "status.incident_updated",
  "status.incident_resolved",
  "status.maintenance_scheduled",
  "workflow.run_finished",
];

export function WebhooksPanel() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ label: "", targetUrl: "", events: "*" });
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, d] = await Promise.all([
        runCapability<{ webhooks: Hook[] }>("webhooks.list"),
        runCapability<{ deliveries: Delivery[] }>("webhooks.deliveries", { limit: 30 }),
      ]);
      setHooks(h.webhooks ?? []);
      setDeliveries(d.deliveries ?? []);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const events = form.events
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await runCapability<{ webhook: Hook & { signingSecret?: string } }>("webhooks.create", {
        label: form.label,
        targetUrl: form.targetUrl,
        events,
      });
      const secret = (res.webhook as { signingSecret?: string }).signingSecret;
      if (secret) setRevealed({ id: res.webhook.id, secret });
      toast.success("Webhook created — secret shown once.");
      setForm({ label: "", targetUrl: "", events: "*" });
      setShowCreate(false);
      void load();
    } catch (e) {
      toast.error(`Create failed: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function rotate(id: string) {
    if (!confirm("Rotate signing secret? The old one stops working immediately.")) return;
    try {
      const res = await runCapability<{ webhook: { id: string; signingSecret: string } }>("webhooks.rotate_secret", { id });
      setRevealed({ id, secret: res.webhook.signingSecret });
      toast.success("Secret rotated.");
      void load();
    } catch (e) {
      toast.error(`Rotate failed: ${(e as Error).message}`);
    }
  }

  async function fire(id: string) {
    setTesting(id);
    try {
      await runCapability("webhooks.test", { id, event: "test.ping" });
      toast.success("Test event dispatched.");
      setTimeout(load, 800);
    } catch (e) {
      toast.error(`Test failed: ${(e as Error).message}`);
    } finally {
      setTesting(null);
    }
  }

  async function toggle(h: Hook) {
    try {
      await runCapability("webhooks.update", { id: h.id, active: !h.active });
      toast.success(h.active ? "Disabled." : "Enabled.");
      void load();
    } catch (e) {
      toast.error(`Toggle failed: ${(e as Error).message}`);
    }
  }

  async function remove(h: Hook) {
    if (!confirm(`Delete webhook "${h.label}"?`)) return;
    try {
      await runCapability("webhooks.delete", { id: h.id });
      toast.success("Deleted.");
      void load();
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  }

  async function replay(deliveryId: string) {
    try {
      await runCapability("webhooks.replay", { deliveryId });
      toast.success("Replay queued.");
      setTimeout(load, 800);
    } catch (e) {
      toast.error(`Replay failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-600 max-w-xl">
          Subscribe HTTPS endpoints to event streams. Events are signed with HMAC-SHA256 over <code className="text-violet-700">{`${"${"}t${"}"}.${"${"}rawBody${"}"}`}</code> and retried 3× on failure (immediate, +2s, +8s).
        </p>
        <button onClick={() => setShowCreate((v) => !v)} className={marketingPrimaryCtaSm}>
          <Plus size={14} /> {showCreate ? "Cancel" : "New webhook"}
        </button>
      </div>

      {revealed && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs">
          <div className="flex items-center gap-2 font-semibold text-amber-900">
            <AlertCircle size={14} /> Save this signing secret now — it is shown once.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 font-mono text-amber-900 break-all bg-white rounded px-3 py-2">{revealed.secret}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(revealed.secret);
                toast.success("Copied.");
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-amber-300 bg-white text-amber-900"
            >
              <Copy size={12} /> Copy
            </button>
            <button onClick={() => setRevealed(null)} className="text-xs text-amber-900/70 hover:text-amber-900 px-2">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <form onSubmit={create} className="rounded-3xl border border-violet-200 bg-white p-6 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">
            Label
            <input
              required
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Production alerts"
              className="mt-1 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Target URL (https://)
            <input
              required
              type="url"
              value={form.targetUrl}
              onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))}
              placeholder="https://your-app.com/hooks/dreyv"
              className="mt-1 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="md:col-span-2 text-xs font-semibold text-slate-700">
            Events (comma-separated, use <code className="text-violet-700">*</code> for all)
            <input
              required
              value={form.events}
              onChange={(e) => setForm((f) => ({ ...f, events: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm font-mono"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {COMMON_EVENTS.map((ev) => (
                <button
                  type="button"
                  key={ev}
                  onClick={() =>
                    setForm((f) => {
                      const cur = f.events
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s && s !== "*");
                      if (cur.includes(ev)) return f;
                      return { ...f, events: [...cur, ev].join(",") };
                    })
                  }
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100"
                >
                  + {ev}
                </button>
              ))}
            </div>
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" disabled={creating} className={marketingPrimaryCtaSm}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create webhook
            </button>
          </div>
        </form>
      )}

      <section>
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3">Webhooks</h3>
        {loading ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-8 text-center text-sm text-slate-500">
            <Loader2 size={14} className="inline animate-spin mr-2" />
            Loading…
          </div>
        ) : hooks.length === 0 ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-12 text-center">
            <WebhookIcon size={28} className="mx-auto text-violet-400" />
            <p className="mt-3 text-sm font-semibold text-slate-900">No webhooks yet</p>
            <p className="mt-1 text-xs text-slate-500">Create one to get push notifications for intents, incidents, and workflow runs.</p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {hooks.map((h) => (
              <li key={h.id} className="rounded-2xl border border-violet-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{h.label}</span>
                      {!h.active && (
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-500">
                          paused
                        </span>
                      )}
                      {h.failureStreak > 0 && (
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
                          {h.failureStreak} fail{h.failureStreak === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-600 break-all">{h.targetUrl}</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      <span className="font-mono">{h.events}</span>
                      {h.lastDeliveryAt && ` · last: ${h.lastStatus} ${new Date(h.lastDeliveryAt).toLocaleString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fire(h.id)}
                      disabled={testing === h.id}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50"
                    >
                      {testing === h.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Test
                    </button>
                    <button
                      onClick={() => rotate(h.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-slate-700 hover:bg-violet-50"
                    >
                      <RotateCw size={12} /> Rotate
                    </button>
                    <button
                      onClick={() => toggle(h)}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-violet-200 text-slate-600 hover:bg-violet-50"
                      title={h.active ? "Pause" : "Activate"}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      onClick={() => remove(h)}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3">Recent deliveries</h3>
        {deliveries.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No deliveries yet — fire a test to see one here.</p>
        ) : (
          <ul className="grid gap-1.5">
            {deliveries.map((d) => (
              <li key={d.id} className="rounded-xl border border-violet-100 bg-white px-4 py-2.5 grid grid-cols-[24px_1fr_auto_auto] gap-3 items-center text-xs">
                {d.status === "ok" ? (
                  <CheckCircle2 size={14} className="text-emerald-600" />
                ) : d.status === "failed" ? (
                  <AlertCircle size={14} className="text-rose-600" />
                ) : (
                  <Clock size={14} className="text-amber-600" />
                )}
                <div className="min-w-0">
                  <div className="font-mono text-slate-900 truncate">
                    {d.event} <span className="text-slate-400">·</span> attempt {d.attempt}
                    {d.httpStatus && <span className="text-slate-400"> · {d.httpStatus}</span>}
                    {d.latencyMs != null && <span className="text-slate-400"> · {d.latencyMs}ms</span>}
                  </div>
                  {d.error && <div className="text-[10px] text-rose-700 truncate">{d.error}</div>}
                </div>
                <span className="font-mono text-[10px] text-slate-400">{new Date(d.createdAt).toLocaleString()}</span>
                <button
                  onClick={() => replay(d.id)}
                  className="text-[11px] font-semibold text-violet-700 hover:text-violet-900"
                >
                  Replay
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
