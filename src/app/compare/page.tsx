import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { Check, Minus } from "lucide-react";

export const metadata: Metadata = {
  title: "Compare — dreyv vs Squads, Jupiter, Birdeye & dashboards",
  description:
    "How dreyv compares to Squads multisig, Jupiter swap UI, Birdeye analytics, and read-only treasury dashboards. AI intent parsing, simulation-before-sign, non-custodial, multisig-native.",
  alternates: { canonical: "/compare" },
  openGraph: {
    title: "dreyv vs Squads, Jupiter, Birdeye",
    description:
      "Side-by-side: AI intent parsing, simulation-before-sign, non-custodial, multisig-native.",
    url: "/compare",
  },
};

type Row = { label: string; dreyv: boolean | string; squads: boolean | string; jupiter: boolean | string; birdeye: boolean | string };

const rows: Row[] = [
  { label: "Non-custodial",                            dreyv: true,  squads: true,  jupiter: true,  birdeye: true },
  { label: "Multisig-native (Squads)",                 dreyv: true,  squads: true,  jupiter: false, birdeye: false },
  { label: "Plain-language intent → plan (AI)",        dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Forked-state simulation before signing",   dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Human-readable impact for approvers",      dreyv: true,  squads: "partial", jupiter: false, birdeye: false },
  { label: "Swap routing (Jupiter)",                   dreyv: true,  squads: false, jupiter: true,  birdeye: false },
  { label: "Onchain analytics & token research",       dreyv: true,  squads: false, jupiter: "partial", birdeye: true },
  { label: "MEV / rug-pull scanners",                  dreyv: true,  squads: false, jupiter: false, birdeye: "partial" },
  { label: "Yield routing (Marinade/Jito/Blaze)",      dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Persistent knowledge memory (GraphRAG)",   dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "Build mini-apps & agents (Studio)",        dreyv: true,  squads: false, jupiter: false, birdeye: false },
  { label: "OpenAPI / MCP / ACP / x402 surface",       dreyv: true,  squads: false, jupiter: "partial", birdeye: false },
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check className="mx-auto h-4 w-4 text-emerald-500" aria-label="Yes" />;
  if (v === false) return <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" aria-label="No" />;
  return <span className="text-xs text-muted-foreground">{v}</span>;
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Compare</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            dreyv vs Squads, Jupiter, Birdeye
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Most teams stitch together a multisig, a swap UI, an analytics dashboard, and a chat
            channel. dreyv compresses that stack into one non-custodial AI workspace where you
            describe intent, preview outcomes, and propose to your multisig — all in one place.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/auth?redirect=/app" className={marketingPrimaryCtaSm}>
              Try dreyv free
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              See pricing
            </Link>
          </div>
        </header>

        <section className="overflow-x-auto rounded-2xl border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Capability</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">dreyv</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Squads</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Jupiter</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Birdeye</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal">{r.label}</th>
                  <td className="px-4 py-3 text-center"><Cell v={r.dreyv} /></td>
                  <td className="px-4 py-3 text-center"><Cell v={r.squads} /></td>
                  <td className="px-4 py-3 text-center"><Cell v={r.jupiter} /></td>
                  <td className="px-4 py-3 text-center"><Cell v={r.birdeye} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Where dreyv wins</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>• AI intent parsing: describe a plan in one sentence.</li>
              <li>• Forked simulation with human-readable impact before any signature.</li>
              <li>• Multisig-native (Squads) workflow with attached simulation.</li>
              <li>• One workspace replaces 8+ disconnected tools.</li>
              <li>• Agent-ready surface (OpenAPI, MCP, ACP, UCP, x402).</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Where the others still shine</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>• <strong className="text-foreground">Squads</strong>: deep, audited multisig primitives — dreyv builds on top.</li>
              <li>• <strong className="text-foreground">Jupiter</strong>: best-in-class routing — dreyv consumes Jupiter quotes.</li>
              <li>• <strong className="text-foreground">Birdeye</strong>: rich market data — dreyv complements with intent + execution.</li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
