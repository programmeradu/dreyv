import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { DreyvStar } from "@/components/studio/DreyvStar";

export const metadata: Metadata = {
    title: "dreyv for x402: the buyer-side companion to the agent payments standard",
    description:
        "Give an agent a wallet, a budget for each run, and a record of every x402 payment. Works with Cloudflare Monetization Gateway, Coinbase-facilitated APIs, and any x402-compliant seller.",
    alternates: { canonical: "https://dreyv.com/x402" },
    openGraph: {
        title: "dreyv for x402",
        description:
            "A wallet, a budget and a record of every payment, for agents that pay over x402.",
        type: "website",
        url: "https://dreyv.com/x402",
    },
    twitter: { card: "summary_large_image", title: "dreyv for x402" },
};

const sellers = [
    { name: "Cloudflare Monetization Gateway", note: "edge-gated APIs across 330+ cities" },
    { name: "Coinbase-facilitated endpoints", note: "the reference facilitator on Base" },
    { name: "Solana Pay x402 sellers", note: "on-chain USDC settlement" },
    { name: "Self-hosted origins", note: "any server that returns 402 + accepts[]" },
];

const pillars = [
    {
        title: "A wallet, provisioned automatically",
        body:
            "Every dreyv API key gets a custodial USDC wallet on Solana. No seed phrases, no wallet adapters, no key material inside the agent runtime.",
    },
    {
        title: "A budget you actually control",
        body:
            "Set per-call and per-run caps. If a seller quotes over the cap, the SDK refuses the payment. Prepaid balance means an empty wallet returns 402, never overdrafts.",
    },
    {
        title: "A record your finance lead can read",
        body:
            "Every settlement returns a signed receipt, a Solscan link, memo, resource hash, and the amount in USDC minor units. Streamed into the dreyv ledger, exportable to CSV.",
    },
    {
        title: "One key, every rail",
        body:
            "Same `dk_live_…` key settles Stripe top-ups, Paystack top-ups, internal credits, and on-chain USDC. The seller sees x402; the agent sees one balance.",
    },
];

export default function X402Page() {
    return (
        <main className="bg-white text-slate-900 [font-family:var(--font-manrope,inherit)]">
            {/* Hero */}
            <section className="relative overflow-hidden border-b border-violet-100">
                <div
                    aria-hidden
                    className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-violet-300/40 blur-3xl"
                />
                <div
                    aria-hidden
                    className="pointer-events-none absolute -bottom-32 right-10 h-[380px] w-[380px] rounded-full bg-violet-400/30 blur-3xl"
                />
                <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-28 sm:pt-32">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
                        <DreyvStar className="h-3 w-3 text-violet-600" />
                        dreyv × x402: buyer-side companion
                    </div>
                    <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-slate-950 sm:text-6xl">
                        Sellers can now charge agents over x402.
                        <span className="block text-violet-600">Agents still need a wallet and a budget.</span>
                    </h1>
                    <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
                        Cloudflare just made x402 a one-checkbox toll booth for any API on the internet.
                        That&apos;s good: it means every agent will pay per call in stablecoins. Someone
                        still has to give that agent a wallet, a budget, and a paper trail. That&apos;s
                        dreyv.
                    </p>
                    <div className="mt-10 flex flex-wrap items-center gap-4">
                        <Link
                            href="/auth?intent=api"
                            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(124,58,237,0.6)] transition hover:bg-violet-700"
                        >
                            Get an API key
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <a
                            href="https://www.npmjs.com/package/@dreyv/x402-client"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:border-violet-300 hover:bg-violet-50"
                        >
                            npm i @dreyv/x402-client
                            <ArrowUpRight className="h-4 w-4" />
                        </a>
                    </div>
                </div>
            </section>

            {/* Pillars */}
            <section className="mx-auto max-w-6xl px-6 py-24">
                <div className="mb-14 flex items-end justify-between gap-8">
                    <div>
                        <p className="mb-3 flex items-center gap-2 text-sm font-medium text-violet-700">
                            <DreyvStar className="h-3 w-3 text-violet-600" />
                            What dreyv gives the buyer
                        </p>
                        <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950">
                            A wallet, a budget, and an audit trail: for every agent, on every seller.
                        </h2>
                    </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    {pillars.map((p) => (
                        <div
                            key={p.title}
                            className="rounded-3xl border border-violet-100 bg-white p-8 transition hover:border-violet-200"
                        >
                            <h3 className="text-lg font-semibold text-slate-950">{p.title}</h3>
                            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{p.body}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Interop */}
            <section className="border-y border-violet-100 bg-violet-50/40">
                <div className="mx-auto max-w-6xl px-6 py-20">
                    <p className="mb-3 flex items-center gap-2 text-sm font-medium text-violet-700">
                        <DreyvStar className="h-3 w-3 text-violet-600" />
                        Works with every x402 seller
                    </p>
                    <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950">
                        dreyv works with whoever runs the paywall.
                    </h2>
                    <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
                        The SDK issues the request, catches the 402, negotiates the cheapest quote below
                        your cap, settles on Solana USDC, retries with{" "}
                        <code className="rounded bg-white px-1.5 py-0.5 text-sm text-violet-700 ring-1 ring-violet-100">
                            X-PAYMENT
                        </code>
                        , and hands back the fulfilled body plus a receipt.
                    </p>
                    <ul className="mt-10 grid gap-3 sm:grid-cols-2">
                        {sellers.map((s) => (
                            <li
                                key={s.name}
                                className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-white p-5"
                            >
                                <DreyvStar className="mt-1 h-3 w-3 shrink-0 text-violet-600" />
                                <div>
                                    <div className="font-medium text-slate-950">{s.name}</div>
                                    <div className="text-sm text-slate-500">{s.note}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            {/* Code */}
            <section className="mx-auto max-w-6xl px-6 py-24">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-violet-700">
                    <DreyvStar className="h-3 w-3 text-violet-600" />
                    Drop it in
                </p>
                <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950">
                    Six lines. Any agent framework. Any x402 URL.
                </h2>
                <div className="mt-10 overflow-hidden rounded-3xl border border-violet-100 bg-slate-950">
                    <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3 text-xs font-medium text-slate-400">
                        <span className="h-2.5 w-2.5 rounded-full bg-violet-400" />
                        agent.ts
                    </div>
                    <pre className="overflow-x-auto p-6 text-[13px] leading-relaxed text-slate-100">
                        <code>{`import { DreyvX402Client } from "@dreyv/x402-client";

const dreyv = new DreyvX402Client({
  apiKey: process.env.DREYV_API_KEY!,   // dk_live_… or dak_…
  maxPricePerCallUsd: 0.25,             // hard cap per request
  budgetUsd: 5,                         // hard cap for the whole run
});

const res = await dreyv.fetch("https://api.some-seller.com/premium/report", {
  method: "POST",
  body: { symbol: "SOL" },
});

console.log(res.upstream.body);
console.log(res.payment?.explorer);     // solscan link, if paid
console.log("spent so far:", dreyv.spent);`}</code>
                    </pre>
                </div>
            </section>

            {/* CTA */}
            <section className="border-t border-violet-100 bg-white">
                <div className="mx-auto max-w-6xl px-6 py-24">
                    <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-white to-violet-50 p-12 sm:p-16">
                        <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950">
                            x402 is an open protocol.
                            <span className="block text-violet-600">dreyv gives the agent its wallet.</span>
                        </h2>
                        <div className="mt-10 flex flex-wrap items-center gap-4">
                            <Link
                                href="/auth?intent=api"
                                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(124,58,237,0.6)] transition hover:bg-violet-700"
                            >
                                Start with a free key
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link
                                href="/developers"
                                className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:border-violet-300 hover:bg-violet-50"
                            >
                                Read the developer docs
                                <ArrowUpRight className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
