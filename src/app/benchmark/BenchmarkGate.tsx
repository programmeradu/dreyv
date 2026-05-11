"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

export default function BenchmarkGate() {
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/benchmark/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        setErr("Wrong password.");
        return;
      }
      window.location.reload();
    } catch {
      setErr("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-32">
      <h1 className="text-3xl font-semibold tracking-tight">Model benchmark</h1>
      <p className="mt-3 text-sm text-slate-600">
        Internal stress test for Dreyv CommandBar across Lovable AI, Groq, and Cloudflare Workers AI.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-3">
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          className="w-full rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-600"
        />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={loading || !pw}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? "Unlocking…" : "Unlock"}
          <ArrowRight size={14} />
        </button>
      </form>
    </div>
  );
}
