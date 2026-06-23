import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Atlas methodology — how Dreyv scores Solana protocols, tokens, and yields",
  description:
    "How Dreyv Atlas computes protocol health, token risk, yield projections, and rug-pull scores — data sources, formulas, refresh cadence, and known limitations.",
  alternates: { canonical: "/atlas/methodology" },
};

const sections: Array<{ id: string; heading: string; body: React.ReactNode }> = [
  {
    id: "data-sources",
    heading: "Data sources",
    body: (
      <ul className="list-disc pl-6 space-y-2 text-slate-700">
        <li>On-chain state: Helius RPC + getProgramAccounts snapshots, refreshed every 60s.</li>
        <li>Pricing: Jupiter price API (mid-market) reconciled against Birdeye 1h candles.</li>
        <li>Liquidity & TVL: protocol-direct subgraphs where available, DeFiLlama as fallback.</li>
        <li>MEV signals: in-house Jito bundle indexer + tip-bid distribution.</li>
        <li>Holder + concentration: Helius DAS + per-token Bubblemaps overlays.</li>
      </ul>
    ),
  },
  {
    id: "protocol-score",
    heading: "Protocol score",
    body: (
      <p className="text-slate-700">
        A 0–100 composite over five weighted axes: TVL retention (25%), audit + bug-bounty
        posture (20%), governance decentralisation (15%), integration depth (20%), and
        incident history over 180 days (20%). Scores are recomputed daily and shown
        alongside the raw inputs so you can verify them yourself.
      </p>
    ),
  },
  {
    id: "token-risk",
    heading: "Token risk",
    body: (
      <p className="text-slate-700">
        Four flags blended into a single risk band: mint authority, freeze authority, top-10
        holder concentration, and liquidity depth at ±2% from mid. Tokens with any active
        rug heuristic (mint not revoked, sudden LP withdrawal, blacklist function present)
        are surfaced separately on the rug detector and excluded from yield routing.
      </p>
    ),
  },
  {
    id: "yield-projection",
    heading: "Yield projection",
    body: (
      <p className="text-slate-700">
        Projected APY is the trailing-30-day realised yield, decayed by the protocol's
        emission schedule and adjusted for token-price impermanence. We never show forward
        APR figures sourced from a UI label — every projection is recomputed from on-chain
        reward distributions.
      </p>
    ),
  },
  {
    id: "limits",
    heading: "Known limitations",
    body: (
      <ul className="list-disc pl-6 space-y-2 text-slate-700">
        <li>New pools (&lt; 7 days old) carry a wide confidence interval — we surface this
          explicitly instead of suppressing them.</li>
        <li>MEV signals lag by ~2 slots while the indexer reconciles bundles.</li>
        <li>Cross-chain bridged supply is excluded from holder concentration to avoid
          double-counting wrapped representations.</li>
      </ul>
    ),
  },
  {
    id: "feedback",
    heading: "Disagree with a score?",
    body: (
      <p className="text-slate-700">
        Open a methodology issue at{" "}
        <a className="text-violet-700 underline" href="mailto:founders@dreyv.com">
          founders@dreyv.com
        </a>{" "}
        with the protocol, the disputed axis, and your evidence. We revise the weights
        publicly in this document when the underlying market structure changes.
      </p>
    ),
  },
];

export default function AtlasMethodologyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-violet-600 font-semibold">
        Dreyv Atlas
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
        Atlas methodology
      </h1>
      <p className="mt-4 text-lg text-slate-600 leading-relaxed">
        How Atlas computes the numbers you see on every protocol, token, and yield page —
        data sources, formulas, refresh cadence, and what we deliberately exclude.
      </p>

      <nav aria-label="On this page" className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">On this page</p>
        <ul className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="hover:text-violet-700">
                {s.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-12 space-y-12">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="text-2xl font-semibold text-slate-900">{s.heading}</h2>
            <div className="mt-3">{s.body}</div>
          </section>
        ))}
      </div>

      <div className="mt-16 border-t border-slate-200 pt-8 text-sm text-slate-500">
        <Link href="/atlas" className="text-violet-700 hover:underline">
          ← Back to Atlas
        </Link>
      </div>
    </main>
  );
}
