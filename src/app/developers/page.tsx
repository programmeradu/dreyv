import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import {
  ArrowRight,
  ArrowUpRight,
  Code2,
  Plug,
  Bot,
  Coins,
  Bell,
  Webhook,
  ShieldCheck,
  Gauge,
  Network,
  Boxes,
  Wand2,
  Brain,
} from "lucide-react";
import devCrystal from "@/assets/dev-crystal.png";
import commandStar from "@/assets/command-star-violet.png";
import ctaKey from "@/assets/cta-key-violet.png";
import atlasOrbital from "@/assets/atlas-orbital-violet.png";
import heroLiquid from "@/assets/hero-liquid-violet.png";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { CodeBlock } from "@/components/ui/code-block";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { RESOURCE_DOCS } from "@/lib/developers/resource-docs";
import { listPublicCapabilities } from "@/lib/capabilities/registry";

const CAP_COUNT = listPublicCapabilities().length;

export const metadata: Metadata = {
  title: `Dreyv Developers — the Web3 MCP & API (${CAP_COUNT}+ tools)`,
  description:
    "The ultimate Web3 MCP server and typed REST API. One Bearer key gives any AI agent identity, portfolio, market, execution, forensics, foresight, x402 economy, and agentic primitives across Solana and EVM. Non-custodial by design.",
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
    "agentic finance",
    "Dreyv API",
    "treasury API",
    "non-custodial agent",
    "TypeScript Web3 SDK",
  ],
  alternates: { canonical: "/developers" },
  openGraph: {
    title: `Dreyv — the Web3 MCP & API for AI agents`,
    description: `${CAP_COUNT}+ typed capabilities. One Bearer key. REST + MCP, OpenAPI, x402, ACP, UCP, ai-plugin, llms.txt. Built for the agentic web.`,
    url: "/developers",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dreyv — the Web3 MCP & API",
    description: `${CAP_COUNT}+ Web3 tools in one MCP server. Plug Claude, Cursor, or any agent into all of Web3.`,
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

const resources = RESOURCE_DOCS.map((d) => ({
  slug: d.slug,
  label: d.label,
  href: `/developers/docs/${d.slug}`,
  endpoint: d.endpoint,
  desc: d.tagline,
}));

const authMethods = [
  {
    name: "Bearer JWT (SIWS)",
    body: "Sign-in-with-Solana issued via /api/auth/*. Recommended for first-party clients and signed wallet sessions.",
  },
  {
    name: "API keys",
    body: "Provision per-org keys from your dashboard. Pass as x-api-key or Authorization: Bearer dk_live_…",
  },
  {
    name: "OAuth 2.0",
    body: "Authorization-code flow at /api/auth/authorize + /api/auth/token. Ideal for third-party agents (beta).",
  },
];

const stats = [
  { value: `${CAP_COUNT}+`, label: "typed capabilities" },
  { value: "2", label: "transports — REST + MCP" },
  { value: "100%", label: "non-custodial" },
  { value: "8", label: "discovery manifests" },
];

const pillars = [
  { icon: Network, title: "Identity & resolution", desc: "Wallets, ENS / SNS, profiles, multi-chain identity graph." },
  { icon: Boxes, title: "Portfolio & treasury", desc: "Holdings, P&L, attribution, concentration, runway across chains." },
  { icon: Gauge, title: "Market & discovery", desc: "Prices, pools, liquidity, narratives, trending tokens." },
  { icon: Wand2, title: "Execution & intents", desc: "Swaps, transfers, DCA, vault ops — always unsigned, your wallet signs." },
  { icon: ShieldCheck, title: "Forensics & risk", desc: "Wallet risk, rug heuristics, MEV exposure, tax-loss surfaces." },
  { icon: Brain, title: "Foresight & agentic", desc: "Monte-Carlo sims, scenario IRs, agent watchers, hash-chained audit." },
];

const agents: { name: string; note: string; logo: string }[] = [
  { name: "Claude Desktop", note: "claude_desktop_config.json", logo: "https://cdn.simpleicons.org/claude/7c3aed" },
  { name: "Cursor", note: "Settings → MCP → Add server", logo: "https://cdn.simpleicons.org/cursor/7c3aed" },
  { name: "ChatGPT", note: "via /openapi.json plugin", logo: "https://svgl.app/library/openai.svg" },
  { name: "Windsurf", note: "MCP servers panel", logo: "https://cdn.simpleicons.org/windsurf/7c3aed" },
  { name: "Continue.dev", note: "config.json mcpServers", logo: "https://avatars.githubusercontent.com/u/127876214?s=64&v=4" },
  { name: "Cline", note: "MCP-aware tool calling", logo: "https://cdn.simpleicons.org/cline/7c3aed" },
  { name: "elizaOS", note: "@dreyv/sdk client", logo: "https://avatars.githubusercontent.com/u/186240462?s=64&v=4" },
  { name: "Custom agent", note: "REST + Bearer key", logo: "/brand/dreyv-mark-violet.png" },
];

const softwareAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Dreyv Web3 MCP & API",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description: `${CAP_COUNT}+ typed Web3 capabilities exposed over REST and Model Context Protocol. Non-custodial agent infrastructure for Solana and EVM.`,
  url: "https://dreyv.com/developers",
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
    { "@type": "Offer", name: "Mini", price: "49", priceCurrency: "USD" },
    { "@type": "Offer", name: "Max", price: "199", priceCurrency: "USD" },
  ],
  provider: { "@type": "Organization", name: "Dreyv", url: "https://dreyv.com" },
};

export default function DevelopersPage() {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full scroll-smooth font-manrope bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />

      {/* Ambient violet light */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[20%] h-[480px] w-[480px] rounded-full bg-violet-400/[0.07] blur-[120px]" />
        <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
      </div>

      <SiteHeader />

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-12 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                <DreyvStar size={10} className="text-violet-600" />
                The Web3 MCP & API
              </span>
              <h1 className="mt-5 text-4xl md:text-6xl font-semibold tracking-tight text-slate-900 leading-[1.02]">
                Plug any AI agent into{" "}
                <span className="italic font-light text-violet-600">all of Web3</span>.
              </h1>
              <p className="mt-5 max-w-2xl text-base md:text-lg text-slate-600 leading-relaxed">
                {CAP_COUNT}+ typed capabilities in one Bearer key — identity, portfolio,
                market, execution, forensics, foresight, x402 economy and agentic primitives.
                Shipped as a Streamable-HTTP <strong className="text-slate-900">MCP server</strong> and a
                typed <strong className="text-slate-900">REST API</strong>, generated from the same registry so they never drift.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/developers/mcp" className={marketingPrimaryCtaSm}>
                  Connect MCP
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/openapi.json"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors"
                >
                  View OpenAPI
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/auth?redirect=/app/developer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors"
                >
                  Mint an API key
                </Link>
              </div>

              {/* trust strip */}
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-violet-600" /> Non-custodial</span>
                <span className="inline-flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5 text-violet-600" /> Typed registry</span>
                <span className="inline-flex items-center gap-1.5"><Network className="h-3.5 w-3.5 text-violet-600" /> Solana + EVM</span>
                <span className="inline-flex items-center gap-1.5"><Bot className="h-3.5 w-3.5 text-violet-600" /> Agent-ready</span>
              </div>
            </div>

            <div className="hidden lg:flex justify-end">
              <div className="relative h-[340px] w-[340px] rounded-[2rem] bg-gradient-to-br from-violet-50 to-white border border-violet-100 flex items-center justify-center overflow-hidden">
                <Image
                  src={devCrystal}
                  alt="Violet hexagonal crystal — the Dreyv developer surface"
                  width={280}
                  height={280}
                  priority
                  className="h-[280px] w-[280px] object-contain"
                />
              </div>
            </div>
          </div>

          {/* Stats band */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-violet-100 bg-white/80 backdrop-blur p-5">
                <div className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">{s.value}</div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Surfaces */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Four surfaces. One registry.</h2>
              <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
                Pick the transport that fits the agent you’re building. Every surface speaks the same typed capability registry — REST and MCP never drift.
              </p>
            </div>
            <span className="hidden md:inline-flex h-1.5 w-12 rounded-full bg-violet-600" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                href: "/developers/api",
                icon: Code2,
                title: "REST API",
                tag: "/api/v1/*",
                desc: `${CAP_COUNT}+ capabilities across identity, portfolio, market, execution, forensics, tax, foresight, agentic, and x402. Bearer dk_live_… keys, per-key rate limits, strict no-fallback contracts.`,
                cta: "Explore endpoints",
              },
              {
                href: "/developers/mcp",
                icon: Plug,
                title: "MCP Server",
                tag: "/api/mcp",
                desc: "Native Model Context Protocol server over Streamable HTTP. Every REST capability auto-published as an MCP tool — drop into Claude Desktop, Cursor, or any MCP-aware agent in one URL.",
                cta: "Connect MCP",
              },
              {
                href: "/developers/agents",
                icon: Bot,
                title: "Agent Payments (x402)",
                tag: "Bearer dak_…",
                desc: "Autonomous agents purchase Dreyv SKUs over HTTP 402. USDC on Solana settlement, single-call /api/x402/pay with permanent deliverables, plus Stripe + Paystack card rails.",
                cta: "Open agent docs",
              },
              {
                href: "/.well-known/x402",
                icon: Coins,
                title: "Discovery manifests",
                tag: "/.well-known/*",
                desc: "Machine-readable surface for crawlers and autonomous agents — x402, ACP, UCP, ai-plugin, OpenAPI, security.txt, llms.txt. Built for the agentic web.",
                cta: "View manifests",
                external: true,
              },
            ].map(({ href, icon: Icon, title, tag, desc, cta, external }) => (
              <Link
                key={href}
                href={href}
                {...(external ? { target: "_blank", rel: "noopener" } : {})}
                className="group relative rounded-3xl border border-violet-200/70 bg-white/85 backdrop-blur p-7 hover:border-violet-400 hover:shadow-[0_24px_60px_-24px_rgba(124,58,237,0.25)] transition-all"
              >
                <div className="flex items-start gap-4">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white">
                    <Icon className="h-5 w-5" strokeWidth={2.25} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-semibold text-slate-900 group-hover:text-violet-700">{title}</h3>
                      <code className="font-mono text-[11px] text-violet-700 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
                        {tag}
                      </code>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">{desc}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700">
                      {cta}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Secondary row */}
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                icon: Bell,
                title: "Watchers & Monitors",
                desc: "Subscribe wallets and metrics. Dreyv sweepers run on Inngest + Cloudflare cron and route deltas to your inbox or webhook.",
                tag: "watchers.* · monitors.*",
              },
              {
                icon: Webhook,
                title: "Notifications & Webhooks",
                desc: "Pull notifications via REST/MCP or receive signed POSTs at your endpoint when a monitor trips or a proposal needs approval.",
                tag: "notifications.* · webhooks.*",
              },
            ].map(({ icon: Icon, title, desc, tag }) => (
              <Link
                key={title}
                href="/developers/api"
                className="group rounded-3xl border border-slate-200 bg-white/85 backdrop-blur p-6 hover:border-violet-300 hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.18)] transition-all"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900 group-hover:text-violet-700">{title}</h3>
                    <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{desc}</p>
                    <code className="mt-3 inline-block font-mono text-[11px] text-violet-700/80 break-all">{tag}</code>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Pillars */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-10 items-start">
            <div className="lg:sticky lg:top-24">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                Capability pillars
              </span>
              <h2 className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
                One surface. Every corner of Web3.
              </h2>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                From wallet identity to Monte-Carlo foresight — your agent calls the same Bearer key for all of it.
              </p>
              <div className="mt-6 hidden lg:block">
                <Image
                  src={atlasOrbital}
                  alt="Violet orbital crystal — the Dreyv capability registry"
                  width={220}
                  height={220}
                  className="opacity-90"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pillars.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-violet-100 bg-white/85 backdrop-blur p-5 hover:border-violet-300 hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.18)] transition-all"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white">
                    <Icon className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Agent compatibility */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur p-7 md:p-9">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-8 items-center">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                  Works with the agents you already use
                </span>
                <h2 className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
                  Drop into any MCP-aware agent.
                </h2>
                <p className="mt-3 max-w-2xl text-sm md:text-base text-slate-600 leading-relaxed">
                  One JSON snippet, one Bearer key. Your agent inherits {CAP_COUNT}+ Web3 tools — and your wallet keeps its keys.
                </p>
                <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {agents.map((a) => (
                    <div
                      key={a.name}
                      className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-violet-300 transition-colors"
                    >
                      <span className="flex-none inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 ring-1 ring-violet-100 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.logo} alt={`${a.name} logo`} className="h-4 w-4 object-contain" loading="lazy" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-900 truncate">{a.name}</div>
                        <div className="mt-0.5 text-[10.5px] text-slate-500 leading-snug truncate">{a.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden lg:flex justify-center">
                <DreyvMascot pose="think" size={200} alt="Dreyv mascot thinking" />
              </div>
            </div>
          </div>
        </section>

        {/* Quickstart */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur p-6 md:p-7 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
              <div className="flex items-center gap-2.5 mb-4">
                <Image src={commandStar} alt="" width={28} height={28} className="opacity-90" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">REST quickstart</span>
              </div>
              <CodeBlock language="bash">{codeQuickstart}</CodeBlock>
            </div>
            <div className="rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur p-6 md:p-7 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
              <div className="flex items-center gap-2.5 mb-4">
                <Plug className="h-4 w-4 text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">MCP install (Claude / Cursor)</span>
              </div>
              <CodeBlock language="json">{mcpInstall}</CodeBlock>
              <p className="mt-3 text-[11.5px] text-slate-500 leading-relaxed">
                Paste into your agent's MCP config and restart. Dreyv handles auth, scope enforcement, and per-key metering on the server.
              </p>
            </div>
          </div>
        </section>

        {/* Auth */}
        <section id="oauth" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Auth that fits your client</h2>
            <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
              All execution endpoints return <em>unsigned</em> transactions — your wallet always signs. Three ways in.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {authMethods.map((m) => (
              <div
                key={m.name}
                className="rounded-2xl border border-slate-200 bg-white/85 backdrop-blur p-6 shadow-[0_10px_40px_-20px_rgba(15,23,42,0.10)] hover:border-violet-300 hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.18)] transition-all"
              >
                <span className="h-1.5 w-10 rounded-full bg-violet-600 block" />
                <h3 className="mt-4 text-base font-semibold text-slate-900">{m.name}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Sandbox */}
        <section id="sandbox" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="relative overflow-hidden rounded-3xl border border-violet-200/60 bg-white/80 backdrop-blur p-8 md:p-10">
            <Image
              src={heroLiquid}
              alt=""
              width={420}
              height={420}
              className="absolute -right-20 -bottom-20 opacity-40 pointer-events-none"
              aria-hidden
            />
            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="max-w-2xl">
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Devnet sandbox on the Free tier</h2>
                <p className="mt-2 text-sm md:text-base text-slate-600 leading-relaxed">
                  Ship and stress-test on Solana devnet at zero cost. All swap and signing endpoints return unsigned transactions; no production funds are ever at risk.
                </p>
              </div>
              <Link
                href="/auth?redirect=/app/developer"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors self-start md:self-auto"
              >
                Open sandbox
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* Resources */}
        <section id="resources" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16 scroll-mt-24">
          <div className="mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Discovery & agent manifests</h2>
            <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
              Every machine-readable file an autonomous agent or crawler needs to understand Dreyv — OpenAPI, ai-plugin, ACP, UCP, x402, llms.txt, security.txt.
            </p>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {resources.map((r) => (
              <li key={r.slug} className="group relative">
                <Link
                  href={r.href}
                  className="block h-full rounded-2xl border border-slate-200 bg-white/85 backdrop-blur p-5 pr-12 hover:border-violet-300 hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.18)] transition-all"
                >
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-violet-700">
                    {r.label}
                  </span>
                  <p className="mt-1.5 text-xs text-slate-600 leading-relaxed line-clamp-2">{r.desc}</p>
                  <p className="mt-2 text-[11px] font-mono text-violet-700/80 break-all">{r.endpoint}</p>
                </Link>
                <a
                  href={r.endpoint}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Open raw ${r.label}`}
                  className="absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-violet-300 hover:text-violet-700 transition-colors"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* SDK / CLI */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-3xl border border-slate-200 bg-white/85 backdrop-blur p-7">
              <span className="h-1.5 w-10 rounded-full bg-violet-600 block" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900">TypeScript SDK</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                <code className="font-mono text-violet-700">@dreyv/sdk</code> — hooks for portfolio,
                swap, vault, MCP client/server, agent handoff, and gasless transactions.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/85 backdrop-blur p-7">
              <span className="h-1.5 w-10 rounded-full bg-violet-600 block" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900">CLI</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                <code className="font-mono text-violet-700">@dreyv/cli</code> — scaffold, build,
                validate, and ship mini-apps and agents to the dreyv marketplace.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24">
          <div className="relative overflow-hidden rounded-3xl bg-violet-600 p-8 md:p-12 text-white shadow-[0_30px_80px_-30px_rgba(124,58,237,0.45)]">
            <Image
              src={ctaKey}
              alt=""
              width={260}
              height={260}
              className="absolute -right-6 -bottom-6 opacity-90 pointer-events-none hidden md:block"
              aria-hidden
            />
            <div className="relative max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-semibold tracking-tight">
                Ship your first agent this week.
              </h2>
              <p className="mt-3 text-violet-100 text-sm md:text-base leading-relaxed">
                Mint a key, paste the MCP snippet into Claude or Cursor, and stream a treasury plan
                through the SDK. Talk to us if you need a private endpoint or partner integration.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/auth?redirect=/app/developer"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 transition-colors"
                >
                  Mint an API key
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="mailto:hello@dreyv.app?subject=dreyv%20developer%20partnership"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 backdrop-blur px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20 transition-colors"
                >
                  Talk to engineering
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
