import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide, GUIDES } from "@/lib/seo/guides";
import { ArrowRight } from "lucide-react";

const SLUG = "squads-multisig-setup-guide";
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
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-aurora-violet/[0.06] blur-[150px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-4">
            Guides // Multisig
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
          <h2>What Squads is and why it's the default</h2>
          <p>
            Squads is the most-used multisig protocol on Solana. v4 introduced
            per-vault thresholds, programmable signer policies, and meaningfully
            cheaper transaction creation. For any team holding more than a few
            thousand dollars on-chain, a Squads v4 vault is the floor.
          </p>

          <h2>Before you start</h2>
          <ul>
            <li>Pick 3-5 signers. More signers = more resilient, harder to coordinate.</li>
            <li>Each signer must control their own private key — no shared seed phrases.</li>
            <li>Hardware wallets (Ledger, Keystone) for at least the threshold count.</li>
            <li>A funded Solana wallet to pay vault creation fees (a fraction of a SOL).</li>
          </ul>

          <h2>Step 1 — Create the vault</h2>
          <ol>
            <li>Visit <a href="https://app.squads.so" target="_blank" rel="noopener noreferrer">app.squads.so</a> and connect a wallet.</li>
            <li>Click <strong>Create new Squad</strong>.</li>
            <li>Add each signer's wallet address. Double-check every character.</li>
            <li>Set the threshold (e.g. 3-of-5).</li>
            <li>Confirm and sign the creation transaction.</li>
          </ol>

          <h2>Step 2 — Choose your threshold</h2>
          <p>Threshold is a tradeoff between safety and operational speed:</p>
          <ul>
            <li><strong>2-of-3:</strong> small teams, fast moves, single point-of-coordination risk.</li>
            <li><strong>3-of-5:</strong> the standard for protocol treasuries — balances resilience with speed.</li>
            <li><strong>4-of-7:</strong> larger DAOs, slower moves, very strong against single-signer compromise.</li>
          </ul>

          <h2>Step 3 — Fund the vault</h2>
          <p>
            Send a small amount of SOL first to confirm the address. Verify the receive
            address character-by-character against the Squads UI before sending any
            real value.
          </p>

          <h2>Step 4 — Connect to dreyv for simulation</h2>
          <p>
            Approving transactions inside Squads is safer when each proposal arrives
            with a human-readable impact preview. Connect your Squads vault inside{" "}
            <Link href="/app">dreyv</Link>, and every intent — swap, stake, payroll,
            rebalance — generates a Squads proposal pre-loaded with simulation output.
          </p>
          <p>Signers see balance deltas, recipient addresses, and program calls before they sign.</p>

          <h2>Step 5 — Signer hygiene</h2>
          <ul>
            <li>Every signer uses a hardware wallet for the multisig role.</li>
            <li>Rotate a signer immediately if a device is lost or a team member leaves.</li>
            <li>Never use a signer wallet for hot/operational activity.</li>
            <li>Keep an emergency runbook off-chain with rotation steps.</li>
          </ul>

          <h2>Common mistakes</h2>
          <ul>
            <li><strong>Threshold too high:</strong> can't approve anything during a holiday.</li>
            <li><strong>Threshold too low:</strong> a single compromise drains the vault.</li>
            <li><strong>No address verification:</strong> phishing replaces an address mid-flow.</li>
            <li><strong>Signers reusing wallets:</strong> entire signer role compromised by an unrelated dApp interaction.</li>
          </ul>

          <h2>Next</h2>
          <p>
            With a vault live, structure how it holds value:{" "}
            <Link href="/guides/solana-dao-treasury-management">
              Solana DAO treasury playbook
            </Link>
            . Or learn how dreyv generates simulation previews for every Squads proposal:{" "}
            <Link href="/guides/intent-driven-treasury-solana">
              intent-driven treasury
            </Link>
            .
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
