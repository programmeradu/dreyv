/**
 * Client-visible billing API paths. Dreyv bills via Stripe & Paystack in parallel.
 * Override with NEXT_PUBLIC_BILLING_PROVIDER=paystack if needed.
 */
type Provider = "stripe" | "paystack";

function provider(): Provider {
    const p = process.env.NEXT_PUBLIC_BILLING_PROVIDER?.trim().toLowerCase();
    if (p === "paystack") return "paystack";
    return "stripe";
}

export function billingCheckoutPath(): string {
    switch (provider()) {
        case "paystack": return "/api/paystack/checkout";
        default: return "/api/stripe/checkout";
    }
}

export function billingStatusPath(): string {
    switch (provider()) {
        case "paystack": return "/api/paystack/status";
        default: return "/api/stripe/status";
    }
}
