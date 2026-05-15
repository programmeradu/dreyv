import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { getSiteOrigin } from "@/lib/seo/site";
import { ArrowRight, ArrowUpRight } from "lucide-react";

const path = "/solana-portfolio-tracker";
const title = "Solana portfolio tracker for treasuries & power users | dreyv";
const description =
  "A Solana portfolio tracker built for treasuries: SPL tokens, LSTs, Kamino/MarginFi/Drift positions, LP shares, attribution, drift and PnL — non-custodial and multisig-aware.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: path },
  openGraph: { title, description, url: path, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

const sections = [
  {
    h: "All of Solana, in one portfolio",
    p: "SPL tokens, NFTs, LSTs (jitoSOL, mSOL, bSOL, INF), lending and borrowing on Kamino/MarginFi/Drift, LP shares, perps margin and locked/unlocked vesting — read straight from the chain via Helius.",
  },
  {
    h: "Attribution that explains the move",
    p: "Most trackers show a number. dreyv breaks down the change: price, yield accrued, swaps, transfers in/out, fees, slippage. You always know why the line moved.",
  },
  {
    h: "Drift vs target allocation",
    p: "Set the allocation you want — by asset, by category, by venue. dreyv shows the drift in real time and proposes the smallest set of swaps to bring it back inside policy.",
  },
  {
    h: "Multi-wallet, multi-vault",
    p: "Group hot wallets, Squads vaults and program-owned accounts under one workspace. Roles and approvals are first-class — read-only viewers, proposers, signers.",
  },
];

export default function SolanaPortfolioTrackerPage() {
  const origin = getSiteOrigin();
  const url = `${origin}${path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: title, description, url },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "dreyv", item: origin },
          { "@type": "ListItem", position: 2, name: "Solana portfolio tracker", item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Is dreyv custodial?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "No. dreyv never holds your keys. All transactions are proposed, simulated and signed by your own wallets — typically through Squads multisig.",
            },
          },
          {
            "@type": "Question",
            name: "Which Solana protocols does dreyv read?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Kamino, MarginFi, Drift, Jupiter, Marinade, Jito, Sanctum, Orca, Raydium and standard SPL/Token-2022 — with attribution per position.",
            },
          },
          {
            "@type": "Question",
            name: "Can I use dreyv as a personal portfolio tracker?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes — the Free tier supports a single wallet. Treasury features (multisig, approvals, policies) unlock on Mini and Max.",
            },
          },
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
            Solana portfolio tracker
          </p>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-5 leading-[1.05]">
            A Solana portfolio tracker that understands DeFi.
          </h1>
          <p className="text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl">
            Read every position across the Solana stack — LSTs, lending, perps, LPs — with attribution,
            drift and PnL that actually explain the number. Built for treasuries; works for power users too.
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
              Browse dreyv atlas <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <section className="mb-16 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sections.map((s) => (
            <div key={s.h} className="rounded-3xl border border-violet-100 bg-white p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-2">{s.h}</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{s.p}</p>
            </div>
          ))}
        </section>

        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-6">Coverage</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <li><Link href="/atlas/protocols/kamino" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">Kamino</Link></li>
            <li><Link href="/atlas/protocols/marginfi" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">MarginFi</Link></li>
            <li><Link href="/atlas/protocols/drift" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">Drift</Link></li>
            <li><Link href="/atlas/yields/jitosol" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">jitoSOL</Link></li>
            <li><Link href="/atlas/yields/msol" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">mSOL</Link></li>
            <li><Link href="/atlas/yields/usdc" className="block px-3 py-2 rounded-lg border border-violet-100 hover:border-violet-300 transition">USDC</Link></li>
          </ul>
        </section>

        <section className="rounded-3xl border border-violet-200 bg-violet-600 p-8 md:p-10 text-white">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-3">
            See your Solana portfolio the way operators do.
          </h2>
          <p className="text-sm md:text-base text-white/80 mb-6 max-w-xl">
            dreyv is invite-only while we onboard design partners. Free tier covers a single wallet.
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
