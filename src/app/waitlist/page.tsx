import type { Metadata } from "next";
import { WaitlistForm } from "./waitlist-form";
import { COHORT_WINDOW } from "@/lib/waitlist/constants";
import { getSiteOrigin } from "@/lib/seo/site";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";

const TITLE = "Join the dreyv waitlist";
const DESCRIPTION =
  "dreyv onboards treasuries, DAOs, funds and protocols in small cohorts so every account gets a real walkthrough. Tell us about your stack and we will send a seat when your slot opens.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${getSiteOrigin()}/waitlist` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${getSiteOrigin()}/waitlist`,
    type: "website",
    images: [{ url: "/og/waitlist.png", width: 1200, height: 630, alt: "Join the dreyv waitlist" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og/waitlist.png"] },
};

const steps = [
  {
    title: "Confirmation",
    body: "You\u2019ll get an email confirming your position. No countdown timers, no fake urgency.",
  },
  {
    title: "Cohort review",
    body: "We pick each cohort by fit (chain, stack, treasury shape), not by signup order.",
  },
  {
    title: "Single-use invite",
    body: "When you\u2019re up, you get a single-use invite link valid for 14 days. Connect a wallet and you\u2019re in.",
  },
];

export default function WaitlistPage() {
  return (
    <MarketingShell header={<SiteHeader overlay />}>
      <PageHero
        art="waitlist"
        title="Join the waitlist."
        sub="dreyv is the non-custodial treasury workspace for teams that want intent, plan, simulation and signing in one place. We onboard in small cohorts so every account gets a real walkthrough. Tell us about your stack and we\u2019ll send a seat when your slot opens."
        actions={
          <a href="#request" className="mk-btn mk-btn-solid">
            Request your seat
          </a>
        }
        meta={`Onboarding window: ${COHORT_WINDOW}.`}
      />

      <section id="request" className="mk-section mk-anchor" aria-labelledby="request-h">
        <div className="mk-wrap-text">
          <div style={{ textAlign: "center" }}>
            <h2 id="request-h" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              Request your seat
            </h2>
            <p className="mk-body" style={{ marginTop: 14 }}>
              A few details so we can place you in the right cohort.
            </p>
          </div>
          <div style={{ marginTop: "clamp(32px, 5vh, 48px)" }}>
            <WaitlistForm />
          </div>
        </div>
      </section>

      <section className="mk-section mk-bg-light" aria-labelledby="next-h">
        <div className="mk-wrap mk-split">
          <h2 id="next-h" className="mk-h2 mk-sticky" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
            What happens next
          </h2>
          <ol className="mk-list">
            {steps.map((s) => (
              <li key={s.title} className="mk-row">
                <h3 className="mk-h3">{s.title}</h3>
                <p className="mk-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </MarketingShell>
  );
}
