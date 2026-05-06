/**
 * Client-visible billing API paths. Dreyv now bills via Paystack (primary).
 * Set NEXT_PUBLIC_BILLING_PROVIDER=square to use the Square fallback if it's wired up.
 */
export function billingCheckoutPath(): string {
    const p = process.env.NEXT_PUBLIC_BILLING_PROVIDER?.trim().toLowerCase();
    if (p === "square") return "/api/square/checkout";
    return "/api/paystack/checkout";
}

export function billingStatusPath(): string {
    const p = process.env.NEXT_PUBLIC_BILLING_PROVIDER?.trim().toLowerCase();
    if (p === "square") return "/api/square/status";
    return "/api/paystack/status";
}
