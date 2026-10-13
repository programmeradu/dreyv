/**
 * /case — index of featured case studies.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/marketing/legacy-chrome";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { FEATURED_CASES } from "@/lib/case-study/featured";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

export const metadata: Metadata = {
  title: "Case studies — dreyv",
  description:
    "Counterfactual analysis on real, public Solana treasuries. What dreyv would have caught — quantified from live on-chain data.",
  alternates: { canonical: "/case" },
};

export default function CaseIndexPage() {
  return (
    <div className="min-h-screen bg-white font-manrope text-slate-900">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-violet-100">
        <span aria-hidden className="pointer-events-none absolute -top-32 -left-32 h-[24rem] w-[24rem] rounded-full bg-violet-300/30 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-violet-400/20 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <DreyvStar size={10} />
            Case Studies
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            What dreyv would have caught — on treasuries you can verify.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
            Counterfactual analysis on real, public Solana treasuries. Every figure pulled live from Helius and Jupiter — open on Solscan, sourced in every card, fabricated in none.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {FEATURED_CASES.map((c) => (
            <Link
              key={c.address}
              href={`/case/${c.address}`}
              className="group flex flex-col justify-between rounded-3xl border border-violet-200 bg-white p-7 transition hover:border-violet-400"
            >
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                  {c.kind}
                </div>
                <h2 className="mt-4 text-2xl font-bold tracking-tight">{c.label}</h2>
                <p className="mt-2 text-sm text-slate-600">{c.blurb}</p>
              </div>
              <div className="mt-6 flex items-center justify-between text-sm font-semibold text-violet-700">
                <span>Read the analysis</span>
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 rounded-3xl border border-violet-100 bg-violet-50/40 p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">Want one for your treasury?</h3>
              <p className="mt-1 text-sm text-slate-600">
                Same analysis, run live every 15 minutes, with policy-gated execution.
              </p>
            </div>
            <Link href="/auth?redirect=/app" className={marketingPrimaryCtaSm}>
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
