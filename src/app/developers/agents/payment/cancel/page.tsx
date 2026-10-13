/**
 * Public landing page for Stripe / Paystack cancel redirects after an x402
 * agent checkout. Browser-safe (no bearer token required).
 */
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Payment cancelled · dreyv x402",
    description: "The card checkout was cancelled. The original 402 challenge is still valid: your agent can retry on any rail.",
    robots: { index: false, follow: false },
};

export default async function X402PaymentCancelPage({
    searchParams,
}: {
    searchParams: Promise<{ payment_id?: string }>;
}) {
    const sp = await searchParams;
    const paymentId = sp.payment_id ?? "";

    return (
        <main className="mx-auto flex min-h-[80vh] max-w-2xl flex-col justify-center px-6 py-16">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.25)]">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                    x402 · cancelled
                </div>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
                    Checkout cancelled
                </h1>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                    No charge was made. The original 402 challenge is still valid: your agent can retry on any available rail (Solana USDC, Stripe,
                    or Paystack).
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

                <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Link
                        href="/developers/agents"
                        className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-violet-700"
                    >
                        Back to agent docs
                    </Link>
                </div>
            </div>
        </main>
    );
}
