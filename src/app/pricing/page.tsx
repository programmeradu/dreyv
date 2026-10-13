import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";
import { FoundingNote } from "@/components/marketing/founding-note";

const pricingTitle = "Pricing";
const pricingDescription =
  "dreyv pricing: Free, Mini and Max plans for a non-custodial treasury workspace on Solana. Billed via Paystack; taxes shown at checkout.";

export const metadata: Metadata = {
  title: pricingTitle,
  description: pricingDescription,
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    url: "/pricing",
    title: `${pricingTitle} | dreyv: Free, Mini, Max`,
    description: pricingDescription,
    siteName: "dreyv",
    images: [{ url: "/og/pricing.jpg", width: 1200, height: 630, alt: "dreyv pricing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${pricingTitle} | dreyv: Free, Mini, Max`,
    description: pricingDescription,
    images: ["/og/pricing.jpg"],
  },
};

type Tier = {
  name: string;
  tagline: string;
  price: string;
  blurb: string;
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
};

// Source of truth: src/lib/tier-config.ts
const tiers: Tier[] = [
  {
    name: "Free",
    tagline: "Solo operators",
    price: "$0",
    blurb: "Enough for one person to plan, simulate and sign.",
    features: [
      "1 multisig vault",
      "Up to 2 teammates",
      "3 mini-apps",
      "10 agent runs a day",
      "60 API calls an hour",
      "1 GB storage",
    ],
    cta: { label: "Get started", href: "/auth?redirect=/app" },
  },
  {
    name: "Mini",
    tagline: "Small teams",
    price: "$49",
    blurb: "More vaults, more seats and more agent runs.",
    features: [
      "Up to 5 multisig vaults",
      "10 teammates per vault",
      "25 mini-apps",
      "100 agent runs a day",
      "Advanced analytics and SSE",
      "PDF export and 10 GB storage",
    ],
    cta: { label: "Upgrade", href: "/auth?redirect=/app/billing" },
    featured: true,
  },
  {
    name: "Max",
    tagline: "Larger treasuries",
    price: "$199",
    blurb: "No caps, help getting set up, and your own RPC endpoints.",
    features: [
      "Unlimited vaults and teammates",
      "Unlimited mini-apps and agent runs",
      "5,000 API calls an hour",
      "Custom branding",
      "Priority support",
      "100 GB storage",
    ],
    cta: { label: "Upgrade", href: "/auth?redirect=/app/billing" },
  },
];

const guarantees = [
  {
    title: "Non-custodial by default",
    body: "Keys stay with your multisig. dreyv never holds funds or co-signs without you.",
  },
  {
    title: "Simulate before you sign",
    body: "Every plan runs on a copy of mainnet first, and every approver sees the result in plain words.",
  },
  {
    title: "Made for teams",
    body: "Roles, approvals and a record of who did what.",
  },
];

export default function PricingPage() {
  return (
    <MarketingShell header={<SiteHeader overlay current="/pricing" />}>
      <PageHero
        art="pricing"
        title="Pricing"
        sub="Every plan works the same way: say what you want, see it simulated, then sign it in your multisig. Paid plans add vaults, seats and agent runs."
        actions={
          <Link href="/auth?redirect=/app" className="mk-btn mk-btn-solid">
            Start free
          </Link>
        }
        meta="Free plan, no card. Prices in USD."
      />

      <section className="mk-section" aria-labelledby="plans" style={{ paddingTop: "clamp(64px, 10vh, 120px)" }}>
        <div className="mk-wrap">
          <h2 id="plans" className="mk-sr">
            Plans
          </h2>
          <FoundingNote />
          <div className="mk-tiers">
            {tiers.map((t) => (
              <div key={t.name} className={t.featured ? "mk-tier mk-tier-featured" : "mk-tier"}>
                <h3 className="mk-h3">{t.name}</h3>
                <p className="mk-small" style={{ marginTop: 4 }}>
                  {t.tagline}
                </p>
                <p className="mk-tier-price mk-tnum">
                  {t.price}
                  <span>a month</span>
                </p>
                <p className="mk-small">{t.price === "$0" ? "No card required" : "Excludes tax, shown at checkout"}</p>
                <p className="mk-body" style={{ marginTop: 16, fontSize: 16 }}>
                  {t.blurb}
                </p>
                <ul>
                  {t.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <Link
                  href={t.cta.href}
                  className={t.featured ? "mk-btn mk-btn-solid" : "mk-btn mk-btn-outline"}
                  style={{ alignSelf: "flex-start" }}
                >
                  {t.cta.label}
                  <span className="mk-sr"> to {t.name}</span>
                </Link>
              </div>
            ))}
          </div>
          <p className="mk-small" style={{ marginTop: 28, maxWidth: "72ch" }}>
            Prices in USD. Taxes calculated at checkout. Cancel anytime from your billing portal. Paid plans are billed
            securely through Paystack, and checkout shows your total including applicable taxes.{" "}
            <Link href="/legal/refunds" className="mk-link">
              Refund policy
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="mk-section mk-bg-light" aria-labelledby="promises">
        <div className="mk-wrap mk-split">
          <h2 id="promises" className="mk-h2 mk-sticky" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
            On every plan
          </h2>
          <ul className="mk-list">
            {guarantees.map((g) => (
              <li key={g.title} className="mk-row">
                <h3 className="mk-h3">{g.title}</h3>
                <p className="mk-body">{g.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section mk-night" aria-labelledby="custom">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="custom" className="mk-h2">
            Need something custom?
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 24 }}>
            Write to us about dedicated infrastructure or custom integrations for funds, DAOs and protocols.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 36 }}>
            <a href="mailto:hello@dreyv.app?subject=dreyv%20enterprise" className="mk-btn mk-btn-light">
              Email us
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
