"use client";

/**
 * /claim — human-facing redemption page for agent claim tokens (`agcl.…`).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldCheck, KeyRound, Wallet, ArrowUpRight, Check } from "lucide-react";
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
    <div className="relative min-h-screen overflow-hidden bg-white font-[var(--font-manrope,Manrope),system-ui] text-slate-900 antialiased">
      {/* Background composition — the handoff render lives here, not in a card */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        {/* Ambient violet aurora */}
        <div className="absolute -top-56 left-1/2 h-[780px] w-[780px] -translate-x-1/2 rounded-full bg-violet-300/30 blur-[160px]" />
        <div className="absolute -bottom-60 -left-40 h-[560px] w-[560px] rounded-full bg-violet-200/40 blur-[160px]" />
        <div className="absolute -right-48 top-48 h-[520px] w-[520px] rounded-full bg-fuchsia-100/30 blur-[160px]" />

        {/* Hero asset, dissolved into the background */}
        <div className="absolute inset-x-0 top-[42vh] flex justify-center sm:top-[34vh]">
          <Image
            src={claimHandoff}
            alt=""
            priority
            width={1600}
            height={1200}
            className="w-[min(1400px,140vw)] max-w-none select-none opacity-[0.16] mix-blend-luminosity sm:opacity-[0.13]"
          />
        </div>

        {/* Soft white wash to keep text crisp */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/70 to-white" />
      </div>

      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-slate-900"
        >
          <DreyvStar className="h-4 w-4 text-violet-600" />
          Dreyv
        </Link>
        <Link
          href="/docs"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition hover:text-slate-900"
        >
          How claiming works
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-24 sm:pt-32">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-violet-700 backdrop-blur">
            <DreyvStar className="h-2.5 w-2.5" />
            Agent → Human handoff
          </div>

          <h1 className="mt-7 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.03em] text-slate-900 sm:text-6xl">
            Take ownership of
            <br />
            <span className="text-violet-600">what your agent built.</span>
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-pretty text-[17px] leading-[1.55] text-slate-600">
            Redeem the claim token and everything moves cleanly into your
            account — API keys, payment history, prepaid balance, hosted Solana
            wallet. The agent keeps working. It just answers to you now.
          </p>
        </div>

        {/* Redeem card */}
        <section className="mx-auto mt-16 max-w-xl">
          <div className="rounded-[28px] border border-slate-200/70 bg-white/80 p-7 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.25)] backdrop-blur-xl sm:p-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
                Paste your claim token
              </h2>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                10 min · single-use
              </span>
            </div>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="sr-only">Claim token</span>
                <textarea
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  rows={4}
                  spellCheck={false}
                  placeholder="agcl.eyJhbGciOi…"
                  className={`w-full resize-none rounded-2xl border bg-white px-4 py-3.5 font-mono text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-300 outline-none transition focus:ring-4 ${
                    tokenValid === false
                      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                      : "border-slate-200 focus:border-violet-500 focus:ring-violet-100"
                  }`}
                />
                {tokenValid === false && (
                  <span className="mt-2 block text-xs text-rose-600">
                    Doesn&rsquo;t look like an{" "}
                    <code className="font-mono">agcl.</code> token.
                  </span>
                )}
              </label>

              <button
                type="submit"
                disabled={submitting || !token.trim()}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3.5 text-[14px] font-semibold tracking-tight text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? "Redeeming…" : "Redeem claim"}
                {!submitting && (
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                )}
              </button>

              <p className="text-center text-[12px] text-slate-500">
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
                    <div className="flex items-center gap-2 text-[15px] font-semibold">
                      <ShieldCheck className="h-5 w-5" /> Agent absorbed.
                    </div>
                    <p className="mt-1 text-emerald-800">
                      Keys, balance and wallet now belong to your account.
                    </p>
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-[11px] text-emerald-900">
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

          <p className="mt-5 text-center text-[12px] text-slate-500">
            New to Dreyv?{" "}
            <Link href="/auth" className="font-semibold text-slate-900 underline-offset-4 hover:underline">
              Create an account
            </Link>{" "}
            — takes 30 seconds.
          </p>
        </section>

        {/* Trust strip — minimal, evenly spaced */}
        <ul className="mx-auto mt-20 grid max-w-3xl gap-px overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-200/70 sm:grid-cols-3">
          {[
            { icon: KeyRound, label: "API keys transfer", note: "dk_live_ keys keep working" },
            { icon: Wallet, label: "Balance moves", note: "Prepaid credit + hosted wallet" },
            { icon: ShieldCheck, label: "Audited handoff", note: "Signed, single-use, 10 min" },
          ].map(({ icon: Icon, label, note }) => (
            <li key={label} className="bg-white/90 p-6 backdrop-blur">
              <Icon className="h-5 w-5 text-violet-600" strokeWidth={1.75} />
              <div className="mt-4 text-[14px] font-semibold tracking-tight text-slate-900">
                {label}
              </div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
                {note}
              </div>
            </li>
          ))}
        </ul>
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
