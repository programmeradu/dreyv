import Link from "next/link";
import { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";
import { GUIDES, type GuideEntry } from "@/lib/seo/guides";

/** Kept for any guide body that still imports it. A plain arrow, no icon set. */
export function ArrowMark({ className = "" }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      &rarr;
    </span>
  );
}

interface GuideShellProps {
  topic: string;
  guide: Pick<GuideEntry, "title" | "description" | "publishedAt" | "readMinutes" | "slug">;
  children: ReactNode;
}

export function GuideShell({ topic, guide, children }: GuideShellProps) {
  const others = GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 3);
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://dreyv.com/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: "https://dreyv.com/guides" },
      { "@type": "ListItem", position: 3, name: guide.title, item: `https://dreyv.com/guides/${guide.slug}` },
    ],
  };

  return (
    <MarketingShell header={<SiteHeader overlay />}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PageHero
        art="guides"
        compact
        title={guide.title}
        sub={guide.description}
        meta={
          <>
            <Link href="/guides" className="mk-link">
              All guides
            </Link>
            <span className="mk-tnum">
              {" "}
              &nbsp; {topic}, {guide.publishedAt}, about {guide.readMinutes} min read
            </span>
          </>
        }
      />

      <section className="mk-section" style={{ paddingTop: "clamp(56px, 9vh, 96px)" }} aria-label="Guide">
        <article className="mk-wrap-text mk-prose">{children}</article>
      </section>

      <section className="mk-section mk-violet" aria-labelledby="practice">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="practice" className="mk-h2" style={{ fontSize: "clamp(34px, 4.4vw, 60px)" }}>
            Put this guide into practice
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
            Open dreyv, describe what you want, simulate the impact, and approve from your multisig.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/auth?redirect=/app" className="mk-btn mk-btn-light">
              Open dreyv
            </Link>
          </div>
        </div>
      </section>

      {others.length > 0 && (
        <section className="mk-section mk-bg-light" aria-labelledby="more">
          <div className="mk-wrap mk-split">
            <h2 id="more" className="mk-h2 mk-sticky" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              More guides
            </h2>
            <ul className="mk-list">
              {others.map((g) => (
                <li key={g.slug}>
                  <Link href={`/guides/${g.slug}`} className="mk-row mk-row-link">
                    <span className="mk-h3">{g.title}</span>
                    <span className="mk-body">{g.teaser}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </MarketingShell>
  );
}
