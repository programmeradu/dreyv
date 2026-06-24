"use client";

/**
 * /claim — human-facing redemption page for agent claim tokens (`agcl.…`).
 *
 * Flow:
 *   1. Agent calls POST /api/agents/claim → receives `agcl.<JWT>` (10-min TTL).
 *   2. Agent hands the token to a human (link: /claim?token=agcl.…).
 *   3. Human signs in to Dreyv, then submits → POST /api/agents/claim/redeem.
 *   4. Backend reassigns keys/payments/balance/wallet to the customer account.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ClaimInner() {
  const params = useSearchParams();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; status: number; error: string; message?: string }
    | null
  >(null);

  useEffect(() => {
    const q = params.get("token");
    if (q) setToken(q);
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const r = await fetch("/api/agents/claim/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setResult({ ok: true, data });
      } else {
        setResult({
          ok: false,
          status: r.status,
          error: String(data?.error ?? "request_failed"),
          message: data?.message,
        });
      }
    } catch (err) {
      setResult({
        ok: false,
        status: 0,
        error: "network_error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          href="/"
          className="text-sm font-medium text-violet-700 hover:text-violet-900"
        >
          ← Dreyv
        </Link>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight">
          Claim an agent into your account
        </h1>
        <p className="mt-3 text-slate-600">
          Paste the <code className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">agcl.…</code>{" "}
          token an agent gave you. Once you redeem it, the agent&rsquo;s API keys,
          payment history, prepaid balance and (if applicable) hosted Solana
          wallet move to your signed-in account. The agent&rsquo;s{" "}
          <code className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">dk_live_</code>{" "}
          keys keep working &mdash; they&rsquo;re just yours now.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Claim token
            </span>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              rows={4}
              placeholder="agcl.eyJhbGciOi…"
              className="mt-1 w-full rounded-2xl border border-violet-200 bg-white px-4 py-3 font-mono text-sm shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
            />
          </label>

          <button
            type="submit"
            disabled={submitting || !token.trim()}
            className="w-full rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
          >
            {submitting ? "Redeeming…" : "Redeem claim token"}
          </button>
        </form>

        {result && (
          <div
            className={`mt-8 rounded-2xl border p-5 text-sm ${
              result.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {result.ok ? (
              <>
                <div className="font-semibold">Agent absorbed.</div>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </>
            ) : (
              <>
                <div className="font-semibold">
                  {result.error}
                  {result.status ? ` (${result.status})` : ""}
                </div>
                {result.message && (
                  <div className="mt-1">{result.message}</div>
                )}
                {result.status === 401 && (
                  <div className="mt-3">
                    <Link
                      href={`/auth?next=${encodeURIComponent(
                        `/claim?token=${encodeURIComponent(token)}`,
                      )}`}
                      className="font-semibold text-violet-700 underline"
                    >
                      Sign in to Dreyv →
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimInner />
    </Suspense>
  );
}
