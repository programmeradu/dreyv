import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { getSiteOrigin } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "About dreyv — AI treasury command layer for Solana teams",
  description:
    "dreyv is an independent software company building the AI-native, non-custodial treasury workspace for Solana DAOs, protocols, and crypto-native teams. Founded 2025, headquartered in Nicosia, Cyprus.",
  alternates: { canonical: `${getSiteOrigin()}/about` },
  openGraph: {
    title: "About dreyv",
    description:
      "Independent software company building the AI-native treasury workspace for Solana teams. Founded 2025, Nicosia, Cyprus.",
    url: `${getSiteOrigin()}/about`,
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white font-label text-slate-800">
      <header className="border-b border-violet-100">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight text-slate-900">
            dreyv
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/" className="text-slate-600 hover:text-violet-700">Home</Link>
            <Link href="/pricing" className="text-slate-600 hover:text-violet-700">Pricing</Link>
            <Link href="/developers" className="text-slate-600 hover:text-violet-700">Developers</Link>
            <Link href="/auth" className="rounded-lg bg-violet-600 px-3.5 py-2 text-white hover:bg-violet-700">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-700">About</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
          The treasury command layer for Solana teams.
        </h1>

        <div className="mt-8 space-y-6 text-[17px] leading-relaxed text-slate-700">
          <p>
            <strong className="text-slate-900">dreyv</strong> (pronounced &ldquo;drave&rdquo;) is an
            AI-native, non-custodial treasury workspace built for Solana DAOs, protocols, and
            crypto-native operators. Teams describe what they want to do in plain English &mdash;
            rebalance, pay contributors, hedge stablecoin exposure, run a DCA &mdash; and dreyv
            compiles the intent into a plan, simulates it against live on-chain state, surfaces a
            human-readable impact report, and routes the final transaction to the team&rsquo;s
            existing multisig (Squads and compatible signers) for human approval. dreyv never
            holds funds and never holds private keys.
          </p>
          <p>
            The product is sold as a SaaS subscription with three tiers (Free, Mini at $49/mo,
            Max at $199/mo) and includes a developer surface &mdash; a public REST API, an MCP
            server, and an agent payments layer &mdash; that other builders use to add treasury
            capabilities to their own products and AI agents. We are an independent software
            company, not a custodian, broker-dealer, or investment adviser, and we do not offer
            financial advice.
          </p>
        </div>

        <section className="mt-14 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-violet-100 bg-white p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Company</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Name</dt><dd className="text-slate-900 font-medium">dreyv</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Founded</dt><dd className="text-slate-900 font-medium">2025</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Headquarters</dt><dd className="text-slate-900 font-medium">Nicosia, Cyprus</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Category</dt><dd className="text-slate-900 font-medium text-right">Developer tools / Fintech SaaS</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Stage</dt><dd className="text-slate-900 font-medium">Pre-seed</dd></div>
            </dl>
          </div>
          <div className="rounded-2xl border border-violet-100 bg-white p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Contact</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">General</dt>
                <dd><a href="mailto:hello@dreyv.com" className="text-violet-700 hover:underline">hello@dreyv.com</a></dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Founder</dt>
                <dd><a href="mailto:samuel@dreyv.com" className="text-violet-700 hover:underline">samuel@dreyv.com</a></dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Privacy</dt>
                <dd><a href="mailto:privacy@dreyv.com" className="text-violet-700 hover:underline">privacy@dreyv.com</a></dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Press</dt>
                <dd><a href="mailto:press@dreyv.com" className="text-violet-700 hover:underline">press@dreyv.com</a></dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Team</h2>
          <div className="mt-6 rounded-2xl border border-violet-100 bg-white p-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-lg font-semibold text-slate-900">Samuel Adu-Berekorang</div>
                <div className="text-sm text-violet-700">Founder &amp; CEO</div>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                  Builder and operator focused on developer tools for AI agents and on-chain
                  finance. Leads product, engineering, and go-to-market for dreyv.
                </p>
              </div>
              <a
                href="https://www.linkedin.com/company/dreyv/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-violet-700 hover:underline shrink-0"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">What we ship</h2>
          <ul className="mt-6 space-y-3 text-[15px] text-slate-700">
            <li><strong className="text-slate-900">dreyv app</strong> &mdash; the treasury workspace: natural-language command bar, simulation, impact reports, multisig routing.</li>
            <li><strong className="text-slate-900">dreyv atlas</strong> &mdash; Solana intelligence surface (tokens, yields, MEV, rug signals, strategy lab).</li>
            <li><strong className="text-slate-900">Developer API &amp; MCP server</strong> &mdash; the same capabilities exposed as REST endpoints and an MCP server for AI agents.</li>
            <li><strong className="text-slate-900">dreyv studio</strong> &mdash; browser IDE for building and shipping treasury mini-apps and agents.</li>
          </ul>
        </section>

        <div className="mt-16 flex flex-wrap gap-3">
          <Link href="/pricing" className="rounded-lg bg-violet-600 px-5 py-3 text-white hover:bg-violet-700 transition-colors">
            See pricing
          </Link>
          <Link href="/developers" className="rounded-lg border border-violet-200 px-5 py-3 text-slate-800 hover:bg-violet-50 transition-colors">
            Developer hub
          </Link>
          <a href="mailto:hello@dreyv.com" className="rounded-lg border border-violet-200 px-5 py-3 text-slate-800 hover:bg-violet-50 transition-colors">
            Contact us
          </a>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
