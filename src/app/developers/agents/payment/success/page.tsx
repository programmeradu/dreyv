/**
 * Public landing page for Stripe / Paystack card redirects after an x402
 * agent payment. The browser cannot attach the `Authorization: Bearer dak_…`
 * header that the poll API requires, so we render a public confirmation page
 * instead and instruct the agent to poll the API itself for the receipt.
 */
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Payment received · Dreyv x402",
    description: "Your card payment settled. The receipt token is ready for your agent to claim via the x402 poll endpoint.",
    robots: { index: false, follow: false },
};

export default async function X402PaymentSuccessPage({
    searchParams,
}: {
    searchParams: Promise<{ payment_id?: string; session_id?: string; reference?: string }>;
}) {
    const sp = await searchParams;
    const paymentId = sp.payment_id ?? "";

    return (
        <main className="mx-auto flex min-h-[80vh] max-w-2xl flex-col justify-center px-6 py-16">
            <div className="rounded-3xl border border-violet-200 bg-white p-10 shadow-[0_24px_80px_-40px_rgba(124,58,237,0.35)]">
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-violet-700">
                    x402 · paid
                </div>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
                    Payment received
                </h1>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                    Your card settled successfully. The receipt is ready for your
                    agent to claim — no further action is needed in the browser.
                </p>

                {paymentId ? (
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                            Payment ID
                        </div>
                        <code className="mt-1 block break-all font-mono text-[13px] text-slate-900">
                            {paymentId}
                        </code>
                    </div>
                ) : null}

                <div className="mt-6 space-y-3">
                    <p className="text-[13px] font-medium text-slate-700">
                        Your agent should now poll for the receipt:
                    </p>
                    <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-[12px] leading-relaxed text-slate-100">
                        <code>{`curl https://dreyv.com/api/x402/checkout/${paymentId || "{payment_id}"} \\
  -H "Authorization: Bearer dak_…"`}</code>
                    </pre>
                    <p className="text-[12px] text-slate-500">
                        The response includes <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">status: "paid"</code> and
                        a single-use <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">receipt_token</code> the agent
                        exchanges at the protected resource.
                    </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Link
                        href="/developers/agents"
                        className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-violet-700"
                    >
                        Back to agent docs
                    </Link>
                    <Link
                        href="/app/settings"
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-[13px] font-medium text-slate-700 transition hover:border-violet-300 hover:text-violet-700"
                    >
                        Manage agent keys
                    </Link>
                </div>
            </div>

            <p className="mt-6 text-center text-[12px] text-slate-500">
                You can safely close this tab — the agent will pick up the receipt on its next poll.
            </p>
        </main>
    );
}
