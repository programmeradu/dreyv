import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { ArrowRight } from "lucide-react";
import devCrystal from "@/assets/dev-crystal.png";

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

const resources: Array<{ label: string; href: string; desc: string }> = [
  { label: "OpenAPI 3.1 spec", href: "/openapi.json", desc: "Machine-readable API surface." },
  { label: "ai-plugin manifest", href: "/.well-known/ai-plugin.json", desc: "OpenAI plugin discovery." },
  { label: "ACP descriptor", href: "/.well-known/acp.json", desc: "Agentic Commerce Protocol." },
  { label: "UCP profile", href: "/.well-known/ucp", desc: "Universal Commerce Protocol." },
  { label: "API catalog", href: "/.well-known/api-catalog", desc: "RFC 9727 catalog." },
  { label: "x402 capability", href: "/.well-known/x402", desc: "Agent-native payments (advertised)." },
  { label: "llms.txt", href: "/llms.txt", desc: "Short canonical context for LLMs." },
  { label: "llms-full.txt", href: "/llms-full.txt", desc: "Full single-request context." },
  { label: "pricing.md", href: "/pricing.md", desc: "Machine-readable pricing." },
];

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
                  href="/auth?redirect=/app"
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
                href="/auth?redirect=/app"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors self-start md:self-auto"
              >
                Open sandbox
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* Resources */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <div className="mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">Resources</h2>
            <p className="mt-2 text-sm md:text-base text-slate-600 max-w-2xl">
              Discovery files, machine-readable manifests, and agent context — all live and crawlable.
            </p>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {resources.map((r) => (
              <li
                key={r.href}
                className="rounded-2xl border border-slate-200 bg-white/85 backdrop-blur p-5 hover:border-violet-300 hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.18)] transition-all"
              >
                <Link href={r.href} className="text-sm font-semibold text-slate-900 hover:text-violet-700">
                  {r.label}
                </Link>
                <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{r.desc}</p>
                <p className="mt-2 text-[11px] font-mono text-violet-700/80">{r.href}</p>
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
