import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";
import { getSiteOrigin } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "About dreyv: a treasury workspace for teams on Solana",
  description:
    "dreyv is an independent software company building a non-custodial treasury workspace for Solana DAOs, protocols and crypto-native teams. Founded 2025, based in Nicosia, Cyprus.",
  alternates: { canonical: `${getSiteOrigin()}/about` },
  openGraph: {
    title: "About dreyv",
    description:
      "Independent software company building a non-custodial treasury workspace for Solana teams. Founded 2025, Nicosia, Cyprus.",
    url: `${getSiteOrigin()}/about`,
    type: "website",
    images: [{ url: "/og/about.jpg", width: 1200, height: 630, alt: "About dreyv" }],
  },
  robots: { index: true, follow: true },
};

const facts = [
  { k: "Name", v: "dreyv" },
  { k: "Founded", v: "2025" },
  { k: "Headquarters", v: "Nicosia, Cyprus" },
  { k: "Category", v: "Developer tools and fintech SaaS" },
  { k: "Stage", v: "Beta" },
];

const contacts = [
  { k: "General", v: "hello@dreyv.app" },
  { k: "Samuel", v: "samuel@dreyv.com" },
];

const ships = [
  {
    name: "dreyv app",
    body: "The treasury workspace: natural-language command bar, simulation, impact reports, multisig routing.",
  },
  {
    name: "dreyv atlas",
    body: "Solana intelligence: tokens, yields, MEV, rug signals and a strategy lab.",
  },
  {
    name: "Developer API and MCP server",
    body: "The same capabilities exposed as REST endpoints and an MCP server for AI agents.",
  },
  {
    name: "dreyv studio",
    body: "A browser IDE for building and shipping treasury mini-apps and agents.",
  },
];

export default function AboutPage() {
  return (
    <MarketingShell header={<SiteHeader overlay current="/about" />}>
      <PageHero
        art="about"
        title="A treasury workspace for teams on Solana."
        sub={
          <>
            dreyv (pronounced &ldquo;drave&rdquo;) is a non-custodial treasury workspace for Solana DAOs, protocols
            and crypto-native operators.
          </>
        }
      />

      <section className="mk-section" aria-labelledby="what">
        <div className="mk-wrap-text mk-stack">
          <h2 id="what" className="mk-sr">
            What dreyv is
          </h2>
          <p className="mk-lede" style={{ color: "var(--mk-ink)" }}>
            Teams describe what they want to do in plain English, such as rebalance, pay contributors, hedge stablecoin
            exposure or run a DCA. dreyv compiles the intent into a plan, simulates it against live onchain state,
            shows a human-readable impact report, and routes the final transaction to the team&rsquo;s existing
            multisig (Squads and compatible signers) for human approval. dreyv never holds funds and never holds
            private keys.
          </p>
          <p className="mk-body">
            The product is sold as a SaaS subscription with three tiers (Free, Mini at $49 a month, Max at $199 a
            month) and includes a developer surface: a public REST API, an MCP server, and an agent payments layer
            that other builders use to add treasury capabilities to their own products and AI agents. We are an
            independent software company, not a custodian, broker-dealer, or investment adviser, and we do not offer
            financial advice.
          </p>
        </div>
      </section>

      <section className="mk-section mk-night" aria-labelledby="team">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="team" className="mk-h2">
            Samuel Adu-Berekorang builds dreyv from Nicosia.
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 24 }}>
            He works on developer tools for AI agents and onchain finance, and does the product, the engineering and
            the selling for dreyv himself.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <a
              href="https://www.linkedin.com/in/samueladuberekorangx"
              target="_blank"
              rel="noopener noreferrer"
              className="mk-btn mk-btn-ghost-light"
            >
              Samuel on LinkedIn
            </a>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="ships">
        <div className="mk-wrap mk-split">
          <h2 id="ships" className="mk-h2 mk-sticky" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
            What we ship
          </h2>
          <ul className="mk-list">
            {ships.map((s) => (
              <li key={s.name} className="mk-row">
                <h3 className="mk-h3">{s.name}</h3>
                <p className="mk-body">{s.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section mk-bg-light" aria-labelledby="company">
        <div className="mk-wrap mk-two">
          <div>
            <h2 id="company" className="mk-h3">
              Company
            </h2>
            <dl className="mk-list" style={{ marginTop: 20 }}>
              {facts.map((f) => (
                <div key={f.k} className="mk-row" style={{ borderBottom: "1px solid var(--mk-rule)", padding: "14px 0" }}>
                  <dt className="mk-small">{f.k}</dt>
                  <dd className="mk-body" style={{ margin: 0, color: "var(--mk-ink)" }}>
                    {f.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="mk-h3">Contact</h2>
            <dl className="mk-list" style={{ marginTop: 20 }}>
              {contacts.map((c) => (
                <div key={c.k} className="mk-row" style={{ borderBottom: "1px solid var(--mk-rule)", padding: "14px 0" }}>
                  <dt className="mk-small">{c.k}</dt>
                  <dd className="mk-body" style={{ margin: 0 }}>
                    <a href={`mailto:${c.v}`} className="mk-link">
                      {c.v}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="mk-section mk-violet" aria-labelledby="next">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="next" className="mk-h2">
            See it for yourself.
          </h2>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 36 }}>
            <Link href="/pricing" className="mk-btn mk-btn-light">
              See pricing
            </Link>
            <Link href="/developers" className="mk-btn mk-btn-ghost-light">
              Developer hub
            </Link>
            <a href="mailto:hello@dreyv.app" className="mk-btn mk-btn-ghost-light">
              Contact us
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
