import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { getSiteOrigin } from "@/lib/seo/site";
import { ArrowRight, ArrowUpRight } from "lucide-react";

const path = "/solana-treasury-tracker";
const title = "Solana treasury tracker — non-custodial, multisig-native | dreyv";
const description =
  "Track your Solana treasury in real time: balances across SPL tokens, LSTs, lending and LP positions, plus simulation before every signature. Non-custodial, Squads-native.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: path },
  openGraph: { title, description, url: path, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

const features = [
  {
    label: "Live multi-vault balances",
    body: "Group Squads vaults, hot wallets and program-owned treasuries into one view. SPL tokens, LSTs (jitoSOL, mSOL, bSOL), Kamino/MarginFi/Drift positions and LP shares — priced and attributed automatically.",
  },
  {
    label: "PnL, attribution, drift",
    body: "See realized vs unrealized PnL, where the move came from (price, yield, swaps, transfers), and how far each bucket has drifted from your target allocation.",
  },
  {
    label: "Plain-language intent",
    body: "Type \"rebalance to 60% USDC, 30% jitoSOL, 10% SOL\" or \"sweep idle USDC into Kamino main\". dreyv plans, simulates, and queues the multisig transaction.",
  },
  {
    label: "Simulation firewall",
    body: "Every proposed transaction is dry-run against live state — slippage, MEV exposure, oracle staleness, program upgrade risk — before any signer touches it.",
  },
];
const competitorRow = [
  { what: "Solana-native (Squads, Jupiter, Helius)", us: true, generic: false },
  { what: "Non-custodial — you keep the keys", us: true, generic: true },
  { what: "Simulation before signature", us: true, generic: false },
  { what: "Plain-language treasury intent", us: true, generic: false },
  { what: "DeFi position attribution (LSTs, lending, LP)", us: true, generic: true },
  { what: "Multisig-native approval flow", us: true, generic: false },
];

export default function SolanaTreasuryTrackerPage() {
  const origin = getSiteOrigin();
  const url = `${origin}${path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: title,
        description,
        url,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "dreyv", item: origin },
          { "@type": "ListItem", position: 2, name: "Solana treasury tracker", item: url },
        ],
      },
    ],
  };

  return (
    <div className="relative min-h-dvh w-full bg-white text-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-violet-300/30 blur-[150px]" />
        <div className="absolute top-[20%] right-[-5%] h-[600px] w-[600px] rounded-full bg-violet-400/20 blur-[130px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 md:py-24 font-[var(--font-manrope,Manrope)]">
        <header className="mb-14">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-600 mb-4">
            Solana treasury tracker
          </p>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-5 leading-[1.05]">
            Track your Solana treasury without giving up the keys.
          </h1>
          <p className="text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl">
            dreyv is the non-custodial, multisig-native treasury layer for DAOs and protocols on Solana.
            Live balances, DeFi attribution, and a simulation firewall on every signature — built around Squads.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/waitlist"
              className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-700 transition"
            >
              Get early access <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/atlas"
              className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-6 py-3 text-sm font-bold text-slate-900 hover:border-violet-400 transition"
            >
              Explore dreyv atlas <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-6">What you get</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((f) => (
              <li key={f.label} className="rounded-3xl border border-violet-100 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-2">{f.label}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-6">
            Why teams pick dreyv over a generic portfolio tracker
          </h2>
          <div className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-violet-50 text-[11px] uppercase tracking-wider text-violet-700">
                <tr>
                  <th className="px-4 py-3 text-left">Capability</th>
                  <th className="px-4 py-3 text-center w-24">dreyv</th>
                  <th className="px-4 py-3 text-center w-32">Generic tracker</th>
                </tr>
              </thead>
              <tbody>
                {competitorRow.map((r, i) => (
                  <tr key={r.what} className={i % 2 ? "bg-violet-50/30" : ""}>
                    <td className="px-4 py-3 text-slate-700">{r.what}</td>
                    <td className="px-4 py-3 text-center font-bold text-violet-600">{r.us ? "Yes" : "—"}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{r.generic ? "Yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-6">Built around the Solana stack</h2>
          <p className="text-sm md:text-base text-slate-600 leading-relaxed mb-4">
            Squads multisig for signing. Jupiter for routing. Helius for real-time state. Kamino, MarginFi, Drift,
            Marinade and Jito for yield. dreyv reads them, attributes them, and lets you act on them as one treasury.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <li><Link href="/atlas/yields/usdc" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">USDC yield</Link></li>
            <li><Link href="/atlas/yields/jitosol" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">jitoSOL</Link></li>
            <li><Link href="/atlas/protocols/kamino" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">Kamino</Link></li>
            <li><Link href="/atlas/protocols/marginfi" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">MarginFi</Link></li>
            <li><Link href="/atlas/protocols/drift" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">Drift</Link></li>
            <li><Link href="/atlas" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">All of dreyv atlas</Link></li>
          </ul>
        </section>

        <section className="rounded-3xl border border-violet-200 bg-violet-600 p-8 md:p-10 text-white">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-3">
            Ready to run treasury on intent, not on spreadsheets?
          </h2>
          <p className="text-sm md:text-base text-white/80 mb-6 max-w-xl">
            dreyv is invite-only while we onboard design partners. Tell us your AUM and stack and we'll route you.
          </p>
          <Link
            href="/waitlist"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-violet-700 hover:bg-violet-50 transition"
          >
            Apply to the waitlist <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
