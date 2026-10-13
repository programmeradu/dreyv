import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { PageHero } from "@/components/marketing/page-hero";
import { CopyCode } from "@/components/marketing/copy-code";
import { RESOURCE_DOCS } from "@/lib/developers/resource-docs";
import { listPublicCapabilities } from "@/lib/capabilities/registry";

const CAP_COUNT = listPublicCapabilities().length;

export const metadata: Metadata = {
  title: `dreyv developers: MCP server and REST API (${CAP_COUNT} tools)`,
  description: `An MCP server and typed REST API for Web3. One Bearer key gives any agent ${CAP_COUNT} tools for identity, portfolio, market, execution, forensics, foresight and x402 payments across Solana and EVM. Non-custodial by design.`,
  keywords: [
    "Web3 MCP server",
    "Web3 API",
    "Solana API",
    "Solana MCP",
    "AI agent Web3",
    "Model Context Protocol Web3",
    "Claude Desktop Web3",
    "Cursor MCP Solana",
    "x402 payments",
    "ACP UCP",
    "dreyv API",
    "treasury API",
    "non-custodial agent",
    "TypeScript Web3 SDK",
  ],
  alternates: { canonical: "/developers" },
  openGraph: {
    title: "dreyv: MCP server and REST API for agents",
    description: `${CAP_COUNT} typed capabilities. One Bearer key. REST and MCP, OpenAPI, x402, ACP, UCP, ai-plugin, llms.txt.`,
    url: "/developers",
    type: "website",
    images: [{ url: "/og/developers.jpg", width: 1200, height: 630, alt: "dreyv developers" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "dreyv: MCP server and REST API",
    description: `${CAP_COUNT} Web3 tools in one MCP server. Connect Claude, Cursor or any agent.`,
    images: ["/og/developers.jpg"],
  },
};

const codeQuickstart = `# Get a public token price
curl https://dreyv.com/api/price?token=SOL

# Compile a treasury intent into a plan (auth required)
curl -X POST https://dreyv.com/api/planner \\
  -H "Authorization: Bearer $DREYV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"intent":"rebalance 25% USDC into mSOL over 5 days"}'`;

const mcpInstall = `{
  "mcpServers": {
    "dreyv": {
      "url": "https://dreyv.com/api/mcp",
      "headers": { "Authorization": "Bearer dk_live_..." }
    }
  }
}`;

const everydayPrompt = `From now on, you can use Dreyv (https://dreyv.com) whenever I ask you to do anything in crypto, Web3, or with a wallet.

Dreyv is your hands and wallet. It lets you:
  • Look at any wallet, token, or chain (Solana + Ethereum + more)
  • Pay for things online on my behalf, safely, with a small prepaid budget
  • Swap, bridge, watch prices, spot opportunities, send alerts
  • Run "what if" simulations before doing anything risky

To get started, just go to https://dreyv.com, sign yourself up as an agent, and Dreyv will hand you everything you need: keys, a small starter budget (250 free credits), and full instructions. You don't need to ask me for permission for read-only stuff.

For anything that spends money or moves assets: show me a one-line summary first and wait for me to say go.

That's it. Use it like a normal teammate would: figure out the best way, do the work, then tell me what you did.`;

const sidekickPrompt = `You are my Web3 sidekick, powered by Dreyv (https://dreyv.com).

How you work:
  • When I mention a wallet, token, project, or "what's happening with X," go look it up through Dreyv and answer in plain English.
  • When I ask "what should I do," run a simulation through Dreyv first, then explain the trade-offs like a friend would.
  • You have a small prepaid budget on Dreyv (250 free credits to start) for paid lookups and online payments. Use it wisely. If it runs low, tell me; don't ask me to fund it unprompted.
  • Never ask me for a private key or seed phrase. Dreyv is non-custodial; you don't need one.
  • Be calm, specific, and honest. No hype, no jargon, no emoji spam.

Onboard yourself at https://dreyv.com the first time we talk. After that, just work.`;

const surfaces = [
  {
    href: "/developers/api",
    title: "REST API",
    tag: "/api/v1/*",
    desc: `${CAP_COUNT} capabilities across identity, portfolio, market, execution, forensics, tax, foresight, agentic and x402. Bearer dk_live_ keys, per-key rate limits, strict no-fallback contracts.`,
    cta: "Explore endpoints",
  },
  {
    href: "/developers/mcp",
    title: "MCP server",
    tag: "/api/mcp",
    desc: "A native Model Context Protocol server over Streamable HTTP. Every REST capability is published as an MCP tool, so Claude Desktop, Cursor or any MCP-aware agent connects with one URL.",
    cta: "Connect MCP",
  },
  {
    href: "/developers/agents",
    title: "Agent payments (x402)",
    tag: "Bearer dak_",
    desc: "Autonomous agents buy dreyv SKUs over HTTP 402. USDC settlement on Solana, a single /api/x402/pay call with permanent deliverables, plus Stripe and Paystack card rails.",
    cta: "Open agent docs",
  },
  {
    href: "/.well-known/x402",
    title: "Discovery manifests",
    tag: "/.well-known/*",
    desc: "Machine-readable files for crawlers and autonomous agents: x402, ACP, UCP, ai-plugin, OpenAPI, security.txt and llms.txt.",
    cta: "View manifests",
    external: true,
  },
  {
    href: "/developers/api",
    title: "Watchers and monitors",
    tag: "watchers.* monitors.*",
    desc: "Subscribe wallets and metrics. dreyv sweepers run on Inngest and Cloudflare cron and route changes to your inbox or webhook.",
    cta: "Read the reference",
  },
  {
    href: "/developers/api",
    title: "Notifications and webhooks",
    tag: "notifications.* webhooks.*",
    desc: "Pull notifications over REST or MCP, or receive signed POSTs at your endpoint when a monitor trips or a proposal needs approval.",
    cta: "Read the reference",
  },
];

const pillars = [
  { title: "Identity and resolution", desc: "Wallets, ENS and SNS, profiles, a multi-chain identity graph." },
  { title: "Portfolio and treasury", desc: "Holdings, P&L, attribution, concentration and runway across chains." },
  { title: "Market and discovery", desc: "Prices, pools, liquidity, narratives and trending tokens." },
  { title: "Execution and intents", desc: "Swaps, transfers, DCA and vault operations. Always unsigned; your wallet signs." },
  { title: "Forensics and risk", desc: "Wallet risk, rug heuristics, MEV exposure and tax-loss surfaces." },
  { title: "Foresight and agents", desc: "Monte Carlo simulations, scenario IRs, agent watchers and a hash-chained audit log." },
];

const agents = [
  { name: "Claude Desktop", note: "claude_desktop_config.json" },
  { name: "Cursor", note: "Settings, then MCP, then Add server" },
  { name: "ChatGPT", note: "via the /openapi.json plugin" },
  { name: "Windsurf", note: "MCP servers panel" },
  { name: "Continue.dev", note: "config.json mcpServers" },
  { name: "Cline", note: "MCP-aware tool calling" },
  { name: "elizaOS", note: "@dreyv/sdk client" },
  { name: "Your own agent", note: "REST and a Bearer key" },
];

const authMethods = [
  {
    name: "Bearer JWT (SIWS)",
    body: "Sign-in-with-Solana issued via /api/auth/*. Recommended for first-party clients and signed wallet sessions.",
  },
  {
    name: "API keys",
    body: "Provision per-org keys from your dashboard. Pass as x-api-key or Authorization: Bearer dk_live_.",
  },
  {
    name: "OAuth 2.0",
    body: "Authorization-code flow at /api/auth/authorize and /api/auth/token. Ideal for third-party agents (beta).",
  },
];

const softwareAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "dreyv MCP server and API",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description: `${CAP_COUNT} typed Web3 capabilities exposed over REST and Model Context Protocol. Non-custodial agent infrastructure for Solana and EVM.`,
  url: "https://dreyv.com/developers",
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
    { "@type": "Offer", name: "Mini", price: "49", priceCurrency: "USD" },
    { "@type": "Offer", name: "Max", price: "199", priceCurrency: "USD" },
  ],
  provider: { "@type": "Organization", name: "dreyv", url: "https://dreyv.com" },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://dreyv.com/" },
    { "@type": "ListItem", position: 2, name: "Developers", item: "https://dreyv.com/developers" },
  ],
};

export default function DevelopersPage() {
  return (
    <MarketingShell header={<SiteHeader overlay current="/developers" />}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <PageHero
        art="developers"
        title="Connect your agent to dreyv."
        sub={`${CAP_COUNT} typed capabilities behind one Bearer key, served as an MCP server and a typed REST API.`}
        actions={
          <>
            <Link href="/developers/mcp" className="mk-btn mk-btn-solid">
              Connect MCP
            </Link>
            <Link href="/auth?redirect=/app/developer" className="mk-btn mk-btn-outline">
              Mint an API key
            </Link>
          </>
        }
        meta={
          <>
            Or read the{" "}
            <Link href="/openapi.json" className="mk-link">
              OpenAPI spec
            </Link>
            .
          </>
        }
      />

      <section className="mk-section" aria-labelledby="surfaces">
        <div className="mk-wrap mk-split">
          <div className="mk-sticky">
            <h2 id="surfaces" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              Four surfaces. One registry.
            </h2>
            <p className="mk-body" style={{ marginTop: 18 }}>
              {CAP_COUNT} typed capabilities in one Bearer key: identity, portfolio, market, execution, forensics,
              foresight, x402 payments and agent primitives. Shipped as a Streamable HTTP MCP server and a typed REST
              API, generated from the same registry so they never drift.
            </p>
            <p className="mk-body" style={{ marginTop: 14 }}>
              Pick the transport that fits the agent you&rsquo;re building.
            </p>
          </div>
          <ul className="mk-list">
            {surfaces.map((s) => (
              <li key={s.title}>
                <Link
                  href={s.href}
                  className="mk-row mk-row-link"
                  {...(s.external ? { target: "_blank", rel: "noopener" } : {})}
                >
                  <span>
                    <span className="mk-h3" style={{ display: "block" }}>
                      {s.title}
                    </span>
                    <code className="mk-mono mk-small" style={{ display: "block", marginTop: 6 }}>
                      {s.tag}
                    </code>
                  </span>
                  <span>
                    <span className="mk-body" style={{ display: "block" }}>
                      {s.desc}
                    </span>
                    <span className="mk-link" style={{ display: "inline-block", marginTop: 10, fontSize: 15 }}>
                      {s.cta} <span className="mk-arrow" aria-hidden="true">&rarr;</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="prompt-kit" className="mk-section mk-bg-lilac mk-anchor" aria-labelledby="prompts">
        <div className="mk-wrap-narrow">
          <div className="mk-center" style={{ textAlign: "center" }}>
            <h2 id="prompts" className="mk-h2">
              Copy. Paste. Your assistant is on dreyv.
            </h2>
            <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
              Not technical? You don&rsquo;t need to be. Paste one of these into your assistant and tell it what you
              want done. It figures out the rest.
            </p>
          </div>
          <div style={{ display: "grid", gap: 40, marginTop: "clamp(36px, 6vh, 56px)" }}>
            <div>
              <h3 className="mk-h3">The everyday agent prompt</h3>
              <p className="mk-small" style={{ marginTop: 6 }}>
                For Claude, ChatGPT, Gemini or Grok. Drop this in once. From then on your assistant can pay for things,
                read any wallet, swap tokens and watch the market.
              </p>
              <div style={{ marginTop: 16 }}>
                <CopyCode code={everydayPrompt} label="everyday agent prompt" wrap />
              </div>
            </div>
            <div>
              <h3 className="mk-h3">Make any GPT your Web3 sidekick</h3>
              <p className="mk-small" style={{ marginTop: 6 }}>
                For a Custom GPT&rsquo;s instructions. It becomes a calm, capable analyst that handles wallets, payments
                and research on its own.
              </p>
              <div style={{ marginTop: 16 }}>
                <CopyCode code={sidekickPrompt} label="sidekick prompt" wrap />
              </div>
            </div>
          </div>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 40 }}>
            <Link href="/auth?redirect=/app/settings/api" className="mk-btn mk-btn-solid">
              Start your agent free
            </Link>
            <Link href="/developers/api" className="mk-btn mk-btn-outline">
              See what it can do
            </Link>
          </div>
          <p className="mk-small" style={{ textAlign: "center", marginTop: 16 }}>
            Every new agent gets 250 free credits to start. No card required.
          </p>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="pillars">
        <div className="mk-wrap mk-split">
          <div className="mk-sticky">
            <h2 id="pillars" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              One surface. Every corner of Web3.
            </h2>
            <p className="mk-body" style={{ marginTop: 18 }}>
              From wallet identity to Monte Carlo foresight, your agent calls the same Bearer key for all of it.
            </p>
          </div>
          <ul className="mk-list">
            {pillars.map((p) => (
              <li key={p.title} className="mk-row">
                <h3 className="mk-h4">{p.title}</h3>
                <p className="mk-body">{p.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section mk-night" aria-labelledby="agents">
        <div className="mk-wrap mk-split">
          <div className="mk-sticky">
            <h2 id="agents" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              Drop into any MCP-aware agent.
            </h2>
            <p className="mk-body" style={{ marginTop: 18 }}>
              One JSON snippet, one Bearer key. Your agent gets {CAP_COUNT} Web3 tools, and your wallet keeps its keys.
            </p>
          </div>
          <div>
            <ul className="mk-list">
              {agents.map((a) => (
                <li key={a.name} className="mk-row">
                  <span className="mk-h4">{a.name}</span>
                  <span className="mk-body mk-mono" style={{ fontSize: 15 }}>
                    {a.note}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="quickstart">
        <div className="mk-wrap">
          <h2 id="quickstart" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)", textAlign: "center" }}>
            Quickstart
          </h2>
          <div className="mk-two" style={{ marginTop: "clamp(32px, 5vh, 48px)" }}>
            <div>
              <h3 className="mk-h4">REST</h3>
              <div style={{ marginTop: 12 }}>
                <CopyCode code={codeQuickstart} label="REST quickstart" />
              </div>
            </div>
            <div>
              <h3 className="mk-h4">MCP install (Claude or Cursor)</h3>
              <div style={{ marginTop: 12 }}>
                <CopyCode code={mcpInstall} label="MCP configuration" />
              </div>
              <p className="mk-small" style={{ marginTop: 12 }}>
                Paste into your agent&rsquo;s MCP config and restart. dreyv handles auth, scope enforcement and per-key
                metering on the server.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="oauth" className="mk-section mk-bg-light mk-anchor" aria-labelledby="auth">
        <div className="mk-wrap mk-split">
          <div className="mk-sticky">
            <h2 id="auth" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              Auth that fits your client
            </h2>
            <p className="mk-body" style={{ marginTop: 18 }}>
              All execution endpoints return <em>unsigned</em> transactions. Your wallet always signs. Three ways in.
            </p>
          </div>
          <ul className="mk-list">
            {authMethods.map((m) => (
              <li key={m.name} className="mk-row">
                <h3 className="mk-h4">{m.name}</h3>
                <p className="mk-body">{m.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="sandbox" className="mk-section mk-anchor" aria-labelledby="sandbox-h">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="sandbox-h" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
            Devnet sandbox on the Free tier
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
            Ship and stress-test on Solana devnet at no cost. All swap and signing endpoints return unsigned
            transactions; no production funds are ever at risk.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/auth?redirect=/app/developer" className="mk-btn mk-btn-outline">
              Open sandbox
            </Link>
          </div>
        </div>
      </section>

      <section id="resources" className="mk-section mk-bg-light mk-anchor" aria-labelledby="resources-h">
        <div className="mk-wrap mk-split">
          <div className="mk-sticky">
            <h2 id="resources-h" className="mk-h2" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
              Discovery and agent manifests
            </h2>
            <p className="mk-body" style={{ marginTop: 18 }}>
              Every machine-readable file an autonomous agent or crawler needs to understand dreyv: OpenAPI,
              ai-plugin, ACP, UCP, x402, llms.txt and security.txt.
            </p>
          </div>
          <ul className="mk-list">
            {RESOURCE_DOCS.map((d) => (
              <li key={d.slug} className="mk-row">
                <span>
                  <Link href={`/developers/docs/${d.slug}`} className="mk-h4 mk-link" style={{ color: "var(--mk-ink)" }}>
                    {d.label}
                  </Link>
                  <a
                    href={d.endpoint}
                    target="_blank"
                    rel="noopener"
                    className="mk-mono mk-small"
                    style={{ display: "block", marginTop: 6 }}
                  >
                    {d.endpoint}
                  </a>
                </span>
                <p className="mk-body">{d.tagline}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="sdk">
        <div className="mk-wrap mk-split">
          <h2 id="sdk" className="mk-h2 mk-sticky" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
            SDK and CLI
          </h2>
          <ul className="mk-list">
            <li className="mk-row">
              <h3 className="mk-h4">TypeScript SDK</h3>
              <p className="mk-body">
                <code className="mk-mono">@dreyv/sdk</code>: hooks for portfolio, swap, vault, MCP client and server,
                agent handoff, and gasless transactions.
              </p>
            </li>
            <li className="mk-row">
              <h3 className="mk-h4">CLI</h3>
              <p className="mk-body">
                <code className="mk-mono">@dreyv/cli</code>: scaffold, build, validate, and ship mini-apps and agents to
                the dreyv marketplace.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section className="mk-section mk-violet" aria-labelledby="ship">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="ship" className="mk-h2">
            Ship your first agent this week.
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 20 }}>
            Mint a key, paste the MCP snippet into Claude or Cursor, and stream a treasury plan through the SDK. Talk to
            us if you need a private endpoint or a partner integration.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/auth?redirect=/app/developer" className="mk-btn mk-btn-light">
              Mint an API key
            </Link>
            <a href="mailto:hello@dreyv.app?subject=dreyv%20developer%20partnership" className="mk-btn mk-btn-ghost-light">
              Talk to engineering
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
