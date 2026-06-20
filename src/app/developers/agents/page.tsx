import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Bot, Coins, KeyRound, ShieldCheck, Wallet, Globe, Rocket } from "lucide-react";

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

                {/* ─── Which path should my agent use? ────────────────────── */}
                <section className="mt-12 rounded-3xl border border-violet-100 bg-white p-6 md:p-8">
                    <h2 className="text-lg font-semibold text-slate-900">Which path should my agent use?</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
                        Agents don&apos;t need a &quot;card skill&quot; — they pay over HTTP. Pick the path that matches what your agent has access to. All three return the same single-use <code className="font-mono text-[12px]">rcpt_…</code> receipt token.
                    </p>
                    <div className="mt-5 overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-sm">
                            <thead className="text-xs uppercase tracking-wide text-slate-500">
                                <tr className="border-b border-violet-100">
                                    <th className="py-3 pr-4 font-medium">If your agent has…</th>
                                    <th className="py-3 pr-4 font-medium">Use</th>
                                    <th className="py-3 pr-4 font-medium">Round-trips</th>
                                    <th className="py-3 pr-4 font-medium">Human needed?</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-violet-100 text-slate-700">
                                <tr>
                                    <td className="py-3 pr-4">An <strong>API key only</strong> (no wallet, no browser)</td>
                                    <td className="py-3 pr-4"><strong className="text-violet-700">Hosted wallet</strong> — <code className="font-mono text-[12px]">POST /api/x402/pay</code></td>
                                    <td className="py-3 pr-4">1</td>
                                    <td className="py-3 pr-4">No (after one-time funding)</td>
                                </tr>
                                <tr>
                                    <td className="py-3 pr-4">Its own <strong>Solana keypair</strong> (Privy/Turnkey/Crossmint/wallet-as-a-service)</td>
                                    <td className="py-3 pr-4">BYO wallet — <code className="font-mono text-[12px]">/checkout</code> → sign + send → <code className="font-mono text-[12px]">/verify</code></td>
                                    <td className="py-3 pr-4">2-3</td>
                                    <td className="py-3 pr-4">No</td>
                                </tr>
                                <tr>
                                    <td className="py-3 pr-4">A <strong>browser tool</strong> (Cursor, Computer Use, Operator)</td>
                                    <td className="py-3 pr-4">Card rail — open <code className="font-mono text-[12px]">checkout_url</code></td>
                                    <td className="py-3 pr-4">2 + checkout</td>
                                    <td className="py-3 pr-4">Often yes (card form)</td>
                                </tr>
                                <tr>
                                    <td className="py-3 pr-4">A <strong>backend caller</strong> surfacing to a human</td>
                                    <td className="py-3 pr-4">Card rail — return <code className="font-mono text-[12px]">checkout_url</code> to user</td>
                                    <td className="py-3 pr-4">2 + checkout</td>
                                    <td className="py-3 pr-4">Yes (by design)</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* ─── Path 1: Fully autonomous one-call ──────────────────── */}
                <section className="mt-8 rounded-3xl border-2 border-violet-200 bg-white p-6 md:p-8">
                    <div className="flex items-start gap-4">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-600 text-white">
                            <Rocket className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                                Path 1 · zero-setup autonomous
                            </p>
                            <h2 className="mt-2 text-xl font-semibold text-slate-900">Hosted agent wallet — one call, no human</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                                Every Dreyv user gets a custodial Solana wallet at{" "}
                                <Link href="/app/settings" className="font-medium text-violet-700 underline-offset-4 hover:underline">Settings → API keys</Link>.
                                Fund it once with USDC (and a tiny SOL float for fees); from then on, agents pay invoices in a single HTTP call.
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 space-y-4 text-sm text-slate-700">
                        <p><strong>1. Fund the wallet once</strong> — open Settings, copy the address (or scan the QR), send USDC + ~0.01 SOL from any Solana wallet.</p>
                        <p><strong>2. Hand the agent its key</strong> — same <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">dak_…</code> key as the other paths.</p>
                        <p><strong>3. Pay in one call:</strong></p>
                        <Code>{`curl -X POST https://dreyv.com/api/x402/pay \\
  -H "Authorization: Bearer dak_…" \\
  -H "Content-Type: application/json" \\
  -d '{"sku":"dreyv.treasury.snapshot"}'`}</Code>
                        <p>Successful response — signature confirmed on-chain, receipt minted, balance debited:</p>
                        <Code>{`{
  "payment_id": "8f4c…",
  "status": "paid",
  "rail": "solana",
  "tx_signature": "5jK…",
  "receipt_token": "rcpt_uK7m…",
  "amount_usd": 0.10,
  "amount_usdc": "0.1",
  "sku": { "id": "dreyv.treasury.snapshot", "name": "Treasury snapshot", "fulfilment": "…" },
  "agent_wallet": "Bq4…",
  "balance_remaining": { "usdc": "9.9", "usdc_minor": "9900000" },
  "paid_at": "2026-06-20T18:11:42Z"
}`}</Code>
                        <p>If the wallet is underfunded, the same endpoint returns <code className="font-mono text-[12px]">HTTP 402</code> with the exact USDC amount needed and a <code className="font-mono text-[12px]">solana_pay_url</code> the agent can surface to its operator:</p>
                        <Code>{`{
  "error": "insufficient_funds",
  "message": "Agent wallet needs 0.05 more USDC (and a tiny SOL float for tx fees).",
  "agent_wallet": "Bq4…",
  "required":  { "usdc": "0.10", "usdc_minor": "100000", "sol_lamports_min": "50000" },
  "balance":   { "usdc": "0.05", "usdc_minor": "50000",  "sol_lamports": "12000000" },
  "fund_with": {
    "address": "Bq4…",
    "usdc_mint": "EPjFWdd5Aufq…",
    "solana_pay_url": "solana:Bq4…?amount=0.05&spl-token=EPj…",
    "note": "Send USDC (SPL) on Solana mainnet. Include ~0.01 SOL once for tx fees."
  },
  "retry_after_funding": true
}`}</Code>
                        <p className="text-[12px] text-slate-500">
                            <strong>How it works:</strong> Dreyv generates a Solana keypair per user, encrypts it at rest with AES-256-GCM, and uses it solely to settle invoices for that user&apos;s API keys. Same spend caps, same receipt tokens. <Link href="/legal/terms" className="text-violet-700 underline-offset-4 hover:underline">Custodial terms apply.</Link>
                        </p>
                    </div>
                </section>

                {/* ─── Path 2: BYO wallet (existing 5-step) ───────────────── */}
                <div className="mt-12">
                    <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white ring-2 ring-violet-200">
                            <Wallet className="h-4 w-4 text-violet-700" />
                        </span>
                        <h2 className="text-xl font-semibold text-slate-900">Path 2 — Bring your own Solana wallet</h2>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                        Already have a keypair (or using a wallet-as-a-service like{" "}
                        <a href="https://privy.io" target="_blank" rel="noreferrer" className="text-violet-700 underline-offset-4 hover:underline">Privy server wallets</a>,{" "}
                        <a href="https://turnkey.com" target="_blank" rel="noreferrer" className="text-violet-700 underline-offset-4 hover:underline">Turnkey</a>, or{" "}
                        <a href="https://crossmint.com" target="_blank" rel="noreferrer" className="text-violet-700 underline-offset-4 hover:underline">Crossmint</a>)?
                        Use the classic x402 dance — request → 402 → sign + send → verify.
                    </p>
                </div>


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
