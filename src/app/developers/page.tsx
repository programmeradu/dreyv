import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

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

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Developers</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Build agents on the dreyv treasury layer
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            REST API, TypeScript SDK, CLI, and a fully agent-ready surface — OpenAPI,
            ai-plugin, ACP, UCP, MCP, x402, llms.txt. Non-custodial by design.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/openapi.json" className={marketingPrimaryCtaSm}>
              View OpenAPI spec
            </Link>
            <Link
              href="/auth?redirect=/app"
              className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Get an API key
            </Link>
          </div>
        </header>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold">Quickstart</h2>
          <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-muted/40 p-5 text-sm">
            <code>{codeQuickstart}</code>
          </pre>
        </section>

        <section className="mb-12" id="oauth">
          <h2 className="text-2xl font-semibold">Auth</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Bearer JWT (SIWS)</strong> — sign-in-with-Solana issued via{" "}
              <code>/api/auth/*</code>.
            </li>
            <li>
              <strong className="text-foreground">API keys</strong> — provision per-org keys from your
              dashboard. Pass as <code>x-api-key</code> or <code>Authorization: Bearer</code>.
            </li>
            <li>
              <strong className="text-foreground">OAuth 2.0</strong> — authorization code flow at{" "}
              <code>/api/auth/authorize</code> + <code>/api/auth/token</code> (beta).
            </li>
          </ul>
        </section>

        <section className="mb-12" id="sandbox">
          <h2 className="text-2xl font-semibold">Sandbox</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            All swap and signing endpoints return unsigned transactions; your client signs.
            Devnet sandbox keys are available on the Free tier — no production funds at risk.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold">Resources</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {resources.map((r) => (
              <li
                key={r.href}
                className="rounded-2xl border border-border bg-card p-4 transition hover:border-primary/40"
              >
                <Link href={r.href} className="text-sm font-medium text-foreground hover:underline">
                  {r.label}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{r.desc}</p>
                <p className="mt-1 text-xs font-mono text-muted-foreground">{r.href}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold">SDKs</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">TypeScript SDK</strong> — <code>@dreyv/sdk</code>
              {" "}— hooks for portfolio, swap, vault, MCP client/server, agent handoff.
            </li>
            <li>
              <strong className="text-foreground">CLI</strong> — <code>@dreyv/cli</code> — scaffold,
              build, validate, ship mini-apps and agents.
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
