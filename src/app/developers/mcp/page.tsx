import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";
import { CopyCode } from "@/components/marketing/copy-code";
import { listPublicCapabilities } from "@/lib/capabilities/registry";

const CAP_COUNT = listPublicCapabilities().length;

export const metadata: Metadata = {
  title: "dreyv MCP server: connect any agent to Web3",
  description: `dreyv exposes ${CAP_COUNT} Web3 tools as an MCP server over Streamable HTTP. Add it to Claude Desktop, Cursor or any MCP-aware agent with one Bearer key.`,
  alternates: { canonical: "/developers/mcp" },
  openGraph: {
    title: "dreyv MCP server",
    description: "Streamable HTTP MCP server with simulation, forensics, intents and agent primitives across chains.",
    url: "/developers/mcp",
    images: [{ url: "/og/developers.jpg", width: 1200, height: 630, alt: "dreyv MCP server" }],
  },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://dreyv.com/" },
    { "@type": "ListItem", position: 2, name: "Developers", item: "https://dreyv.com/developers" },
    { "@type": "ListItem", position: 3, name: "MCP server", item: "https://dreyv.com/developers/mcp" },
  ],
};

export default function DevelopersMcpPage() {
  const caps = listPublicCapabilities();

  const claude = JSON.stringify(
    { mcpServers: { dreyv: { url: "https://dreyv.com/api/mcp", headers: { Authorization: "Bearer dk_live_YOUR_KEY" } } } },
    null,
    2,
  );
  const cursor = JSON.stringify(
    {
      mcpServers: {
        dreyv: { url: "https://dreyv.com/api/mcp", transport: "http", headers: { Authorization: "Bearer dk_live_YOUR_KEY" } },
      },
    },
    null,
    2,
  );

  return (
    <MarketingShell header={<SiteHeader overlay current="/developers" />}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PageHero
        art="developers"
        title="Connect your agent to dreyv over MCP."
        sub={
          <>
            Streamable HTTP at /api/mcp. All {CAP_COUNT} capabilities from our typed registry, exposed as MCP tools.
          </>
        }
        actions={
          <>
            <Link href="/auth?redirect=/app/developer" className="mk-btn mk-btn-solid">
              Mint a key
            </Link>
            <Link href="/developers/api" className="mk-btn mk-btn-outline">
              REST reference
            </Link>
          </>
        }
      />

      <section className="mk-section" aria-labelledby="install">
        <div className="mk-wrap">
          <h2 id="install" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)", textAlign: "center" }}>
            Install
          </h2>
          <div className="mk-two" style={{ marginTop: "clamp(32px, 5vh, 48px)" }}>
            <div>
              <h3 className="mk-h4">Claude Desktop</h3>
              <div style={{ marginTop: 12 }}>
                <CopyCode code={claude} label="Claude Desktop configuration" />
              </div>
              <p className="mk-small" style={{ marginTop: 12 }}>
                Paste into <code className="mk-mono">~/Library/Application Support/Claude/claude_desktop_config.json</code>{" "}
                and restart Claude.
              </p>
            </div>
            <div>
              <h3 className="mk-h4">Cursor</h3>
              <div style={{ marginTop: 12 }}>
                <CopyCode code={cursor} label="Cursor configuration" />
              </div>
              <p className="mk-small" style={{ marginTop: 12 }}>
                In Cursor, open Settings, then MCP, then Add server, and paste the JSON above.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section mk-bg-light" aria-labelledby="tools">
        <div className="mk-wrap mk-split">
          <div className="mk-sticky">
            <h2 id="tools" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              Tools exposed
            </h2>
            <p className="mk-body" style={{ marginTop: 18 }}>
              Identity, portfolio, treasury, market, execution, forensics, simulation, intents, x402 and foresight.{" "}
              <span className="mk-tnum">{caps.length}</span> tools, each with its scope. The same list is public at{" "}
              <a href="/api/mcp/manifest" className="mk-link">
                /api/mcp/manifest
              </a>
              .
            </p>
          </div>
          <ul className="mk-list">
            {caps.map((c) => (
              <li key={c.id} className="mk-row">
                <span>
                  <code className="mk-mono" style={{ color: "var(--mk-violet)", fontSize: 14, fontWeight: 600 }}>
                    {c.mcpName}
                  </code>
                  <span className="mk-small" style={{ display: "block", marginTop: 4 }}>
                    scope: {c.scope}
                  </span>
                </span>
                <span>
                  <span className="mk-h4" style={{ display: "block" }}>
                    {c.title}
                  </span>
                  <span className="mk-body" style={{ display: "block", fontSize: 15.5, marginTop: 4 }}>
                    {c.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section mk-night" aria-labelledby="transport">
        <div className="mk-wrap-text mk-center">
          <h2 id="transport" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
            Transport notes
          </h2>
          <p className="mk-lede" style={{ marginTop: 20 }}>
            The dreyv MCP server speaks Streamable HTTP per the MCP spec. POST requests must include{" "}
            <code className="mk-mono">Accept: application/json, text/event-stream</code>. Rate limits, scope enforcement
            and per-key usage metering are identical to the REST surface. Both transports share the same typed
            capability registry.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
