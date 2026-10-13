import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <MarketingShell header={<SiteHeader />}>
      <section className="mk-section mk-screen" aria-labelledby="nf-title" style={{ paddingTop: 40 }}>
        <div className="mk-wrap-text mk-center" style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/mascot-think.webp"
            alt="The dreyv mascot, thinking"
            width={197}
            height={360}
            style={{ width: 110, height: "auto", margin: "0 auto" }}
          />
          <h1 id="nf-title" className="mk-h1" style={{ fontSize: "clamp(40px, 6vw, 80px)", marginTop: 24 }}>
            This page isn&rsquo;t here.
          </h1>
          <p className="mk-lede" style={{ marginTop: 20 }}>
            The link may be old, or the page moved. Everything else is where you left it.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/" className="mk-btn mk-btn-solid">
              Go home
            </Link>
            <Link href="/guides" className="mk-btn mk-btn-outline">
              Read the guides
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
