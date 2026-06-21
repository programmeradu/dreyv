import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { listPublicCapabilities, type Pillar } from "@/lib/capabilities/registry";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

export const metadata: Metadata = {
  title: "Dreyv Web3 API — REST reference",
  description:
    "REST reference for the Dreyv Web3 API. Identity, portfolio, treasury, market, simulation, intents, forensics, agentic and economy primitives — one Bearer key, generated from a typed capability registry.",
  alternates: { canonical: "/developers/api" },
  openGraph: {
    title: "Dreyv Web3 API — REST reference",
    description: "Typed REST surface for every corner of Web3 with Dreyv's signature simulation, forensics, and agentic layers.",
    url: "/developers/api",
  },
};

const PILLAR_LABEL: Record<Pillar, string> = {
  identity: "Identity & resolution",
  portfolio: "Portfolio & treasury",
  market: "Market & discovery",
  execution: "Execution & intents",
  forensics: "Forensics & risk",
  tax: "Tax & accounting",
  foresight: "Foresight & simulation",
  agentic: "Agentic & insights",
  economy: "Economy & x402",
  reasoning: "Reasoning & LLM",
  knowledge: "Knowledge & memory",
  governance: "Governance & multisig",
  defi: "DeFi primitives",
  developer: "Developer & metering",
  safety: "Safety & policy",
  compliance: "Compliance & reporting",
  notifications: "Notifications & alerts",
  audit: "Observability & audit trail",
  teams: "Teams & workspaces",
  billing: "Billing, plans & credits",
  privacy: "Privacy & data rights",
  storage: "Storage & artifacts",
  search: "Search & indexing",
  status: "Status, SLO & deprecations",
  jobs: "Jobs & scheduling",
  exports: "Exports & reports",
  tags: "Tags, labels & annotations",
};

const PILLAR_ORDER: Pillar[] = ["identity", "portfolio", "market", "execution", "forensics", "tax", "foresight", "agentic", "economy", "reasoning", "knowledge", "governance", "defi", "developer", "safety", "compliance", "notifications", "audit", "teams", "billing", "privacy", "storage", "search", "status", "jobs", "exports", "tags"];

export default function DevelopersApiPage() {
  const caps = listPublicCapabilities();
  const grouped = PILLAR_ORDER.map((p) => ({
    pillar: p,
    caps: caps.filter((c) => c.pillar === p),
  })).filter((g) => g.caps.length > 0);

  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
        <div className="absolute -top-32 -right-40 h-[520px] w-[520px] rounded-full bg-violet-300/30 blur-3xl" />
        <div className="absolute top-1/3 -left-40 h-[440px] w-[440px] rounded-full bg-violet-400/15 blur-3xl" />
      </div>

      <div className="relative z-10">
        <SiteHeader />

        <main className="mx-auto max-w-5xl px-5 sm:px-8 py-16 sm:py-24">
          <header className="mb-12">
            <div className="flex items-center gap-2.5">
              <DreyvStar size={11} className="text-violet-600" />
              <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Dreyv API · v1</span>
            </div>
            <h1 className="mt-3 text-[40px] sm:text-[52px] leading-[1.05] font-semibold tracking-[-0.02em]">
              One typed Bearer key for <span className="italic font-light text-violet-600">every corner of Web3</span>.
            </h1>
            <p className="mt-4 text-[15px] text-slate-600 max-w-2xl leading-relaxed">
              REST at <code className="font-mono text-violet-700">{`/api/v1/{capability}`}</code>. Every capability is generated from the same typed registry that powers our MCP server, so REST and MCP never drift. Authenticate with <code className="font-mono text-violet-700">Authorization: Bearer dk_live_…</code>.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/app/settings?view=api"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold transition"
              >
                <KeyRound size={13} /> Mint a key
              </Link>
              <Link
                href="/developers/mcp"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-violet-200 bg-white text-violet-700 hover:bg-violet-50 text-[12px] font-semibold transition"
              >
                MCP server <ArrowUpRight size={13} />
              </Link>
              <a
                href="/openapi.json"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-violet-200 bg-white text-violet-700 hover:bg-violet-50 text-[12px] font-semibold transition"
              >
                OpenAPI <ArrowUpRight size={13} />
              </a>
            </div>
          </header>

          {/* Quickstart */}
          <section className="mb-14 rounded-3xl border border-violet-100 bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-violet-100 flex items-center gap-2.5">
              <DreyvStar size={9} className="text-violet-600" />
              <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Quickstart</span>
            </div>
            <div className="p-5">
              <pre className="rounded-2xl bg-slate-950 p-4 text-[12px] leading-relaxed font-mono text-violet-50 overflow-x-auto">{`curl -X POST https://dreyv.com/api/v1/market/price \\
  -H "Authorization: Bearer $DREYV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"SOL","chain":"solana"}'`}</pre>
              <p className="mt-3 text-[12px] text-slate-500">
                Every endpoint accepts POST with a typed JSON body and returns <code className="font-mono text-violet-700">{`{ ok, data, meta }`}</code>. Errors are JSON with HTTP 400 / 401 / 403 / 429.
              </p>
            </div>
          </section>

          {/* Capabilities */}
          {grouped.map(({ pillar, caps }) => (
            <section key={pillar} className="mb-12">
              <h2 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.01em] text-slate-900 mb-4">
                {PILLAR_LABEL[pillar]}
              </h2>
              <div className="grid gap-3">
                {caps.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-violet-100 bg-white p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono text-[12px] font-semibold text-violet-700 break-all">
                            POST /api/v1/{c.id.replace(/\./g, "/")}
                          </code>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-semibold tracking-[0.18em] uppercase ${
                              c.status === "preview"
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-violet-200 bg-violet-50 text-violet-700"
                            }`}
                          >
                            {c.status}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-semibold tracking-[0.18em] uppercase ${
                              c.sideEffects === "read"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : c.sideEffects === "simulate"
                                ? "border-sky-200 bg-sky-50 text-sky-700"
                                : "border-rose-200 bg-rose-50 text-rose-700"
                            }`}
                          >
                            {c.sideEffects}
                          </span>
                        </div>
                        <h3 className="mt-2 text-[15px] font-semibold text-slate-900">{c.title}</h3>
                        <p className="mt-1 text-[12.5px] text-slate-600 leading-relaxed">{c.description}</p>
                      </div>
                      <code className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full border border-violet-100 bg-violet-50/60 text-violet-700 text-[10px] font-mono">
                        scope: {c.scope}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="mt-16 rounded-3xl border border-violet-100 bg-white p-6">
            <h3 className="text-[16px] font-semibold text-slate-900">Roadmap</h3>
            <p className="mt-2 text-[13px] text-slate-600 leading-relaxed">
              Phase 1 ships the 15 capabilities above (identity, portfolio, market). Phase 2 adds execution & forensics
              (simulate, intent, bridge, swap, MEV-protected submit, sanctions, mixer exposure, counterparty graph, wash
              trade detection, composite risk). Phase 3 adds agentic foresight, narrative generation, watchers, x402
              payments, EAS attestations, the agent marketplace, and per-call metering.
            </p>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
