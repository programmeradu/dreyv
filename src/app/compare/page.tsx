import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { Check, Minus, ArrowRight } from "lucide-react";
import compareCrystal from "@/assets/compare-crystal.png";

export const metadata: Metadata = {
  title: "Compare — dreyv vs Squads, Jupiter, Birdeye & dashboards",
  description:
    "How dreyv compares to Squads multisig, Jupiter swap UI, Birdeye analytics, and read-only treasury dashboards. AI intent parsing, simulation-before-sign, non-custodial, multisig-native.",
  alternates: { canonical: "/compare" },
  openGraph: {
    title: "dreyv vs Squads, Jupiter, Birdeye",
    description:
      "Side-by-side: AI intent parsing, simulation-before-sign, non-custodial, multisig-native.",
    url: "/compare",
  },
};

type Row = { label: string; dreyv: boolean | string; squads: boolean | string; jupiter: boolean | string; birdeye: boolean | string };

const rows: Row[] = [
  { label: "Non-custodial",                            dreyv: true,  squads: true,  jupiter: true,  birdeye: true },
  { label: "Multisig-native (Squads)",                 dreyv: true,  squads: true,  jupiter: false, birdeye: false },
  { label: "Plain-language intent → plan (AI)",        dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Forked-state simulation before signing",   dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Human-readable impact for approvers",      dreyv: true,  squads: "partial", jupiter: false, birdeye: false },
  { label: "Swap routing (Jupiter)",                   dreyv: true,  squads: false, jupiter: true,  birdeye: false },
  { label: "Onchain analytics & token research",       dreyv: true,  squads: false, jupiter: "partial", birdeye: true },
  { label: "MEV / rug-pull scanners",                  dreyv: true,  squads: false, jupiter: false, birdeye: "partial" },
  { label: "Yield routing (Marinade/Jito/Blaze)",      dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Persistent knowledge memory (GraphRAG)",   dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Build mini-apps & agents (Studio)",        dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "OpenAPI / MCP / ACP / x402 surface",       dreyv: true,  squads: false, jupiter: "partial", birdeye: false },
];

function Cell({ v, dreyv = false }: { v: boolean | string; dreyv?: boolean }) {
  if (v === true) {
    return (
      <span
        className={
          dreyv
            ? "mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white"
            : "mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700"
        }
        aria-label="Yes"
      >
        <Check className="h-3 w-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (v === false) {
    return <Minus className="mx-auto h-4 w-4 text-slate-300" aria-label="No" />;
  }
  return <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{v}</span>;
}

export default function ComparePage() {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full scroll-smooth font-manrope bg-white text-slate-900">
      {/* Ambient violet light — solid hues only */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
        <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
      </div>

      <SiteHeader />

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-12 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                dreyv · Compare
              </span>
              <h1 className="mt-5 text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
                dreyv vs Squads, Jupiter & Birdeye
              </h1>
              <p className="mt-4 max-w-2xl text-base md:text-lg text-slate-600 leading-relaxed">
                Most teams stitch together a multisig, a swap UI, an analytics dashboard, and a chat
                channel. dreyv compresses that stack into one non-custodial AI workspace where you
                describe intent, preview outcomes, and propose to your multisig — in one place.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/auth?redirect=/app" className={marketingPrimaryCtaSm}>
                  Try dreyv free
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors"
                >
                  See pricing
                </Link>
              </div>
            </div>
            <div className="hidden lg:flex justify-end">
              <div className="relative h-[280px] w-[280px] rounded-3xl bg-violet-50/60 border border-violet-100 flex items-center justify-center overflow-hidden">
                <Image
                  src={compareCrystal}
                  alt="Three violet crystal shards rising in scale, symbolising the dreyv capability comparison"
                  width={240}
                  height={240}
                  priority
                  className="h-[240px] w-[240px] object-contain"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Capability matrix */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="overflow-hidden rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur-md shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-violet-50/70 text-left">
                    <th scope="col" className="px-5 py-4 font-semibold text-slate-700">Capability</th>
                    <th scope="col" className="px-4 py-4 text-center font-semibold text-violet-700">dreyv</th>
                    <th scope="col" className="px-4 py-4 text-center font-semibold text-slate-600">Squads</th>
                    <th scope="col" className="px-4 py-4 text-center font-semibold text-slate-600">Jupiter</th>
                    <th scope="col" className="px-4 py-4 text-center font-semibold text-slate-600">Birdeye</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.label}
                      className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/40" : ""}`}
                    >
                      <th scope="row" className="px-5 py-3.5 text-left font-medium text-slate-800">
                        {r.label}
                      </th>
                      <td className="px-4 py-3.5 text-center bg-violet-50/40"><Cell v={r.dreyv} dreyv /></td>
                      <td className="px-4 py-3.5 text-center"><Cell v={r.squads} /></td>
                      <td className="px-4 py-3.5 text-center"><Cell v={r.jupiter} /></td>
                      <td className="px-4 py-3.5 text-center"><Cell v={r.birdeye} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Wins & honest credits */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur p-7 shadow-[0_10px_40px_-20px_rgba(124,58,237,0.18)]">
              <span className="h-1.5 w-10 rounded-full bg-violet-600 block" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900">Where dreyv wins</h2>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-700">
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />AI intent parsing — describe a treasury plan in one sentence.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />Forked simulation with human-readable impact before any signature.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />Multisig-native (Squads) workflow with the simulation attached.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />One workspace replaces eight disconnected tools.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />Agent-ready surface — OpenAPI, MCP, ACP, UCP, x402.</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/85 backdrop-blur p-7">
              <span className="h-1.5 w-10 rounded-full bg-slate-300 block" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900">Where the others still shine</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-700 leading-relaxed">
                <li><strong className="text-slate-900">Squads</strong> — deep, audited multisig primitives. dreyv builds on top of them.</li>
                <li><strong className="text-slate-900">Jupiter</strong> — best-in-class swap routing. dreyv consumes Jupiter quotes inside plans.</li>
                <li><strong className="text-slate-900">Birdeye</strong> — rich market data. dreyv complements it with intent + execution.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24">
          <div className="rounded-3xl bg-violet-600 p-8 md:p-10 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-[0_30px_80px_-30px_rgba(124,58,237,0.45)]">
            <div className="max-w-xl">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Stop stitching tools. Start describing intent.
              </h2>
              <p className="mt-2 text-violet-100 text-sm md:text-base leading-relaxed">
                Connect a wallet, simulate a plan, and propose it to your multisig — all from one
                non-custodial workspace.
              </p>
            </div>
            <Link
              href="/auth?redirect=/app"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 transition-colors"
            >
              Try dreyv free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
