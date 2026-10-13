import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/marketing/legacy-chrome";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "dreyv Developer Changelog",
  description:
    "Shipping notes for the dreyv MCP server, x402 client, and public developer surface.",
  alternates: { canonical: "/developers/changelog" },
};

type Entry = {
  date: string;
  title: string;
  tag?: string;
  body: React.ReactNode;
};

const ENTRIES: Entry[] = [
  {
    date: "2026-07-02",
    tag: "Public SDKs + MCP directory",
    title: "@dreyv/mcp and @dreyv/x402-client on npm",
    body: (
      <ul className="space-y-3 text-[15px] leading-relaxed text-slate-700">
        <li>
          <strong className="text-slate-900">@dreyv/mcp@0.1.0</strong> published to npm. One-line
          client for the dreyv Streamable HTTP MCP server at{" "}
          <code className="rounded bg-violet-50 px-1.5 py-0.5 text-[13px] text-violet-700">
            https://dreyv.com/api/mcp
          </code>
          {" "}: 343 tools across research, treasury, execution, forensics, and governance,
          authenticated with a single <code className="rounded bg-violet-50 px-1.5 py-0.5 text-[13px] text-violet-700">dk_live_</code> Bearer key.
        </li>
        <li>
          <strong className="text-slate-900">@dreyv/x402-client@0.1.0</strong> published to npm.
          Buyer-side SDK for the x402 protocol with per-call caps, per-run budgets, typed errors,
          and Solscan receipts. Pairs with Cloudflare Monetization Gateway and any x402-compliant
          seller.
        </li>
        <li>
          <strong className="text-slate-900">MCP discovery live</strong> at{" "}
          <Link className="text-violet-700 underline underline-offset-2" href="/.well-known/mcp.json">
            /.well-known/mcp.json
          </Link>{" "}
          and{" "}
          <Link className="text-violet-700 underline underline-offset-2" href="/api/mcp/manifest">
            /api/mcp/manifest
          </Link>
          . Listed on Smithery via <code className="rounded bg-violet-50 px-1.5 py-0.5 text-[13px] text-violet-700">smithery.yaml</code>;
          PRs to <em>modelcontextprotocol/servers</em> and <em>mcp.so</em> in flight.
        </li>
        <li>
          Legacy <code className="rounded bg-violet-50 px-1.5 py-0.5 text-[13px] text-violet-700">@keystone-os/cli</code> deprecated on npm.
          dreyv&apos;s public surface is now <strong>@dreyv/mcp</strong> + <strong>@dreyv/x402-client</strong> only.
        </li>
      </ul>
    ),
  },
];

export default function DevelopersChangelogPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16 sm:pt-24">
        <div className="mb-10 flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.14em] text-violet-700">
          <DreyvStar className="h-3 w-3" />
          Developer changelog
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          What we shipped
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-slate-600">
          Release notes for dreyv&apos;s public developer surface: SDKs, MCP endpoints, and
          protocol updates. For product changes, see{" "}
          <Link href="/developers" className="text-violet-700 underline underline-offset-2">
            /developers
          </Link>
          .
        </p>

        <ol className="mt-14 space-y-14">
          {ENTRIES.map((e) => (
            <li key={e.date} className="relative">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <time
                  dateTime={e.date}
                  className="font-mono text-[13px] text-slate-500"
                >
                  {e.date}
                </time>
                {e.tag ? (
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-violet-700">
                    {e.tag}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {e.title}
              </h2>
              <div className="mt-5 rounded-3xl border border-violet-100 bg-white p-6 sm:p-8">
                {e.body}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-20 flex flex-wrap items-center gap-4 border-t border-violet-100 pt-8 text-sm text-slate-600">
          <span>Follow shipping in real time:</span>
          <a
            href="https://x.com/dreyvhq"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900"
          >
            @dreyvhq <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <a
            href="https://npmjs.com/org/dreyv"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900"
          >
            npm/@dreyv <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
