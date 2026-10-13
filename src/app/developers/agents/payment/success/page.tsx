/**
 * Public landing page for Stripe / Paystack card redirects after an x402
 * agent payment. The browser cannot attach the `Authorization: Bearer dak_…`
 * header that the agent poll API requires, so this page polls a public,
 * receipt-free status endpoint to verify the payment ACTUALLY settled
 * before showing a "Payment received" confirmation. The receipt token
 * itself stays gated behind the bearer-authenticated agent poll.
 */
import type { Metadata } from "next";
import SuccessClient from "./SuccessClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Payment status · dreyv x402",
    description: "Verifying your card payment with dreyv's x402 settlement layer.",
    robots: { index: false, follow: false },
};

export default async function X402PaymentSuccessPage({
    searchParams,
}: {
    searchParams: Promise<{ payment_id?: string; session_id?: string; reference?: string }>;
}) {
    const sp = await searchParams;
    return <SuccessClient paymentId={sp.payment_id ?? ""} />;
}
