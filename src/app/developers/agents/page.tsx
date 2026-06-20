import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Bot, Coins, KeyRound, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
    title: "Agent Payments (x402) | Dreyv Developers",
    description:
        "Let autonomous agents pay for Dreyv calls in USDC on Solana. Mint an agent API key, settle a 402 payment, and claim a single-use receipt token.",
    alternates: { canonical: "/developers/agents" },
    openGraph: {
        title: "Agent Payments (x402) | Dreyv",
        description:
            "x402-style payments for autonomous agents — USDC on Solana, single-use receipt tokens, per-key spend caps.",
        url: "/developers/agents",
        type: "article",
    },
    twitter: {
        card: "summary_large_image",
        title: "Agent Payments (x402) | Dreyv",
        description:
            "x402-style payments for autonomous agents — USDC on Solana, single-use receipts.",
    },
};

function Code({ children }: { children: React.ReactNode }) {
    return (
        <pre className="overflow-x-auto rounded-2xl border border-violet-100 bg-slate-950 p-5 text-[13px] leading-relaxed text-slate-100">
            <code className="font-mono">{children}</code>
        </pre>
    );
}

function Step({
    n, title, children,
}: { n: number; title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-3xl border border-violet-100 bg-white p-6 md:p-8">
            <div className="flex items-start gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-600 text-sm font-semibold text-white">
                    {n}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
                    <div className="mt-3 space-y-4 text-sm leading-relaxed text-slate-700">{children}</div>
                </div>
            </div>
        </section>
    );
}

export default function AgentPaymentsPage() {
    return (
        <main className="min-h-screen bg-white">
            {/* ambient glow */}
            <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(167,139,250,0.18),transparent_70%)]" />

            <div className="mx-auto max-w-4xl px-6 py-16 md:py-24">
                <Link
                    href="/developers"
                    className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline"
                >
                    ← Developers
                </Link>

                <header className="mt-6">
                    <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-violet-700">
                        <Bot className="h-3.5 w-3.5" /> x402 · agent-native
                    </p>
                    <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                        Agent payments on Dreyv
                    </h1>
                    <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 md:text-lg">
                        Let an autonomous agent — Claude, GPT, a LangGraph worker, anything
                        with an HTTP client and a wallet — pay for Dreyv calls in USDC on
                        Solana. Per-key spend caps, single-use receipt tokens, instant
                        settlement.
                    </p>
                </header>

                <div className="mt-10 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-violet-100 bg-white p-5">
                        <KeyRound className="h-5 w-5 text-violet-600" />
                        <p className="mt-2 text-sm font-medium text-slate-900">Per-agent keys</p>
                        <p className="mt-1 text-xs text-slate-600">Issue one bearer key per agent. Cap its spend. Revoke instantly.</p>
                    </div>
                    <div className="rounded-2xl border border-violet-100 bg-white p-5">
                        <Coins className="h-5 w-5 text-violet-600" />
                        <p className="mt-2 text-sm font-medium text-slate-900">USDC on Solana</p>
                        <p className="mt-1 text-xs text-slate-600">~0.4s finality, sub-cent fees. No card, no chargebacks, no KYC for the agent.</p>
                    </div>
                    <div className="rounded-2xl border border-violet-100 bg-white p-5">
                        <ShieldCheck className="h-5 w-5 text-violet-600" />
                        <p className="mt-2 text-sm font-medium text-slate-900">Single-use receipts</p>
                        <p className="mt-1 text-xs text-slate-600">Verified payments mint a <code className="font-mono text-[11px]">rcpt_…</code> token redeemable against the SKU.</p>
                    </div>
                </div>

                <div className="mt-12 space-y-6">
                    <Step n={1} title="Issue an agent key">
                        <p>
                            From <Link href="/app/settings" className="font-medium text-violet-700 underline-offset-4 hover:underline">Settings → API keys</Link>,
                            click <strong>New agent key</strong>. Set an optional spend cap. The
                            secret <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">dak_…</code> is
                            shown <em>exactly once</em>.
                        </p>
                    </Step>

                    <Step n={2} title="Request a SKU — receive a 402">
                        <p>The agent calls the checkout endpoint with its bearer token and the SKU it wants.</p>
                        <Code>{`curl -X POST https://dreyv.com/api/x402/checkout \\
  -H "Authorization: Bearer dak_…" \\
  -H "Content-Type: application/json" \\
  -d '{"sku":"dreyv.treasury.report"}'`}</Code>
                        <p>The server replies <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">HTTP 402</code> with payment instructions:</p>
                        <Code>{`HTTP/1.1 402 Payment Required
X-Payment-Required: solana-usdc
X-Payment-Address: GoyXcFZPCKFvDN1o4taJPNcPNANZBQ69XMZaBaTHFrsg
X-Payment-Amount: 1.00
X-Payment-Memo: DRYV-3F2A8B1C4D5E

{
  "x402": {
    "scheme": "solana-usdc",
    "rail": "solana",
    "amount": "1.00",
    "asset": "USDC",
    "chain": "solana",
    "receiving_address": "GoyXcFZPCKF…",
    "memo": "DRYV-3F2A8B1C4D5E",
    "expires_at": "2026-06-19T23:30:00Z",
    "solana_pay_url": "solana:GoyX…?amount=1&spl-token=EPj…&memo=DRYV-…",
    "payment_id": "8f4c…",
    "verify_url": "/api/x402/checkout/8f4c…/verify"
  },
  "alternatives": {
    "stripe":   { "rail": "stripe",   "checkout_url": "https://checkout.stripe.com/…",  "payment_id": "a91b…", "poll_url": "/api/x402/checkout/a91b…" },
    "paystack": { "rail": "paystack", "checkout_url": "https://checkout.paystack.com/…", "payment_id": "c702…", "poll_url": "/api/x402/checkout/c702…" }
  },
  "sku": { "id": "dreyv.treasury.report", "name": "Treasury AI Report" }
}`}</Code>
                        <p className="mt-2 text-[12px] text-slate-500">
                            Card rails (Stripe, Paystack) are offered as alternatives when the SKU price is ≥ $0.50 and the key owner has a billing email on file. To force a single rail, pass <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">{"\"rail\": \"stripe\""}</code> or <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">{"\"rail\": \"paystack\""}</code> in the request body.
                        </p>
                    </Step>

                    <Step n={3} title="Settle the payment">
                        <p className="mb-2"><strong>USDC on Solana (default rail):</strong></p>
                        <p>
                            Send exactly <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">amount</code> USDC
                            to <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">receiving_address</code> with
                            the <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">memo</code> attached
                            (Memo program <code className="font-mono text-[11px]">MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr</code>). Most agent
                            wallets do this in a single instruction. Then POST the signature to <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">verify_url</code>.
                        </p>
                        <p className="mt-3 mb-2"><strong>Card (Stripe / Paystack):</strong></p>
                        <p>
                            Open <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">checkout_url</code> in
                            the agent&apos;s browser (or hand it to a human). On successful
                            payment the provider webhook settles the row server-side and
                            mints the receipt — no verify call needed. Poll <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">poll_url</code> until <code className="font-mono text-[12px]">status: &quot;paid&quot;</code> and the
                            response includes <code className="font-mono text-[12px]">receipt_token</code>.
                        </p>
                    </Step>

                    <Step n={4} title="Verify (Solana) or poll (card)">
                        <p className="mb-2"><strong>Solana:</strong></p>
                        <Code>{`curl -X POST https://dreyv.com/api/x402/checkout/8f4c…/verify \\
  -H "Authorization: Bearer dak_…" \\
  -H "Content-Type: application/json" \\
  -d '{"signature":"5jK…"}'`}</Code>
                        <p className="mt-3 mb-2"><strong>Card:</strong></p>
                        <Code>{`curl https://dreyv.com/api/x402/checkout/a91b… \\
  -H "Authorization: Bearer dak_…"`}</Code>
                        <p className="mt-2">Both paths converge on the same response shape:</p>
                        <Code>{`{
  "id": "8f4c…",
  "status": "paid",
  "rail": "solana",
  "tx_signature": "5jK…",
  "receipt_token": "rcpt_uK7m…",
  "sku": {
    "id": "dreyv.treasury.report",
    "name": "Treasury AI Report",
    "fulfilment": "GET /api/x402/fulfil/treasury-report?wallet=<addr> with the receipt token."
  }
}`}</Code>
                    </Step>

                    <Step n={5} title="Claim the fulfilment">
                        <p>
                            Present the receipt token where the SKU says. Tier-upgrade SKUs
                            apply automatically to the key&apos;s owner. Per-call SKUs expose a
                            dedicated <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">/api/x402/fulfil/…</code> endpoint.
                        </p>
                    </Step>
                </div>


                <section className="mt-12 rounded-3xl border border-violet-100 bg-white p-6 md:p-8">
                    <h2 className="text-lg font-semibold text-slate-900">SKU catalog</h2>
                    <p className="mt-2 text-sm text-slate-600">All amounts settled in USDC on Solana.</p>
                    <div className="mt-5 overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                            <thead className="text-xs uppercase tracking-wide text-slate-500">
                                <tr className="border-b border-violet-100">
                                    <th className="py-3 pr-4 font-medium">SKU</th>
                                    <th className="py-3 pr-4 font-medium">What it unlocks</th>
                                    <th className="py-3 pr-4 font-medium text-right">Price</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-violet-100 text-slate-700">
                                <tr>
                                    <td className="py-3 pr-4 font-mono text-[12px] text-violet-700">dreyv.treasury.snapshot</td>
                                    <td className="py-3 pr-4">Portfolio value, holdings, 24h delta for one Solana wallet.</td>
                                    <td className="py-3 pr-4 text-right font-medium">$0.10</td>
                                </tr>
                                <tr>
                                    <td className="py-3 pr-4 font-mono text-[12px] text-violet-700">dreyv.treasury.report</td>
                                    <td className="py-3 pr-4">Full AI treasury report: composition, concentration, runway, suggestions.</td>
                                    <td className="py-3 pr-4 text-right font-medium">$1.00</td>
                                </tr>
                                <tr>
                                    <td className="py-3 pr-4 font-mono text-[12px] text-violet-700">dreyv.tier.mini.month</td>
                                    <td className="py-3 pr-4">Upgrades the key owner to Mini for 30 days.</td>
                                    <td className="py-3 pr-4 text-right font-medium">$49.00</td>
                                </tr>
                                <tr>
                                    <td className="py-3 pr-4 font-mono text-[12px] text-violet-700">dreyv.tier.max.month</td>
                                    <td className="py-3 pr-4">Upgrades the key owner to Max for 30 days.</td>
                                    <td className="py-3 pr-4 text-right font-medium">$199.00</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <div className="mt-10 flex flex-wrap items-center gap-4">
                    <Link
                        href="/app/settings"
                        className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
                    >
                        Mint an agent key <ArrowUpRight className="h-4 w-4" />
                    </Link>
                    <a
                        href="https://x402.org"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 underline-offset-4 hover:underline"
                    >
                        x402 spec <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                </div>
            </div>
        </main>
    );
}
