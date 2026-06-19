/**
 * Client-visible billing API paths. Dreyv bills via Stripe by default.
 * Override with NEXT_PUBLIC_BILLING_PROVIDER=paystack | square if you ever
 * need to fall back to a different provider.
 */
type Provider = "stripe" | "paystack" | "square";

function provider(): Provider {
    const p = process.env.NEXT_PUBLIC_BILLING_PROVIDER?.trim().toLowerCase();
    if (p === "paystack") return "paystack";
    if (p === "square") return "square";
    return "stripe";
}

export function billingCheckoutPath(): string {
    switch (provider()) {
        case "paystack": return "/api/paystack/checkout";
        case "square": return "/api/square/checkout";
        default: return "/api/stripe/checkout";
    }
}

export function billingStatusPath(): string {
    switch (provider()) {
        case "paystack": return "/api/paystack/status";
        case "square": return "/api/square/status";
        default: return "/api/stripe/status";
    }
}
