import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";
import { GUIDES } from "@/lib/seo/guides";

const TITLE = "Guides";
const DESCRIPTION =
  "Practical guides for Solana treasury teams: intent-driven workflows, Squads multisig setup, DAO treasury playbooks and DCA strategies.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: {
    title: `${TITLE} | dreyv`,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/og/guides.png", width: 1200, height: 630, alt: "dreyv guides" }],
  },
};

const TOPIC_TAG: Record<string, string> = {
  "intent-driven-treasury-solana": "Workflow",
  "solana-dao-treasury-management": "Playbook",
  "squads-multisig-setup-guide": "Multisig",
  "dca-on-solana-guide": "DCA",
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://dreyv.com/" },
    { "@type": "ListItem", position: 2, name: "Guides", item: "https://dreyv.com/guides" },
  ],
};

export default function GuidesIndexPage() {
  const sorted = [...GUIDES].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const [featured, ...rest] = sorted;

  return (
    <MarketingShell header={<SiteHeader overlay />}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PageHero
        art="guides"
        title="Practical guides for Solana treasury teams"
        sub="Multisig setup, treasury structure, DCA programs, and the case for intent-driven workflows. Written for operators, not maximalists."
      />

      {featured && (
        <section className="mk-section mk-night" aria-labelledby="featured">
          <div className="mk-wrap-narrow mk-center">
            <p className="mk-small mk-tnum" style={{ color: "var(--mk-on-night-2)" }}>
              Latest guide, {featured.publishedAt}, {featured.readMinutes} min read
            </p>
            <h2 id="featured" className="mk-h2" style={{ marginTop: 16 }}>
              <Link href={`/guides/${featured.slug}`} style={{ textDecoration: "none" }}>
                {featured.title}
              </Link>
            </h2>
            <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
              {featured.teaser}
            </p>
            <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
              <Link href={`/guides/${featured.slug}`} className="mk-btn mk-btn-light">
                Read the guide <span className="mk-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="mk-section" aria-labelledby="more">
          <div className="mk-wrap mk-split">
            <div className="mk-sticky">
              <h2 id="more" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
                More guides
              </h2>
              <p className="mk-body mk-tnum" style={{ marginTop: 14 }}>
                {rest.length} {rest.length === 1 ? "article" : "articles"}
              </p>
            </div>
            <ul className="mk-list">
              {rest.map((g) => (
                <li key={g.slug}>
                  <Link href={`/guides/${g.slug}`} className="mk-row mk-row-link">
                    <span>
                      <span className="mk-h3" style={{ display: "block" }}>
                        {g.title}
                      </span>
                      <span className="mk-small mk-tnum" style={{ display: "block", marginTop: 8 }}>
                        {TOPIC_TAG[g.slug] ?? "Guide"}, {g.publishedAt}, {g.readMinutes} min read
                      </span>
                    </span>
                    <span className="mk-body">{g.teaser}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mk-section mk-violet" aria-labelledby="practice">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="practice" className="mk-h2">
            Ready to put a guide into practice?
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
            Open dreyv, describe what you want in plain English, simulate the impact, and approve from your multisig.
            Free to start.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/auth?redirect=/app" className="mk-btn mk-btn-light">
              Open dreyv
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
