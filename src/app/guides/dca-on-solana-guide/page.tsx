import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide, GUIDES } from "@/lib/seo/guides";
import { ArrowRight } from "lucide-react";

const SLUG = "dca-on-solana-guide";
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
            Guides // DCA
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
          <h2>Why treasuries DCA</h2>
          <p>
            Dollar-cost averaging — buying a fixed dollar amount of an asset on a fixed
            schedule — is one of the few strategies that actually works for treasuries
            without market-timing skill. For Solana DAOs, DCA is most commonly used to
            convert <Link href="/atlas/tokens/usdc">USDC</Link> reserves into{" "}
            <Link href="/atlas/tokens/sol">SOL</Link> over weeks or months without
            spiking the market or guessing entries.
          </p>

          <h2>The venues</h2>
          <ul>
            <li>
              <strong>Jupiter DCA:</strong> the dominant on-chain DCA program. Splits
              orders, routes through aggregated liquidity, supports multisig
              ownership of the DCA position.
            </li>
            <li>
              <strong>Drift &amp; Phoenix:</strong> useful when you want CLOB-style
              execution and tighter slippage on larger sizes.
            </li>
            <li>
              <strong>Custom keeper bots:</strong> only sensible at scale — you take on
              operational and security burden.
            </li>
          </ul>

          <h2>Setting one up from a multisig</h2>
          <ol>
            <li>
              Decide the budget, frequency, and pair (e.g. 5,000 USDC → SOL, weekly,
              over 10 weeks).
            </li>
            <li>
              In <Link href="/app">dreyv</Link>, run the intent: <em>"DCA 5,000 USDC
              into SOL weekly for 10 weeks from the operating vault"</em>.
            </li>
            <li>Review the simulation: total fees, expected slippage band, vault
              balance after each tranche.</li>
            <li>Approve via your <Link href="/guides/squads-multisig-setup-guide">Squads multisig</Link>.</li>
          </ol>

          <h2>Slippage controls</h2>
          <p>
            Default Jupiter DCA slippage is generous. For treasury-sized flows, override
            it: 50-100 bps is usually right for SOL/USDC, tighter for stable-stable
            rotations, looser for thin tokens. dreyv exposes this as a clarifying
            question before it generates the plan.
          </p>

          <h2>What can go wrong</h2>
          <ul>
            <li>
              <strong>Frequency too tight on a thin token:</strong> price impact stacks
              up across tranches.
            </li>
            <li>
              <strong>Funding wallet drained mid-program:</strong> position pauses.
              Keep a small buffer.
            </li>
            <li>
              <strong>Stale routes:</strong> Jupiter route quality changes. Periodically
              re-simulate.
            </li>
            <li>
              <strong>Forgotten programs:</strong> document active DCA positions in your
              treasury runbook so future signers know they exist.
            </li>
          </ul>

          <h2>When DCA is the wrong tool</h2>
          <p>
            DCA assumes you have a directional view but no edge on timing. If you have
            a hard cash need (payroll next month) or a hard cap (must reduce SOL
            exposure to 40% by quarter-end), use a one-shot{" "}
            <Link href="/atlas/tokens/usdc">rebalance</Link> with simulation, not DCA.
          </p>

          <h2>Next</h2>
          <p>
            Pair this with the{" "}
            <Link href="/guides/solana-dao-treasury-management">DAO treasury
            playbook</Link>{" "}
            to decide where DCA fits in your overall bucket policy.
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
