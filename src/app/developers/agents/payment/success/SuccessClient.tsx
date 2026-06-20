"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StatusResponse = {
    id: string;
    status: "pending" | "paid" | "expired" | "failed" | string;
    rail: string | null;
    amount_usd: number;
    paid_at: string | null;
    sku: string | null;
};

type PollState =
    | { kind: "missing" }
    | { kind: "loading"; attempt: number }
    | { kind: "paid"; data: StatusResponse }
    | { kind: "pending"; data: StatusResponse }
    | { kind: "expired"; data: StatusResponse }
    | { kind: "failed"; data: StatusResponse }
    | { kind: "not_found" }
    | { kind: "error"; message: string };

const MAX_ATTEMPTS = 20; // ~60s @ 3s interval
const POLL_INTERVAL_MS = 3000;

export default function SuccessClient({ paymentId }: { paymentId: string }) {
    const [state, setState] = useState<PollState>(
        paymentId ? { kind: "loading", attempt: 0 } : { kind: "missing" },
    );

    useEffect(() => {
        if (!paymentId) return;
        let cancelled = false;
        let attempt = 0;

        const poll = async () => {
            while (!cancelled && attempt < MAX_ATTEMPTS) {
                attempt += 1;
                setState({ kind: "loading", attempt });
                try {
                    const res = await fetch(
                        `/api/x402/checkout/${encodeURIComponent(paymentId)}/status`,
                        { cache: "no-store" },
                    );
                    if (res.status === 404) {
                        if (!cancelled) setState({ kind: "not_found" });
                        return;
                    }
                    if (!res.ok) throw new Error(`status ${res.status}`);
                    const data = (await res.json()) as StatusResponse;
                    if (cancelled) return;

                    if (data.status === "paid") {
                        setState({ kind: "paid", data });
                        return;
                    }
                    if (data.status === "expired") {
                        setState({ kind: "expired", data });
                        return;
                    }
                    if (data.status === "failed") {
                        setState({ kind: "failed", data });
                        return;
                    }
                    // pending — keep polling
                    setState({ kind: "pending", data });
                } catch (err) {
                    if (attempt >= MAX_ATTEMPTS && !cancelled) {
                        setState({
                            kind: "error",
                            message: err instanceof Error ? err.message : "unknown error",
                        });
                        return;
                    }
                }
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            }
            // Hit max attempts while still pending — leave the user with the
            // last pending state but flip into a soft "still verifying" view.
            if (!cancelled && attempt >= MAX_ATTEMPTS) {
                setState((prev) =>
                    prev.kind === "pending"
                        ? prev
                        : { kind: "error", message: "timed out waiting for webhook" },
                );
            }
        };

        void poll();
        return () => {
            cancelled = true;
        };
    }, [paymentId]);

    return (
        <main className="mx-auto flex min-h-[80vh] max-w-2xl flex-col justify-center px-6 py-16">
            <div className="rounded-3xl border border-violet-200 bg-white p-10 shadow-[0_24px_80px_-40px_rgba(124,58,237,0.35)]">
                <Header state={state} />
                <Body state={state} paymentId={paymentId} />

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

                {state.kind === "paid" ? (
                    <div className="mt-6 space-y-3">
                        <p className="text-[13px] font-medium text-slate-700">
                            Your agent can now claim the receipt:
                        </p>
                        <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-[12px] leading-relaxed text-slate-100">
                            <code>{`curl https://dreyv.com/api/x402/checkout/${paymentId} \\
  -H "Authorization: Bearer dak_…"`}</code>
                        </pre>
                        <p className="text-[12px] text-slate-500">
                            The response includes{" "}
                            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                                status: &quot;paid&quot;
                            </code>{" "}
                            and a single-use{" "}
                            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                                receipt_token
                            </code>{" "}
                            the agent exchanges at the protected resource.
                        </p>
                    </div>
                ) : null}

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
                {state.kind === "paid"
                    ? "You can safely close this tab — the agent will pick up the receipt on its next poll."
                    : "Keep this tab open while we confirm the payment with the card network."}
            </p>
        </main>
    );
}

function Header({ state }: { state: PollState }) {
    const { label, tone } = badgeFor(state);
    return (
        <>
            <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${tone}`}
            >
                x402 · {label}
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
                {titleFor(state)}
            </h1>
        </>
    );
}

function Body({ state, paymentId }: { state: PollState; paymentId: string }) {
    if (state.kind === "missing") {
        return (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                No payment reference in the URL. If you arrived here from a Stripe
                or Paystack checkout, the redirect was missing the{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">
                    payment_id
                </code>{" "}
                parameter. Ask your agent to re-issue the checkout.
            </p>
        );
    }
    if (state.kind === "loading" || state.kind === "pending") {
        const attempt = state.kind === "loading" ? state.attempt : 0;
        return (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                We&apos;re confirming your payment with the card network. This
                usually takes a few seconds while the webhook settles.
                {attempt > 0 ? (
                    <span className="ml-1 text-slate-500">
                        (check {attempt}/{MAX_ATTEMPTS})
                    </span>
                ) : null}
            </p>
        );
    }
    if (state.kind === "paid") {
        return (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                Your card settled successfully
                {state.data.amount_usd
                    ? ` for $${state.data.amount_usd.toFixed(2)}`
                    : ""}
                . The receipt is ready for your agent to claim — no further
                action is needed in the browser.
            </p>
        );
    }
    if (state.kind === "expired") {
        return (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                This checkout session expired before payment completed. Ask your
                agent to start a fresh x402 checkout.
            </p>
        );
    }
    if (state.kind === "failed") {
        return (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                The card payment was declined or failed. Try a different card or
                rail, then have your agent re-issue the checkout.
            </p>
        );
    }
    if (state.kind === "not_found") {
        return (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                We couldn&apos;t find a payment with ID{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">
                    {paymentId}
                </code>
                . It may have already been cleaned up, or the link is wrong.
            </p>
        );
    }
    return (
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            We hit an error while checking the payment status ({state.message}).
            Your agent can still poll the authenticated endpoint directly to get
            the source of truth.
        </p>
    );
}

function badgeFor(state: PollState): { label: string; tone: string } {
    switch (state.kind) {
        case "paid":
            return {
                label: "paid",
                tone: "border-violet-200 bg-violet-50 text-violet-700",
            };
        case "loading":
        case "pending":
            return {
                label: "verifying",
                tone: "border-amber-200 bg-amber-50 text-amber-700",
            };
        case "expired":
            return {
                label: "expired",
                tone: "border-slate-200 bg-slate-50 text-slate-600",
            };
        case "failed":
            return {
                label: "failed",
                tone: "border-rose-200 bg-rose-50 text-rose-700",
            };
        case "not_found":
            return {
                label: "not found",
                tone: "border-slate-200 bg-slate-50 text-slate-600",
            };
        case "missing":
            return {
                label: "missing id",
                tone: "border-slate-200 bg-slate-50 text-slate-600",
            };
        case "error":
            return {
                label: "unknown",
                tone: "border-slate-200 bg-slate-50 text-slate-600",
            };
    }
}

function titleFor(state: PollState): string {
    switch (state.kind) {
        case "paid":
            return "Payment received";
        case "loading":
        case "pending":
            return "Verifying your payment…";
        case "expired":
            return "Checkout expired";
        case "failed":
            return "Payment failed";
        case "not_found":
            return "Payment not found";
        case "missing":
            return "Missing payment reference";
        case "error":
            return "Status check unavailable";
    }
}
