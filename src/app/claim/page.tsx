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

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldCheck, KeyRound, Wallet, ArrowUpRight } from "lucide-react";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";
import claimHandoff from "@/assets/claim/claim-handoff.png";

function tokenLooksValid(t: string) {
  const v = t.trim();
  if (!v) return null;
  return v.startsWith("agcl.") && v.length > 16;
}

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

  const tokenValid = useMemo(() => tokenLooksValid(token), [token]);
  const mascotPose = result?.ok
    ? "celebrate"
    : result && !result.ok
      ? "alert"
      : submitting
        ? "think"
        : "greet";

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
    <div className="relative min-h-screen overflow-hidden bg-white font-[var(--font-manrope,Manrope),system-ui] text-slate-900">
      {/* Ambient violet aurora */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-violet-400/25 blur-[140px]" />
        <div className="absolute -bottom-40 -left-32 h-[520px] w-[520px] rounded-full bg-violet-300/30 blur-[140px]" />
        <div className="absolute -right-40 top-40 h-[480px] w-[480px] rounded-full bg-violet-200/40 blur-[140px]" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900"
        >
          <DreyvStar className="h-5 w-5 text-violet-600" />
          Dreyv
        </Link>
        <Link
          href="/docs"
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-violet-700"
        >
          How claiming works <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <main className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-20">
        {/* LEFT — narrative + visual */}
        <section className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
            <DreyvStar className="h-3 w-3" />
            Agent → Human handoff
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Take ownership of what your agent built.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
            An autonomous agent ran tasks, spent credits, and earned balances on
            your behalf. Redeem its claim token and everything &mdash; API keys,
            payment history, prepaid balance, hosted Solana wallet &mdash; moves
            cleanly into your Dreyv account. The agent keeps working. It just
            answers to you now.
          </p>

          <div className="relative mt-10 overflow-hidden rounded-3xl border border-violet-100 bg-gradient-to-br from-white via-violet-50/40 to-white p-6 shadow-[0_30px_80px_-40px_rgba(124,58,237,0.35)]">
            <Image
              src={claimHandoff}
              alt="A Dreyv agent handing a glowing violet key to a human"
              width={1024}
              height={768}
              priority
              className="mx-auto h-auto w-full max-w-md"
            />
            <div className="absolute bottom-6 right-6 hidden sm:block">
              <DreyvMascot pose={mascotPose} size={120} />
            </div>
          </div>

          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { icon: KeyRound, label: "API keys transfer", note: "dk_live_ keys keep working" },
              { icon: Wallet, label: "Balance moves", note: "Prepaid credit + wallet" },
              { icon: ShieldCheck, label: "Audited handoff", note: "Signed, single-use, 10 min" },
            ].map(({ icon: Icon, label, note }) => (
              <li
                key={label}
                className="rounded-2xl border border-violet-100 bg-white/80 p-4 backdrop-blur"
              >
                <Icon className="h-5 w-5 text-violet-600" strokeWidth={1.75} />
                <div className="mt-3 text-sm font-semibold text-slate-900">{label}</div>
                <div className="text-xs text-slate-500">{note}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* RIGHT — redeem card */}
        <section className="lg:sticky lg:top-12 lg:self-start">
          <div className="rounded-3xl border border-violet-200 bg-white p-7 shadow-[0_40px_120px_-40px_rgba(124,58,237,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                  Redeem
                </div>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                  Paste your claim token
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Starts with{" "}
                  <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-violet-700">
                    agcl.
                  </code>{" "}
                  &middot; valid for 10 minutes.
                </p>
              </div>
              <DreyvMascot pose={mascotPose} size={64} glow={false} className="sm:hidden" />
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="sr-only">Claim token</span>
                <textarea
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  rows={5}
                  spellCheck={false}
                  placeholder="agcl.eyJhbGciOi…"
                  className={`w-full rounded-2xl border bg-white px-4 py-3 font-mono text-sm leading-relaxed shadow-sm outline-none transition focus:ring-2 ${
                    tokenValid === false
                      ? "border-rose-300 focus:border-rose-500 focus:ring-rose-100"
                      : "border-violet-200 focus:border-violet-500 focus:ring-violet-100"
                  }`}
                />
                {tokenValid === false && (
                  <span className="mt-1.5 block text-xs text-rose-600">
                    Doesn&rsquo;t look like an{" "}
                    <code className="font-mono">agcl.</code> token.
                  </span>
                )}
              </label>

              <button
                type="submit"
                disabled={submitting || !token.trim()}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(124,58,237,0.6)] transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:shadow-none"
              >
                {submitting ? "Redeeming…" : "Redeem & absorb agent"}
                {!submitting && (
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                )}
              </button>

              <p className="text-center text-xs text-slate-500">
                You&rsquo;ll need to be signed in. We never re-share this token.
              </p>
            </form>

            {result && (
              <div
                className={`mt-6 rounded-2xl border p-5 text-sm ${
                  result.ok
                    ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                    : "border-rose-200 bg-rose-50/70 text-rose-900"
                }`}
              >
                {result.ok ? (
                  <>
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <ShieldCheck className="h-5 w-5" /> Agent absorbed.
                    </div>
                    <p className="mt-1 text-emerald-800">
                      Keys, balance and wallet now belong to your account.
                    </p>
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-xs text-emerald-900">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                    <Link
                      href="/app"
                      className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 hover:text-emerald-900"
                    >
                      Open your dashboard <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">
                      {result.error}
                      {result.status ? ` (${result.status})` : ""}
                    </div>
                    {result.message && (
                      <div className="mt-1 text-rose-800">{result.message}</div>
                    )}
                    {result.status === 401 && (
                      <Link
                        href={`/auth?next=${encodeURIComponent(
                          `/claim?token=${encodeURIComponent(token)}`,
                        )}`}
                        className="mt-3 inline-flex items-center gap-1 font-semibold text-violet-700 hover:text-violet-900"
                      >
                        Sign in to Dreyv <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <p className="mt-5 text-center text-xs text-slate-500">
            New to Dreyv?{" "}
            <Link href="/auth" className="font-semibold text-violet-700 hover:text-violet-900">
              Create an account first
            </Link>{" "}
            &mdash; takes 30 seconds.
          </p>
        </section>
      </main>
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
