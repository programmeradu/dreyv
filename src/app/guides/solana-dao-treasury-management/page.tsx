import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide, GUIDES } from "@/lib/seo/guides";
import { ArrowRight } from "lucide-react";

const SLUG = "solana-dao-treasury-management";
const GUIDE = getGuide(SLUG)!;
const PATH = `/guides/${SLUG}`;

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.description,
  alternates: { canonical: PATH },
  openGraph: {
    title: `${GUIDE.title} | dreyv`,
    description: GUIDE.description,
    type: "article",
    publishedTime: `${GUIDE.publishedAt}T12:00:00.000Z`,
  },
};

export default function Page() {
  const others = GUIDES.filter((g) => g.slug !== SLUG).slice(0, 3);

  return (
    <div className="relative min-h-dvh w-full bg-[var(--dreyv-void)] text-white">
      <ArticleJsonLd
        path={PATH}
        headline={GUIDE.title}
        description={GUIDE.description}
        datePublished={`${GUIDE.publishedAt}T12:00:00.000Z`}
      />
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-dreyv-green/[0.06] blur-[150px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-4">
            Guides // Treasury
          </p>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-6 leading-tight">
            {GUIDE.title}
          </h1>
          <p className="text-base text-white/55 leading-relaxed">{GUIDE.description}</p>
          <p className="mt-4 text-xs text-white/35">
            Published {GUIDE.publishedAt} · ~{GUIDE.readMinutes} min read
          </p>
        </header>

        <article className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:font-bold prose-a:text-dreyv-green prose-a:no-underline hover:prose-a:underline prose-strong:text-white/95">
          <h2>Why DAO treasury management changed in 2026</h2>
          <p>
            The first wave of DAOs treated treasury management as a spreadsheet problem
            with on-chain settlement. By 2026 that gap closed: Squads v4 made multisig
            ergonomics tolerable, liquid staking matured beyond a single dominant
            provider, and intent-driven tooling like <Link href="/">dreyv</Link>{" "}
            collapsed planning, simulation, and approval into one surface.
          </p>
          <p>
            What follows is a working playbook used by Solana-native DAOs and
            protocol teams managing anywhere from $250k to $50M in on-chain assets.
          </p>

          <h2>1. Bucket your runway</h2>
          <p>
            Every well-run DAO treasury we see splits balances into at least three buckets,
            each with explicit policy:
          </p>
          <ul>
            <li>
              <strong>Operating float (USDC, 3-12 months):</strong> covers payroll,
              vendors, and grants. Held in a hot multisig with the lowest signer
              threshold (e.g. 2-of-4) for speed.
            </li>
            <li>
              <strong>Reserve (SOL + LST mix):</strong> longer-horizon capital. Liquid
              staking via{" "}
              <Link href="/atlas/tokens/jitosol">JitoSOL</Link> or{" "}
              <Link href="/atlas/tokens/msol">mSOL</Link> keeps it productive without
              locking it.
            </li>
            <li>
              <strong>Strategic / speculative (capped):</strong> ecosystem tokens or
              memecoins held with an explicit hard cap and quarterly review.
            </li>
          </ul>

          <h2>2. Use liquid staking, not idle SOL</h2>
          <p>
            Holding raw SOL is a yield decision — and almost always the wrong one.
            JitoSOL captures both base staking yield and MEV rewards; mSOL
            distributes across a wide validator set for decentralization. dreyv routes
            stake intents to the right venue based on your stated preference.
          </p>

          <h2>3. Sign with simulation, not vibes</h2>
          <p>
            Blind signing is the single most common cause of large treasury losses on
            Solana. Every transaction your multisig is asked to approve should ship with
            a human-readable impact summary: balance deltas, recipient addresses,
            program calls, and any unusual instruction sequences.
          </p>
          <p>
            dreyv generates this summary by forking current network state and dry-running
            the transaction against it before any signer touches their wallet.
          </p>

          <h2>4. Codify approvals in the multisig itself</h2>
          <p>
            Squads v4 supports per-vault thresholds and signer rotation. Use them.
            Recommended baseline:
          </p>
          <ul>
            <li>Operating vault: 2-of-4, daily spend cap</li>
            <li>Reserve vault: 3-of-5, no automated outflows</li>
            <li>Strategic vault: 3-of-5, monthly review cadence</li>
          </ul>

          <h2>5. Document the why, not just the what</h2>
          <p>
            On-chain history records every transfer, but not the reasoning. Pair every
            non-trivial treasury move with a written rationale (forum post, internal
            doc, or dreyv intent log) so future contributors and auditors can
            reconstruct the decision.
          </p>

          <h2>Where to go next</h2>
          <p>
            Set up your first vault with the{" "}
            <Link href="/guides/squads-multisig-setup-guide">Squads multisig setup guide</Link>,
            or read the broader case for{" "}
            <Link href="/guides/intent-driven-treasury-solana">intent-driven treasury</Link>.
          </p>
        </article>

        <section className="mt-16 pt-12 border-t border-white/10">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-4">
            More guides
          </h2>
          <ul className="space-y-3">
            {others.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] p-4 transition"
                >
                  <div>
                    <p className="text-sm font-bold text-white mb-1">{g.title}</p>
                    <p className="text-xs text-white/50">{g.teaser}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-dreyv-green flex-shrink-0 mt-1" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
