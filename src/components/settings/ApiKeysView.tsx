"use client";

/**
 * Dreyv public API + MCP keys — Phase 1 UI.
 *
 * Talks to /api/v1-keys (real, hashed, scoped, rate-limited `dk_live_…` /
 * `dk_test_…` keys). Lets the user mint with scopes, copy the full secret
 * exactly once, revoke, and grab ready-to-paste install snippets for Claude
 * Desktop / Cursor / curl / fetch against /api/v1 and /api/mcp.
 *
 * Distinct from AgentKeysPanel (`dak_…` payment-only keys for the agent).
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Copy,
  Plus,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Terminal,
  Code2,
  Globe,
  BookOpen,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { formatDistanceToNow } from "date-fns";
import { DreyvStar } from "@/components/studio/DreyvStar";

import {
  SCOPE_CATALOG,
  SCOPE_GROUP_LABEL,
  DEFAULT_SCOPE_IDS,
  ALL_SCOPE_IDS,
  READ_ONLY_SCOPE_IDS,
  WRITE_SCOPE_IDS,
  type ScopeGroup,
} from "@/lib/api-keys/scope-catalog";
import type { ApiScope } from "@/lib/api-keys/public-keys";

type ScopeId = ApiScope;
const DEFAULT_SCOPES: ScopeId[] = DEFAULT_SCOPE_IDS;

// Group scopes once for the picker.
const SCOPES_BY_GROUP: Record<ScopeGroup, typeof SCOPE_CATALOG> = SCOPE_CATALOG.reduce(
  (acc, s) => {
    (acc[s.group] ||= [] as unknown as typeof SCOPE_CATALOG).push(s);
    return acc;
  },
  { data: [], write: [], publish: [], payments: [] } as Record<ScopeGroup, typeof SCOPE_CATALOG>,
);

type ScopePreset = "all" | "read" | "write" | "default" | "none";
const PRESETS: { id: ScopePreset; label: string; ids: ScopeId[]; hint: string }[] = [
  { id: "all", label: "All scopes", ids: ALL_SCOPE_IDS, hint: `Grant every capability (${ALL_SCOPE_IDS.length})` },
  { id: "read", label: "Read-only", ids: READ_ONLY_SCOPE_IDS, hint: `Every read:* scope (${READ_ONLY_SCOPE_IDS.length})` },
  { id: "write", label: "Write", ids: WRITE_SCOPE_IDS, hint: `Every write:* scope (${WRITE_SCOPE_IDS.length})` },
  { id: "default", label: "Default", ids: DEFAULT_SCOPE_IDS, hint: "Portfolio + Treasury + Market" },
  { id: "none", label: "Clear", ids: [], hint: "Deselect all scopes" },
];

function arraysEqualAsSet<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

interface ApiKeyRow {
  id: string;
  label: string;
  env: "live" | "test";
  keyPrefix: string;
  scopes: ScopeId[];
  rateLimitRpm: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const ApiKeysView = () => {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"live" | "test">("live");
  const [newKeyScopes, setNewKeyScopes] = useState<ScopeId[]>(DEFAULT_SCOPES);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; fullKey: string } | null>(null);
  const [showInstall, setShowInstall] = useState<"claude" | "cursor" | "curl" | "fetch">("claude");
  const [expandedScopes, setExpandedScopes] = useState<Record<string, boolean>>({});

  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://dreyv.com";
    return window.location.origin;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1-keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      toast.error("Could not load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleScope = (id: ScopeId) =>
    setNewKeyScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const handleCreate = async () => {
    if (newKeyScopes.length === 0) {
      toast.error("Pick at least one scope");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newKeyLabel.trim() || `Dreyv key ${keys.length + 1}`,
          env: newKeyEnv,
          scopes: newKeyScopes,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setRevealed({ id: data.key.id, fullKey: data.key.fullKey });
      setShowCreate(false);
      setNewKeyLabel("");
      setNewKeyScopes(DEFAULT_SCOPES);
      await load();
      toast.success("API key created — copy it now, Dreyv only displays it once.");
    } catch {
      toast.error("Could not create key");
    } finally {
      setCreating(false);
    }
  };

  const handleCopySecret = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success("Copied");
  };

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/v1-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status}`);
      if (revealed?.id === id) setRevealed(null);
      await load();
      toast.success("Key revoked");
    } catch {
      toast.error("Could not revoke key");
    }
  };

  const installKey = revealed?.fullKey ?? "dk_live_YOUR_KEY";

  const snippets: Record<typeof showInstall, string> = {
    claude: JSON.stringify(
      {
        mcpServers: {
          dreyv: {
            url: `${baseUrl}/api/mcp`,
            headers: { Authorization: `Bearer ${installKey}` },
          },
        },
      },
      null,
      2,
    ),
    cursor: JSON.stringify(
      {
        mcpServers: {
          dreyv: {
            url: `${baseUrl}/api/mcp`,
            transport: "http",
            headers: { Authorization: `Bearer ${installKey}` },
          },
        },
      },
      null,
      2,
    ),
    curl: `curl -X POST ${baseUrl}/api/v1/portfolio/holdings \\
  -H "Authorization: Bearer ${installKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"address":"7xK…","chain":"solana"}'`,
    fetch: `const res = await fetch("${baseUrl}/api/v1/market/price", {
  method: "POST",
  headers: {
    Authorization: "Bearer ${installKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ token: "SOL", chain: "solana" }),
});
const { ok, data } = await res.json();`,
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      {/* Developer hub pointer — the full webhooks / usage / docs surface lives at /app/developer */}
      <a
        href="/app/developer"
        className="group flex items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white px-5 py-4 hover:border-violet-400 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-[0_10px_24px_-10px_rgba(124,58,237,0.6)] shrink-0">
            <Code2 size={15} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-900">Open the Developer hub</div>
            <div className="text-[11.5px] text-slate-500 truncate">
              Keys, webhooks, usage, MCP install, OpenAPI & SDK references — all in one place.
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 shrink-0 group-hover:translate-x-0.5 transition-transform">
          Open hub <ArrowUpRight size={13} />
        </span>
      </a>

      {/* Hero */}
      <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />

        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5">
              <DreyvStar size={10} className="text-violet-600" />
              <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">API & MCP access</span>
            </div>
            <h2 className="mt-2 text-[24px] sm:text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
              Programmatic <span className="italic font-light text-violet-600">keys</span> for the Dreyv Web3 API
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
              One key powers both the REST surface at <code className="font-mono text-violet-700">/api/v1</code> and the MCP server at <code className="font-mono text-violet-700">/api/mcp</code>. Live keys execute against mainnet — test keys stay sandboxed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/developers/api"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-violet-200 bg-white text-violet-700 hover:bg-violet-50 text-[12px] font-semibold transition"
            >
              <BookOpen size={13} /> Docs
            </a>
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold transition shadow-[0_12px_30px_-12px_rgba(124,58,237,0.6)]"
            >
              <Plus size={14} /> New key
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="relative z-10 mt-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5 animate-in fade-in slide-in-from-top-2 duration-300">
            <label className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Key label</label>
            <div className="mt-2 flex gap-2 flex-wrap">
              <input
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                placeholder="e.g. Production agent · CI bot · Claude Desktop"
                autoFocus
                className="flex-1 min-w-[220px] rounded-xl border border-violet-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              />
              <div className="flex rounded-xl overflow-hidden border border-violet-200 bg-white">
                <button
                  onClick={() => setNewKeyEnv("live")}
                  className={`px-4 py-2.5 text-[10px] font-semibold tracking-[0.18em] uppercase transition ${
                    newKeyEnv === "live" ? "bg-violet-600 text-white" : "text-slate-500 hover:text-violet-700"
                  }`}
                >Live</button>
                <button
                  onClick={() => setNewKeyEnv("test")}
                  className={`px-4 py-2.5 text-[10px] font-semibold tracking-[0.18em] uppercase transition ${
                    newKeyEnv === "test" ? "bg-amber-500 text-white" : "text-slate-500 hover:text-amber-600"
                  }`}
                >Test</button>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Scopes</label>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Grant the minimum your agent actually needs. You can re-mint any time.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  {newKeyScopes.length} of {ALL_SCOPE_IDS.length} selected
                </span>
              </div>

              {/* Preset chips */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => {
                  const active = arraysEqualAsSet(newKeyScopes, p.ids);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setNewKeyScopes(p.ids)}
                      title={p.hint}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                        active
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-violet-200 bg-white text-slate-700 hover:border-violet-400 hover:text-violet-700"
                      }`}
                    >
                      {p.label}
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono ${
                          active ? "bg-white/20 text-white" : "bg-violet-50 text-violet-700"
                        }`}
                      >
                        {p.ids.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Grouped picker */}
              <div className="mt-4 space-y-4">
                {(Object.keys(SCOPES_BY_GROUP) as ScopeGroup[]).map((group) => {
                  const items = SCOPES_BY_GROUP[group];
                  if (!items.length) return null;
                  const groupIds = items.map((s) => s.id);
                  const selectedInGroup = groupIds.filter((id) => newKeyScopes.includes(id)).length;
                  const allSelected = selectedInGroup === groupIds.length;
                  const someSelected = selectedInGroup > 0 && !allSelected;

                  const toggleGroup = () =>
                    setNewKeyScopes((prev) => {
                      const set = new Set(prev);
                      if (allSelected) {
                        groupIds.forEach((id) => set.delete(id));
                      } else {
                        groupIds.forEach((id) => set.add(id));
                      }
                      return Array.from(set);
                    });

                  return (
                    <div key={group} className="rounded-2xl border border-violet-100 bg-white/70 p-3 sm:p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-700 truncate">
                            {SCOPE_GROUP_LABEL[group]}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {selectedInGroup}/{groupIds.length}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={toggleGroup}
                          className="text-[11px] font-semibold text-violet-700 hover:text-violet-900 transition shrink-0"
                        >
                          {allSelected ? "Deselect all" : someSelected ? "Select rest" : "Select all"}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {items.map((s) => {
                          const active = newKeyScopes.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggleScope(s.id)}
                              className={`text-left rounded-xl border p-3 transition ${
                                active
                                  ? "border-violet-400 bg-white"
                                  : "border-violet-100 bg-white/60 hover:border-violet-300"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[12px] font-semibold text-slate-900 leading-snug">
                                  {s.label}
                                </span>
                                <span
                                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-md border flex items-center justify-center ${
                                    active
                                      ? "bg-violet-600 border-violet-600 text-white"
                                      : "border-violet-200 bg-white"
                                  }`}
                                >
                                  {active && <CheckCircle2 size={11} />}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500 leading-snug">{s.desc}</p>
                              <code className="mt-1 block break-all text-[10px] font-mono text-violet-700/80">
                                {s.id}
                              </code>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>


            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-slate-500">
                Dreyv only displays the secret once. Store it in your secret manager immediately.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition"
                >Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={creating || newKeyScopes.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold transition disabled:opacity-60"
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Generate key
                </button>
              </div>
            </div>
          </div>
        )}

        {revealed && (
          <div className="relative z-10 mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 sm:p-5 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-emerald-700">New key — shown once</span>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <code className="flex-1 min-w-[260px] break-all rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-[12px] font-mono text-emerald-700 select-all">
                {revealed.fullKey}
              </code>
              <button
                onClick={() => handleCopySecret(revealed.fullKey)}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold transition"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            <p className="mt-2 text-[11px] text-emerald-700/80">
              After you close this card, only the prefix will remain visible. Re-mint a new key if you lose it.
            </p>
          </div>
        )}
      </section>

      {/* Key ledger */}
      <section className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-violet-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <DreyvStar size={9} className="text-violet-600" />
            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Active keys</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            {loading ? "loading…" : `${keys.length} ${keys.length === 1 ? "key" : "keys"}`}
          </span>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center">
            <Loader2 size={18} className="text-violet-500 animate-spin mx-auto" />
          </div>
        ) : keys.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <KeyRound size={20} className="text-violet-400 mx-auto" />
            <p className="mt-3 text-[13px] text-slate-600">No API keys yet.</p>
            <p className="mt-1 text-[12px] text-slate-500">Generate one to start calling the Dreyv API or MCP server.</p>
          </div>
        ) : (
          <ul className="divide-y divide-violet-50">
            {keys.map((key) => {
              const isFresh = revealed?.id === key.id;
              const isRevoked = !!key.revokedAt;
              const expanded = !!expandedScopes[key.id];
              return (
                <li
                  key={key.id}
                  className={`group transition ${
                    isFresh ? "bg-violet-50/50" : isRevoked ? "opacity-55" : "hover:bg-violet-50/30"
                  }`}
                >
                  {/* Single thin row — Apple-style: one line on desktop, wraps on mobile */}
                  <div className="px-5 h-11 flex items-center gap-3 text-[12px]">
                    {/* Status dot — env color, tiny */}
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        isRevoked
                          ? "bg-rose-400"
                          : key.env === "test"
                            ? "bg-amber-500"
                            : "bg-violet-600"
                      }`}
                    />

                    {/* Label — primary identifier */}
                    <span className="font-medium text-slate-900 truncate max-w-[28%]" title={key.label}>
                      {key.label}
                    </span>

                    {/* Prefix — monospace, soft */}
                    <code className="font-mono text-[11.5px] text-slate-400 truncate hidden sm:inline">
                      {key.keyPrefix}
                    </code>

                    {/* Spacer pushes meta right */}
                    <span className="flex-1" />

                    {/* Meta cluster — right aligned, monoline, terse */}
                    <span className="hidden md:inline text-[11px] text-slate-400 tabular-nums">
                      {key.lastUsedAt
                        ? `used ${formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: false })} ago`
                        : "never used"}
                    </span>
                    <span className="hidden lg:inline text-[11px] text-slate-300">·</span>
                    <span className="hidden lg:inline text-[11px] text-slate-400 tabular-nums">
                      {formatDistanceToNow(new Date(key.createdAt), { addSuffix: false })} old
                    </span>
                    <span className="hidden lg:inline text-[11px] text-slate-300">·</span>
                    <span className="hidden lg:inline text-[11px] text-slate-400 tabular-nums">
                      {key.rateLimitRpm} rpm
                    </span>

                    {/* Env / state chip — only when non-default */}
                    {(key.env === "test" || isFresh || isRevoked) && (
                      <span
                        className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold tracking-[0.14em] uppercase ${
                          isRevoked
                            ? "text-rose-600 bg-rose-50"
                            : isFresh
                              ? "text-emerald-700 bg-emerald-50"
                              : "text-amber-700 bg-amber-50"
                        }`}
                      >
                        {isRevoked ? "Revoked" : isFresh ? "New" : "Test"}
                      </span>
                    )}

                    {/* Scopes pill — collapsible */}
                    {key.scopes.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedScopes((prev) => ({ ...prev, [key.id]: !prev[key.id] }))
                        }
                        className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[10.5px] font-medium text-slate-500 hover:text-violet-700 hover:bg-violet-50 transition"
                        title={expanded ? "Hide scopes" : "Show scopes"}
                      >
                        <span className="tabular-nums">{key.scopes.length}</span>
                        <span className="text-slate-400 group-hover:text-current">scopes</span>
                        <ChevronDown
                          size={10}
                          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    )}

                    {/* Revoke — appears on hover, no fixed slot taking space */}
                    {!isRevoked && (
                      <button
                        onClick={() => handleRevoke(key.id)}
                        className="h-7 w-7 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Revoke"
                        aria-label={`Revoke ${key.label}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {/* Expanded scopes — flush, edge-to-edge subtle band */}
                  {expanded && key.scopes.length > 0 && (
                    <div className="px-5 pb-3 -mt-1 flex flex-wrap gap-1">
                      {key.scopes.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-violet-700/80 bg-violet-50"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Install snippets */}
      <section className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-violet-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <DreyvStar size={9} className="text-violet-600" />
            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Install in 30 seconds</span>
          </div>
          <div className="flex rounded-xl overflow-hidden border border-violet-200 bg-white">
            {([
              { id: "claude", label: "Claude Desktop", icon: Terminal },
              { id: "cursor", label: "Cursor", icon: Code2 },
              { id: "curl", label: "curl", icon: Terminal },
              { id: "fetch", label: "fetch", icon: Globe },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = showInstall === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setShowInstall(t.id)}
                  className={`px-3 py-2 text-[10px] font-semibold tracking-[0.16em] uppercase transition inline-flex items-center gap-1.5 ${
                    active ? "bg-violet-600 text-white" : "text-slate-500 hover:text-violet-700"
                  }`}
                >
                  <Icon size={11} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-5">
          {!revealed && (
            <p className="mb-3 text-[11px] text-slate-500">
              Showing a placeholder key. Mint one above to copy a snippet pre-filled with your real secret.
            </p>
          )}
          <div className="relative rounded-2xl border border-violet-100 bg-slate-950 p-4 overflow-x-auto">
            <button
              onClick={() => handleCopySecret(snippets[showInstall])}
              className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-600/90 hover:bg-violet-600 text-white text-[10px] font-semibold transition"
            >
              <Copy size={11} /> Copy
            </button>
            <pre className="text-[12px] leading-relaxed font-mono text-violet-50 whitespace-pre-wrap break-all">{snippets[showInstall]}</pre>
          </div>
          {showInstall === "claude" && (
            <p className="mt-3 text-[11px] text-slate-500">
              Paste into <code className="font-mono text-violet-700">~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) and restart Claude.
            </p>
          )}
          {showInstall === "cursor" && (
            <p className="mt-3 text-[11px] text-slate-500">
              Cursor → Settings → MCP → Add server. Paste the JSON above.
            </p>
          )}
        </div>
      </section>

      {/* Security notice */}
      <section className="rounded-3xl border border-violet-100 bg-white p-5 flex items-start gap-3">
        <span className="h-9 w-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 shrink-0">
          <ShieldCheck size={15} />
        </span>
        <div className="flex-1">
          <h4 className="text-[12px] font-semibold text-slate-900 tracking-tight">Treat keys like signing material</h4>
          <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
            Secrets are shown once. Store them in your secret manager — never commit them to git or paste them into chat. Rotate every 90 days, or immediately if exposure is suspected. Distinct from your <code className="font-mono text-violet-700">dak_…</code> agent payment keys below.
          </p>
        </div>
      </section>
    </div>
  );
};
