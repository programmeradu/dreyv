"use client";

import { useCallback, useEffect, useState } from "react";

type FileItem = { root: string; file: string; path: string; bytes: number };
type StmtResult = {
  index: number;
  preview: string;
  ok: boolean;
  error?: string;
  ms: number;
};
type RunResponse = {
  ok: boolean;
  label: string;
  total: number;
  executed: number;
  okCount: number;
  failCount: number;
  results: StmtResult[];
};

const KEY_STORAGE = "dreyv.admin.migration.key";

export default function MigrationsAdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RunResponse | { error: string }>>({});
  const [inlineSql, setInlineSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stopOnError, setStopOnError] = useState(true);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(KEY_STORAGE) : null;
    if (saved) setAdminKey(saved);
    setKeyLoaded(true);
  }, []);

  const persistKey = (v: string) => {
    setAdminKey(v);
    if (typeof window !== "undefined") {
      if (v) window.localStorage.setItem(KEY_STORAGE, v);
      else window.localStorage.removeItem(KEY_STORAGE);
    }
  };

  const loadFiles = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/migrations/run", {
        headers: { "x-admin-key": adminKey },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { files: FileItem[] };
      setFiles(j.files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  const runFile = async (file: string) => {
    if (!adminKey) return;
    if (!confirm(`Run ${file} against the live database?`)) return;
    setRunning(file);
    setError(null);
    try {
      const res = await fetch("/api/admin/migrations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ file, stopOnError }),
      });
      const j = await res.json();
      setResults((prev) => ({ ...prev, [file]: j }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [file]: { error: (e as Error).message } }));
    } finally {
      setRunning(null);
    }
  };

  const runInline = async () => {
    if (!adminKey || !inlineSql.trim()) return;
    if (!confirm("Run the pasted SQL against the live database?")) return;
    setRunning("__inline__");
    setError(null);
    try {
      const res = await fetch("/api/admin/migrations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ sql: inlineSql, stopOnError }),
      });
      const j = await res.json();
      setResults((prev) => ({ ...prev, __inline__: j }));
    } catch (e) {
      setResults((prev) => ({ ...prev, __inline__: { error: (e as Error).message } }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-violet-600">Internal · admin</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">DB migration runner</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Lists every <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">.sql</code> file
            under <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">db-migrations/</code>{" "}
            and <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">migrations/sql/</code>,
            and lets you run them statement-by-statement against{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">DATABASE_URL</code>.
            Migrations should be idempotent (use <code>IF NOT EXISTS</code> etc.) — this is the same
            DB powering production.
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            Admin key (sent as <code>x-admin-key</code>, must match <code>MIGRATION_ADMIN_KEY</code>)
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => persistKey(e.target.value)}
              placeholder="paste migration admin key"
              className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-violet-400"
            />
            <button
              onClick={loadFiles}
              disabled={!adminKey || loading}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load migrations"}
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={stopOnError}
              onChange={(e) => setStopOnError(e.target.checked)}
            />
            Stop on first failed statement (recommended)
          </label>
          {keyLoaded && !adminKey && (
            <p className="mt-2 text-xs text-neutral-500">
              This page is reachable without app login; the key is stored only in this browser via localStorage.
            </p>
          )}
        </section>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">Migration files</h2>
          {files.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {adminKey ? "No files loaded yet — click Load migrations." : "Enter the admin key above."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              {files.map((f) => {
                const r = results[f.path];
                const isRunning = running === f.path;
                return (
                  <li key={f.path} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-neutral-900">{f.path}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">{f.bytes.toLocaleString()} bytes</p>
                      {r && "error" in r && (
                        <p className="mt-2 text-xs text-red-600">{r.error}</p>
                      )}
                      {r && "ok" in r && (
                        <ResultPanel result={r as RunResponse} />
                      )}
                    </div>
                    <button
                      onClick={() => runFile(f.path)}
                      disabled={isRunning || !!running}
                      className="shrink-0 rounded-lg border border-violet-600 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                    >
                      {isRunning ? "Running…" : "Run"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mb-16">
          <h2 className="mb-3 text-lg font-semibold">Run ad-hoc SQL</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Statements are split on <code>;</code> (respecting strings, comments, and{" "}
            <code>$$ … $$</code> blocks) and executed sequentially.
          </p>
          <textarea
            value={inlineSql}
            onChange={(e) => setInlineSql(e.target.value)}
            spellCheck={false}
            rows={10}
            placeholder="-- paste SQL here"
            className="w-full rounded-xl border border-neutral-200 bg-white p-3 font-mono text-xs outline-none focus:border-violet-400"
          />
          <div className="mt-3 flex items-center justify-end">
            <button
              onClick={runInline}
              disabled={!adminKey || !inlineSql.trim() || !!running}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {running === "__inline__" ? "Running…" : "Run SQL"}
            </button>
          </div>
          {results.__inline__ && "ok" in results.__inline__ && (
            <ResultPanel result={results.__inline__ as RunResponse} />
          )}
          {results.__inline__ && "error" in results.__inline__ && (
            <p className="mt-3 text-sm text-red-600">{(results.__inline__ as { error: string }).error}</p>
          )}
        </section>
      </div>
    </main>
  );
}

function ResultPanel({ result }: { result: RunResponse }) {
  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span
          className={
            result.ok
              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700"
              : "rounded-full bg-red-100 px-2 py-0.5 text-red-700"
          }
        >
          {result.ok ? "Success" : "Failed"}
        </span>
        <span className="text-neutral-600">
          {result.okCount}/{result.total} statements ok
          {result.failCount > 0 && `, ${result.failCount} failed`}
        </span>
      </div>
      <ol className="space-y-1.5">
        {result.results.map((r) => (
          <li
            key={r.index}
            className={
              r.ok
                ? "rounded border border-emerald-100 bg-white p-2"
                : "rounded border border-red-200 bg-white p-2"
            }
          >
            <div className="flex items-center justify-between gap-3">
              <code className="truncate font-mono text-[11px] text-neutral-700">
                {r.index + 1}. {r.preview}
              </code>
              <span className="shrink-0 text-[10px] text-neutral-500">{r.ms}ms</span>
            </div>
            {r.error && <p className="mt-1 text-[11px] text-red-600">{r.error}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
