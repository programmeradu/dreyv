"use client";

/**
 * /app/status — Owner UI for status pages (Phase 30 / Pillar AN).
 *
 * Lists the caller's pages, creates new ones, toggles publish, deletes.
 * Per-page management (incidents/maintenance/subscribers) lives at
 * /app/status/[id]. All mutations go through /api/owner/run → registry
 * handlers, so REST/MCP/UI all share one code path.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { runCapability } from "@/lib/owner/client";
import { toast } from "@/lib/toast-notifications";
import {
  Plus,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Trash2,
  ArrowUpRight,
  Activity,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

interface StatusPage {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  publishedAt: string | null;
  components: unknown;
  createdAt: string;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function StatusOwnerClient() {
  const [pages, setPages] = useState<StatusPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    description: "",
    components: "API,Webhooks,Dashboard",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await runCapability<{ pages: StatusPage[] }>("sla.pages_list");
      setPages(data.pages ?? []);
    } catch (e) {
      toast.error(`Failed to load status pages: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!SLUG_RE.test(form.slug)) {
      toast.error("Slug must be lowercase letters, numbers, and dashes (max 64).");
      return;
    }
    setCreating(true);
    try {
      const components = form.components
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name, i) => ({ id: `c${i + 1}`, name, status: "operational" }));
      await runCapability("sla.pages_create", {
        slug: form.slug,
        title: form.title,
        description: form.description || undefined,
        components,
      });
      toast.success("Status page created.");
      setShowCreate(false);
      setForm({ slug: "", title: "", description: "", components: "API,Webhooks,Dashboard" });
      void load();
    } catch (e) {
      toast.error(`Create failed: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function togglePublish(p: StatusPage) {
    try {
      await runCapability(p.isPublic ? "sla.pages_unpublish" : "sla.pages_publish", { id: p.id });
      toast.success(p.isPublic ? "Page hidden." : "Page published.");
      void load();
    } catch (e) {
      toast.error(`Toggle failed: ${(e as Error).message}`);
    }
  }

  async function remove(p: StatusPage) {
    if (!confirm(`Delete "${p.title}"? This removes all incidents, maintenance and subscribers.`)) return;
    try {
      await runCapability("sla.pages_delete", { id: p.id });
      toast.success("Status page deleted.");
      void load();
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 font-manrope">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-slate-400">
            <DreyvStar size={12} className="text-violet-500" /> Owner · Pillar AN
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Status pages</h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl">
            Public uptime, incidents and scheduled maintenance — visible at <code className="text-violet-700">/status/&lt;slug&gt;</code>.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className={marketingPrimaryCtaSm}
        >
          <Plus size={14} /> {showCreate ? "Cancel" : "New status page"}
        </button>
      </header>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-3xl border border-violet-200 bg-white p-6 mb-8 grid gap-4 md:grid-cols-2"
        >
          <label className="text-xs font-semibold text-slate-700 md:col-span-1">
            Slug
            <input
              required
              autoFocus
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
              placeholder="my-api"
              className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-violet-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-1">
            Title
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="My API Status"
              className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-2">
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Live operational status for your public surfaces."
              className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-2">
            Components (comma-separated)
            <input
              value={form.components}
              onChange={(e) => setForm((f) => ({ ...f, components: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400"
            />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-xs font-medium px-4 py-2.5 rounded-xl text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button type="submit" disabled={creating} className={marketingPrimaryCtaSm}>
              {creating && <Loader2 size={14} className="animate-spin" />}
              Create page
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="rounded-3xl border border-violet-100 bg-white p-10 text-center text-sm text-slate-500">
          <Loader2 size={16} className="inline animate-spin mr-2" />
          Loading pages…
        </div>
      ) : pages.length === 0 ? (
        <div className="rounded-3xl border border-violet-100 bg-white p-12 text-center">
          <Activity size={28} className="mx-auto text-violet-400" />
          <p className="mt-3 text-sm font-semibold text-slate-900">No status pages yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Spin one up to give customers and on-call channels a public source of truth.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {pages.map((p) => {
            const components = Array.isArray(p.components)
              ? (p.components as Array<{ name?: string }>)
              : [];
            return (
              <li
                key={p.id}
                className="rounded-3xl border border-violet-200 bg-white p-5 flex flex-wrap items-center gap-4"
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-slate-900">{p.title}</span>
                    {p.isPublic ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                        Published
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-500">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 font-mono">/status/{p.slug}</div>
                  {components.length > 0 && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      {components.length} component{components.length === 1 ? "" : "s"}:{" "}
                      {components.map((c) => c?.name).filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/app/status/${p.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50"
                  >
                    Manage <ArrowUpRight size={12} />
                  </Link>
                  <button
                    onClick={() => togglePublish(p)}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-slate-700 hover:bg-violet-50"
                  >
                    {p.isPublic ? <EyeOff size={12} /> : <Eye size={12} />}
                    {p.isPublic ? "Unpublish" : "Publish"}
                  </button>
                  {p.isPublic && (
                    <a
                      href={`/status/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-slate-700 hover:bg-violet-50"
                    >
                      View <ExternalLink size={12} />
                    </a>
                  )}
                  <button
                    onClick={() => remove(p)}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
