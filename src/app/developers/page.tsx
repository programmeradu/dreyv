import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { ArrowRight, ArrowUpRight, Code2, Plug, Bot, Coins, Bell, Webhook } from "lucide-react";
import devCrystal from "@/assets/dev-crystal.png";
import { RESOURCE_DOCS } from "@/lib/developers/resource-docs";

export const metadata: Metadata = {
  title: "Developers — APIs, SDKs & agent integration",
  description:
    "dreyv developer portal: OpenAPI spec, API keys, SDKs, MCP server, ACP/UCP/x402 discovery, and quickstart for building agents on the non-custodial Solana treasury layer.",
  alternates: { canonical: "/developers" },
  openGraph: {
    title: "dreyv — Developers",
    description:
      "OpenAPI, SDKs, MCP, and agent-ready endpoints for the dreyv treasury platform.",
    url: "/developers",
  },
};

const codeQuickstart = `# Get a public token price
curl https://dreyv.com/api/price?token=SOL

# Compile a treasury intent into a plan (auth required)
curl -X POST https://dreyv.com/api/planner \\
  -H "Authorization: Bearer $DREYV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"intent":"rebalance 25% USDC into mSOL over 5 days"}'`;

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
    body: "Provision per-org keys from your dashboard. Pass as x-api-key or Authorization: Bearer.",
  },
  {
    name: "OAuth 2.0",
    body: "Authorization-code flow at /api/auth/authorize + /api/auth/token. Ideal for third-party agents (beta).",
  },
];

export default function DevelopersPage() {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full scroll-smooth font-manrope bg-white text-slate-900">
      {/* Ambient violet light — solid hues only */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
        <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
      </div>

      <SiteHeader />

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-12 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                dreyv · Developers
              </span>
              <h1 className="mt-5 text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
                Build agents on the dreyv treasury layer
              </h1>
              <p className="mt-4 max-w-2xl text-base md:text-lg text-slate-600 leading-relaxed">
                REST API, TypeScript SDK, CLI, and a fully agent-ready surface — OpenAPI,
                ai-plugin, ACP, UCP, MCP, x402, llms.txt. Non-custodial by design.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/openapi.json" className={marketingPrimaryCtaSm}>
                  View OpenAPI spec
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/auth?redirect=/app/developer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors"
                >
                  Get an API key
                </Link>
              </div>
            </div>
            <div className="hidden lg:flex justify-end">
              <div className="relative h-[280px] w-[280px] rounded-3xl bg-violet-50/60 border border-violet-100 flex items-center justify-center overflow-hidden">
                <Image
                  src={devCrystal}
                  alt="Violet hexagonal crystal representing the dreyv developer surface"
                  width={240}
                  height={240}
                  priority
                  className="h-[240px] w-[240px] object-contain"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Surfaces — the actual product entrypoints */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Surfaces</h2>
              <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
                Four ways to ship — pick the transport that fits the agent you’re building. Every surface speaks the same capability registry.
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
                desc: "29 capabilities across identity, portfolio, market, execution, forensics, tax, foresight, agentic, and x402 economy. Bearer dk_live_… keys, per-key rate limits, strict no-fallback contracts.",
                cta: "Explore endpoints",
              },
              {
                href: "/developers/mcp",
                icon: Plug,
                title: "MCP Server",
                tag: "/api/mcp",
                desc: "Native Model Context Protocol server. Every REST capability auto-published as an MCP tool — drop into Claude Desktop, Cursor, or any MCP-aware agent in one URL.",
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

          {/* Secondary row — watchers + webhooks coming in Phase 4 */}
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



        {/* Quickstart */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="rounded-3xl border border-violet-200/60 bg-white/80 backdrop-blur-md p-7 md:p-9 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Quickstart</h2>
                <p className="mt-1 text-sm text-slate-600">Two requests to your first compiled treasury plan.</p>
              </div>
              <span className="hidden md:inline-flex h-1.5 w-12 rounded-full bg-violet-600" />
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-5 text-[13px] leading-relaxed text-slate-800">
              <code>{codeQuickstart}</code>
            </pre>
          </div>
        </section>

        {/* Auth */}
        <section id="oauth" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Auth</h2>
            <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
              Pick the auth method that fits your client. All endpoints return unsigned transactions —
              your wallet always signs.
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
          <div className="rounded-3xl border border-violet-200/60 bg-white/70 backdrop-blur-md p-8 md:p-10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="max-w-2xl">
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Sandbox</h2>
                <p className="mt-2 text-sm md:text-base text-slate-600 leading-relaxed">
                  Devnet sandbox keys ship on the Free tier. All swap and signing endpoints return
                  unsigned transactions; no production funds are ever at risk.
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
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Resources</h2>
            <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
              Discovery files, machine-readable manifests, and agent context — each card opens a full
              doc page; the chevron jumps straight to the raw endpoint.
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

        {/* SDKs */}
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
          <div className="rounded-3xl bg-violet-600 p-8 md:p-10 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-[0_30px_80px_-30px_rgba(124,58,237,0.45)]">
            <div className="max-w-xl">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Ship your first agent this week
              </h2>
              <p className="mt-2 text-violet-100 text-sm md:text-base leading-relaxed">
                Provision a key, hit the sandbox, and stream a treasury plan through the SDK.
                Talk to us if you need a private endpoint or partner integration.
              </p>
            </div>
            <Link
              href="mailto:hello@dreyv.app?subject=dreyv%20developer%20partnership"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 transition-colors"
            >
              Talk to engineering
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
