"use client";

/**
 * API Access Vault — Stitch-light Dreyv aesthetic.
 *
 * Same local-storage backed key ledger, restyled to match Identity / Agent
 * Policy / Sub-agents panels. White surfaces, violet glows, DreyvStar marks,
 * monospace meta, no shadowed dashboard tokens.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Copy, Plus, ShieldCheck, Trash2, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { formatDistanceToNow } from "date-fns";
import { DreyvStar } from "@/components/studio/DreyvStar";

const LS_KEY = "keystone_api_keys";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  secret: string;
  createdAt: number;
  lastUsedAt: number | null;
  env: "live" | "test";
}

function loadKeys(): ApiKey[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function saveKeys(keys: ApiKey[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(keys));
}

function generateKeyString(env: "live" | "test"): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = `dk_${env}_`;
  const randomValues = new Uint32Array(40);
  window.crypto.getRandomValues(randomValues);
  for (let i = 0; i < 40; i++) result += chars.charAt(randomValues[i] % chars.length);
  return result;
}

export const ApiKeysView = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"live" | "test">("live");
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { setKeys(loadKeys()); }, []);

  const handleCreate = () => {
    setCreating(true);
    setTimeout(() => {
      const name = newKeyName.trim() || `Key ${keys.length + 1}`;
      const secret = generateKeyString(newKeyEnv);
      const key: ApiKey = {
        id: `key_${Date.now()}`,
        name,
        prefix: secret.slice(0, 14) + "…",
        secret,
        createdAt: Date.now(),
        lastUsedAt: null,
        env: newKeyEnv,
      };
      const updated = [key, ...keys];
      setKeys(updated);
      saveKeys(updated);
      setJustCreatedId(key.id);
      setShowCreate(false);
      setNewKeyName("");
      setCreating(false);
      toast.success("API key created — copy it now, it won't be shown again.");
    }, 250);
  };

  const handleCopy = useCallback((key: ApiKey) => {
    navigator.clipboard.writeText(key.secret);
    toast.success("API key copied to clipboard");
  }, []);

  const handleRevoke = useCallback((id: string) => {
    const updated = keys.filter((k) => k.id !== id);
    setKeys(updated);
    saveKeys(updated);
    if (justCreatedId === id) setJustCreatedId(null);
    toast.success("API key revoked");
  }, [keys, justCreatedId]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      {/* Hero card */}
      <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />

        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5">
              <DreyvStar size={10} className="text-violet-600" />
              <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">API access</span>
            </div>
            <h2 className="mt-2 text-[24px] sm:text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
              Programmatic <span className="italic font-light text-violet-600">keys</span> for the Dreyv API
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
              Bearer tokens for the public Dreyv API, MCP servers, and CI pipelines. Live keys execute against mainnet — test keys stay sandboxed.
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold transition shadow-[0_12px_30px_-12px_rgba(124,58,237,0.6)]"
          >
            <Plus size={14} /> New key
          </button>
        </div>

        {/* Inline create form */}
        {showCreate && (
          <div className="relative z-10 mt-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5 animate-in fade-in slide-in-from-top-2 duration-300">
            <label className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Key name</label>
            <div className="mt-2 flex gap-2 flex-wrap">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. Production agent · CI bot · Mobile"
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
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-slate-500">
                Treat the secret like a password — Dreyv only displays it once at creation.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition"
                >Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold transition disabled:opacity-60"
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Generate key
                </button>
              </div>
            </div>
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
          <span className="text-[11px] font-mono text-slate-500">{keys.length} {keys.length === 1 ? "key" : "keys"}</span>
        </div>

        {keys.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <KeyRound size={20} className="text-violet-400 mx-auto" />
            <p className="mt-3 text-[13px] text-slate-600">No API keys yet.</p>
            <p className="mt-1 text-[12px] text-slate-500">Generate one to start calling the Dreyv API or MCP server.</p>
          </div>
        ) : (
          <ul className="divide-y divide-violet-100">
            {keys.map((key) => {
              const isFresh = justCreatedId === key.id;
              return (
                <li
                  key={key.id}
                  className={`px-6 py-4 flex items-center gap-4 group transition ${
                    isFresh ? "bg-violet-50/60" : "hover:bg-violet-50/40"
                  }`}
                >
                  <span className="h-9 w-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 shrink-0">
                    <KeyRound size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-slate-900 truncate">{key.name}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-semibold tracking-[0.18em] uppercase ${
                          key.env === "test"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-violet-50 text-violet-700 border-violet-200"
                        }`}
                      >
                        {key.env}
                      </span>
                      {isFresh && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[9px] font-semibold tracking-[0.18em] uppercase">
                          <CheckCircle2 size={10} /> New
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500 font-mono flex-wrap">
                      {isFresh ? (
                        <code className="text-violet-700 select-all break-all">{key.secret}</code>
                      ) : (
                        <span>{key.prefix}<span className="text-slate-300"> ········································</span></span>
                      )}
                      <span className="text-slate-400">·</span>
                      <span>created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}</span>
                      <span className="text-slate-400">·</span>
                      <span>{key.lastUsedAt ? `last used ${formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}` : "never used"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 opacity-60 group-hover:opacity-100 transition">
                    <button
                      onClick={() => handleCopy(key)}
                      className="h-8 w-8 rounded-full border border-violet-100 bg-white text-slate-600 hover:text-violet-700 hover:border-violet-300 hover:bg-violet-50 flex items-center justify-center transition"
                      title="Copy full key"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="h-8 w-8 rounded-full border border-violet-100 bg-white text-slate-500 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 flex items-center justify-center transition"
                      title="Revoke"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Security notice */}
      <section className="rounded-3xl border border-violet-100 bg-white p-5 flex items-start gap-3">
        <span className="h-9 w-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 shrink-0">
          <ShieldCheck size={15} />
        </span>
        <div className="flex-1">
          <h4 className="text-[12px] font-semibold text-slate-900 tracking-tight">Treat keys like signing material</h4>
          <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
            Secrets are shown once. Store them in your secret manager — never commit them to git or paste them into chat. Rotate every 90 days, or immediately if exposure is suspected.
          </p>
        </div>
      </section>
    </div>
  );
};
