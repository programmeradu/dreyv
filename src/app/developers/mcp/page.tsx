import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { CodeBlock } from "@/components/ui/code-block";
import { listPublicCapabilities } from "@/lib/capabilities/registry";
import { ArrowUpRight, KeyRound, Terminal } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import devCrystal from "@/assets/dev-crystal.png";

export const metadata: Metadata = {
  title: "Dreyv MCP server — connect any AI agent to Web3",
  description:
    "Dreyv exposes the entire Web3 capability surface as an MCP server over Streamable HTTP. Drop it into Claude Desktop, Cursor, or any MCP-aware agent with one Bearer key.",
  alternates: { canonical: "/developers/mcp" },
  openGraph: {
    title: "Dreyv MCP server",
    description: "Streamable HTTP MCP server with simulation, forensics, intents, and agentic primitives across chains.",
    url: "/developers/mcp",
  },
};

export default function DevelopersMcpPage() {
  const caps = listPublicCapabilities();

  const claude = JSON.stringify(
    {
      mcpServers: {
        dreyv: {
          url: "https://dreyv.com/api/mcp",
          headers: { Authorization: "Bearer dk_live_YOUR_KEY" },
        },
      },
    },
    null,
    2,
  );

  const cursor = JSON.stringify(
    {
      mcpServers: {
        dreyv: {
          url: "https://dreyv.com/api/mcp",
          transport: "http",
          headers: { Authorization: "Bearer dk_live_YOUR_KEY" },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
        <div className="absolute -top-32 -right-40 h-[520px] w-[520px] rounded-full bg-violet-300/30 blur-3xl" />
        <div className="absolute top-1/3 -left-40 h-[440px] w-[440px] rounded-full bg-violet-400/15 blur-3xl" />
      </div>

      <div className="relative z-10">
        <SiteHeader />

        <main className="mx-auto max-w-5xl px-5 sm:px-8 py-16 sm:py-24">
          <header className="mb-12 grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-8 items-center">
            <div>
              <div className="flex items-center gap-2.5">
                <DreyvStar size={11} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Dreyv MCP server · {caps.length}+ tools</span>
              </div>
              <h1 className="mt-3 text-[40px] sm:text-[56px] leading-[1.04] font-semibold tracking-[-0.02em]">
                Plug any agent into <span className="italic font-light text-violet-600">all of Web3</span>.
              </h1>
              <p className="mt-4 text-[15px] text-slate-600 max-w-2xl leading-relaxed">
                Dreyv's MCP server speaks Streamable HTTP at <code className="font-mono text-violet-700">/api/mcp</code> and
                exposes every capability from our typed registry as an MCP tool — identity, portfolio, treasury, market,
                execution, forensics, simulation, intents, x402, and agentic foresight.
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                <Link
                  href="/auth?redirect=/app/developer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold transition"
                >
                  <KeyRound size={13} /> Mint a key
                </Link>
                <Link
                  href="/developers/api"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-violet-200 bg-white text-violet-700 hover:bg-violet-50 text-[12px] font-semibold transition"
                >
                  REST reference <ArrowUpRight size={13} />
                </Link>
              </div>
            </div>
            <div className="hidden lg:flex justify-end relative">
              <Image src={devCrystal} alt="" width={200} height={200} className="opacity-90" />
              <div className="absolute -bottom-2 -left-2">
                <DreyvMascot pose="greet" size={120} alt="Dreyv mascot" />
              </div>
            </div>
          </header>

          {/* Install */}
          <section className="grid md:grid-cols-2 gap-4 mb-14">
            <div className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-violet-100 flex items-center gap-2.5">
                <Terminal size={14} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Claude Desktop</span>
              </div>
              <div className="p-5">
                <CodeBlock language="json" wrap dense>{claude}</CodeBlock>
                <p className="mt-3 text-[11px] text-slate-500">
                  Paste into <code className="font-mono text-violet-700">~/Library/Application Support/Claude/claude_desktop_config.json</code> and restart Claude.
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-violet-100 flex items-center gap-2.5">
                <Terminal size={14} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Cursor</span>
              </div>
              <div className="p-5">
                <CodeBlock language="json" wrap dense>{cursor}</CodeBlock>
                <p className="mt-3 text-[11px] text-slate-500">
                  Cursor → Settings → MCP → Add server, paste the JSON above.
                </p>
              </div>
            </div>
          </section>

          {/* Tools */}
          <section className="mb-12">
            <h2 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.01em] text-slate-900 mb-4">
              Tools exposed
            </h2>
            <div className="grid gap-3">
              {caps.map((c) => (
                <div key={c.id} className="rounded-2xl border border-violet-100 bg-white p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <code className="font-mono text-[12px] font-semibold text-violet-700 break-all">
                        {c.mcpName}
                      </code>
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

          <section className="rounded-3xl border border-violet-100 bg-white p-6">
            <h3 className="text-[16px] font-semibold text-slate-900">Transport notes</h3>
            <p className="mt-2 text-[13px] text-slate-600 leading-relaxed">
              The Dreyv MCP server speaks Streamable HTTP per the MCP spec. POST requests must include
              <code className="font-mono text-violet-700"> Accept: application/json, text/event-stream</code>. Rate
              limits, scope enforcement, and per-key usage metering are identical to the REST surface — both
              transports share the same typed capability registry.
            </p>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
