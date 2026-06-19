import { HOME_FAQ_ITEMS } from "./home-faq";
import { getOrgSameAsFromEnv, getSiteOrigin } from "./site";

const DEFAULT_ORG_SAME_AS = [
  "https://www.producthunt.com/products/dreyv",
  "https://x.com/dreyvapp",
  "https://www.linkedin.com/company/dreyv/",
];

function organizationSameAs(): string[] {
  return [...new Set([...DEFAULT_ORG_SAME_AS, ...getOrgSameAsFromEnv()])];
}

/**
 * Sitewide JSON-LD @graph: Organization + WebSite + SoftwareApplication only.
 * WebPage and FAQPage are emitted per-route (see `buildHomeJsonLd`) because
 * they describe a specific URL, not the whole site.
 */
export function buildRootJsonLd(): Record<string, unknown> {
  const origin = getSiteOrigin();
  const logoUrl = `${origin}/icon.png`;
  const orgId = `${origin}/#organization`;
  const sameAs = organizationSameAs();

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: "dreyv",
        legalName: "dreyv",
        alternateName: ["dreyv atlas", "dreyv.com"],
        url: origin,
        slogan: "Treasury command layer for Solana teams — AI-native, non-custodial.",
        sameAs,
        logo: {
          "@type": "ImageObject",
          url: logoUrl,
        },
        parentOrganization: {
          "@type": "Organization",
          name: "StaUniverse",
          url: "https://stauniverse.tech",
        },
        description:
          "dreyv is the AI-powered, non-custodial treasury command layer for Solana teams: plain-language intent, simulation before signing, human-readable impact for approvers, and multisig-native workflows (e.g. Squads). dreyv atlas is the Solana intelligence surface inside the product.",
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "dreyv",
        alternateName: ["dreyv.com"],
        url: origin,
        publisher: { "@id": orgId },
        inLanguage: "en-US",
        description:
          "Official site for dreyv — AI treasury workspace and dreyv atlas for Solana DAOs and protocols.",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#product`,
        name: "dreyv",
        alternateName: ["dreyv atlas"],
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free tier available; paid plans for teams.",
        },
        description:
          "Treasury command layer for Solana: describe intent in natural language, review fork simulation and human-readable impact, coordinate multisig signing. Includes dreyv atlas, Studio, and agent-ready automation paths. Free tier available.",
        url: origin,
        provider: { "@id": orgId },
      },
    ],
  };
}

/**
 * Homepage JSON-LD: WebPage (route-specific @id) + FAQPage.
 * Render this only on `/` — the FAQ content lives there.
 */
export function buildHomeJsonLd(): Record<string, unknown> {
  const origin = getSiteOrigin().replace(/\/$/, "");
  const url = `${origin}/`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: "dreyv — AI treasury for Solana & Web3 teams",
        isPartOf: { "@id": `${origin}/#website` },
        inLanguage: "en-US",
        primaryImageOfPage: { "@type": "ImageObject", url: `${origin}/opengraph-image` },
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["h1", "[data-speakable]", ".hero-tagline", ".hero-subtitle"],
          xpath: ["/html/head/title", "/html/head/meta[@name='description']/@content"],
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: HOME_FAQ_ITEMS.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
    ],
  };
}

/** Article / long-form guide (rich results–friendly when content is substantive). */
export function buildArticleJsonLd(opts: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified?: string;
}): Record<string, unknown> {
  const origin = getSiteOrigin().replace(/\/$/, "");
  const url = `${origin}${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;
  const modified = opts.dateModified ?? opts.datePublished;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: opts.datePublished,
    dateModified: modified,
    author: { "@id": `${origin}/#organization` },
    publisher: { "@id": `${origin}/#organization` },
  };
}
