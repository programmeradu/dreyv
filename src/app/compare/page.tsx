import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Compare dreyv with Squads, Jupiter, Birdeye and dashboards",
  description:
    "How dreyv compares to Squads multisig, the Jupiter swap UI, Birdeye analytics and read-only treasury dashboards: plain-language intent, simulation before signing, non-custodial, multisig-native.",
  alternates: { canonical: "/compare" },
  openGraph: {
    title: "dreyv compared with Squads, Jupiter and Birdeye",
    description: "Side by side: plain-language intent, simulation before signing, non-custodial, multisig-native.",
    url: "/compare",
    images: [{ url: "/og/compare.png", width: 1200, height: 630, alt: "dreyv compared" }],
  },
};

type V = boolean | "partial";
type Row = { label: string; dreyv: V; squads: V; jupiter: V; birdeye: V };

const rows: Row[] = [
  { label: "Non-custodial", dreyv: true, squads: true, jupiter: true, birdeye: true },
  { label: "Multisig-native (Squads)", dreyv: true, squads: true, jupiter: false, birdeye: false },
  { label: "Plain-language intent to plan (AI)", dreyv: true, squads: false, jupiter: false, birdeye: false },
  { label: "Forked-state simulation before signing", dreyv: true, squads: false, jupiter: false, birdeye: false },
  { label: "Human-readable impact for approvers", dreyv: true, squads: "partial", jupiter: false, birdeye: false },
  { label: "Swap routing (Jupiter)", dreyv: true, squads: false, jupiter: true, birdeye: false },
  { label: "Onchain analytics and token research", dreyv: true, squads: false, jupiter: "partial", birdeye: true },
  { label: "MEV and rug-pull scanners", dreyv: true, squads: false, jupiter: false, birdeye: "partial" },
  { label: "Yield routing (Marinade, Jito, Blaze)", dreyv: true, squads: false, jupiter: false, birdeye: false },
  { label: "Persistent knowledge memory (GraphRAG)", dreyv: true, squads: false, jupiter: false, birdeye: false },
  { label: "Build mini-apps and agents (Studio)", dreyv: true, squads: false, jupiter: false, birdeye: false },
  { label: "OpenAPI, MCP, ACP and x402 surface", dreyv: true, squads: false, jupiter: "partial", birdeye: false },
];

function Cell({ v }: { v: V }) {
  if (v === true) return <span className="mk-yes">Yes</span>;
  if (v === false) return <span className="mk-no">No</span>;
  return <span className="mk-partial">Partial</span>;
}

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://dreyv.com/" },
    { "@type": "ListItem", position: 2, name: "Compare", item: "https://dreyv.com/compare" },
  ],
};

export default function ComparePage() {
  return (
    <MarketingShell header={<SiteHeader overlay />}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PageHero
        art="compare"
        title="dreyv vs Squads, Jupiter and Birdeye"
        sub="Most teams stitch together a multisig, a swap UI, an analytics dashboard and a chat channel. dreyv brings that into one non-custodial workspace where you describe intent, preview outcomes and propose to your multisig."
        actions={
          <>
            <Link href="/auth?redirect=/app" className="mk-btn mk-btn-solid">
              Try dreyv free
            </Link>
            <Link href="/pricing" className="mk-btn mk-btn-outline">
              See pricing
            </Link>
          </>
        }
      />

      <section className="mk-section" aria-labelledby="matrix">
        <div className="mk-wrap">
          <h2 id="matrix" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)", textAlign: "center" }}>
            Side by side
          </h2>
          <div className="mk-table-wrap" style={{ marginTop: "clamp(32px, 5vh, 48px)" }} tabIndex={0} aria-label="Capability comparison table">
            <table className="mk-table">
              <caption className="mk-sr">Capabilities of dreyv, Squads, Jupiter and Birdeye</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", paddingLeft: 0 }}>
                    Capability
                  </th>
                  <th scope="col" className="mk-col-us">
                    dreyv
                  </th>
                  <th scope="col">Squads</th>
                  <th scope="col">Jupiter</th>
                  <th scope="col">Birdeye</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td className="mk-col-us">
                      <Cell v={r.dreyv} />
                    </td>
                    <td>
                      <Cell v={r.squads} />
                    </td>
                    <td>
                      <Cell v={r.jupiter} />
                    </td>
                    <td>
                      <Cell v={r.birdeye} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mk-section mk-bg-light" aria-labelledby="wins">
        <div className="mk-wrap mk-two" style={{ alignItems: "start" }}>
          <div>
            <h2 id="wins" className="mk-h3">
              Where dreyv wins
            </h2>
            <ul className="mk-list" style={{ marginTop: 20 }}>
              <li className="mk-body">Plain-language intent: describe a treasury plan in one sentence.</li>
              <li className="mk-body">Forked simulation with human-readable impact before any signature.</li>
              <li className="mk-body">A multisig-native (Squads) workflow with the simulation attached.</li>
              <li className="mk-body">An agent-ready surface: OpenAPI, MCP, ACP, UCP and x402.</li>
            </ul>
          </div>
          <div>
            <h2 className="mk-h3">Where the others still shine</h2>
            <ul className="mk-list" style={{ marginTop: 20 }}>
              <li className="mk-body">
                <strong style={{ color: "var(--mk-ink)" }}>Squads:</strong> deep, audited multisig primitives. dreyv
                builds on top of them.
              </li>
              <li className="mk-body">
                <strong style={{ color: "var(--mk-ink)" }}>Jupiter:</strong> excellent swap routing. dreyv uses Jupiter
                quotes inside plans.
              </li>
              <li className="mk-body">
                <strong style={{ color: "var(--mk-ink)" }}>Birdeye:</strong> rich market data. dreyv complements it
                with intent and execution.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mk-section mk-violet" aria-labelledby="cta">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="cta" className="mk-h2">
            Stop stitching tools. Start describing intent.
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
            Connect a wallet, simulate a plan and propose it to your multisig, all from one non-custodial workspace.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/auth?redirect=/app" className="mk-btn mk-btn-light">
              Try dreyv free
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
