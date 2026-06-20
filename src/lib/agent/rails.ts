/**
 * Card payment rails for the x402 agent checkout.
 *
 * The Solana/USDC rail uses an on-chain transfer + manual verify call. Card
 * rails use hosted provider checkouts (Stripe Checkout, Paystack), with the
 * receipt minted asynchronously when the provider's webhook fires.
 *
 * Per-call SKUs (e.g. dreyv.treasury.report $1) → one-time payment / charge.
 * Tier SKUs (dreyv.tier.mini.month / .max.month) → subscription / plan.
 *
 * Card rails are unavailable for SKUs below the provider minimum (~$0.50);
 * the caller should fall back to Solana/USDC for micro-transactions.
 */
import { paystackInitializeOneTime, planCodeForTier } from "@/lib/paystack";
import type { AgentSku } from "@/lib/agent/skus";

export const CARD_RAIL_MIN_USD = 0.50;

export interface RailHandoff {
    rail: "stripe" | "paystack";
    checkoutUrl: string;
    providerRef: string;
    expiresAt: Date | null;
}

function originFromHeaders(headers: Headers): string {
    const fromHeader = headers.get("origin") || headers.get("x-forwarded-host");
    const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const host = headers.get("host");
    const base =
        env ||
        (fromHeader && /^https?:\/\//.test(fromHeader) ? fromHeader : null) ||
        (host ? `https://${host}` : null) ||
        "https://dreyv.com";
    return base.replace(/\/$/, "");
}

export function stripeIsAvailable(): boolean {
    return !!process.env.STRIPE_SECRET_KEY?.trim();
}

export function paystackIsAvailable(): boolean {
    return !!process.env.PAYSTACK_SECRET_KEY?.trim();
}

/**
 * Create a Stripe Checkout Session for an agent payment.
 * Per-call SKUs use mode=payment (one-time). Tier SKUs use mode=subscription
 * with the existing STRIPE_PRICE_ID_MINI / _MAX so the user is enrolled in
 * the same recurring plan the web UI uses.
 */
export async function createStripeRail(args: {
    sku: AgentSku;
    billingEmail: string;
    userId: string;
    paymentId: string;
    headers: Headers;
}): Promise<RailHandoff> {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) throw new Error("Stripe is not configured");
    if (args.sku.priceUsd < CARD_RAIL_MIN_USD) {
        throw new Error(`Stripe rail requires SKU price ≥ $${CARD_RAIL_MIN_USD.toFixed(2)}`);
    }

    const origin = originFromHeaders(args.headers);
    const successUrl = `${origin}/developers/agents/payment/success?payment_id=${args.paymentId}`;
    const cancelUrl = `${origin}/developers/agents/payment/cancel?payment_id=${args.paymentId}`;

    const isTier = args.sku.id.startsWith("dreyv.tier.");
    const form = new URLSearchParams();
    form.set("customer_email", args.billingEmail);
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("metadata[dreyv_user_id]", args.userId);
    form.set("metadata[dreyv_agent_payment_id]", args.paymentId);
    form.set("metadata[dreyv_sku]", args.sku.id);

    if (isTier) {
        const tier = args.sku.id.includes(".max.") ? "max" : "mini";
        const priceId =
            tier === "max"
                ? process.env.STRIPE_PRICE_ID_MAX?.trim()
                : process.env.STRIPE_PRICE_ID_MINI?.trim();
        if (!priceId) throw new Error(`No Stripe price configured for tier ${tier}`);
        form.set("mode", "subscription");
        form.set("line_items[0][price]", priceId);
        form.set("line_items[0][quantity]", "1");
        form.set("metadata[tier]", tier);
        form.set("subscription_data[metadata][dreyv_user_id]", args.userId);
        form.set("subscription_data[metadata][dreyv_agent_payment_id]", args.paymentId);
        form.set("subscription_data[metadata][tier]", tier);
    } else {
        form.set("mode", "payment");
        form.set("line_items[0][price_data][currency]", "usd");
        form.set("line_items[0][price_data][product_data][name]", args.sku.name);
        form.set("line_items[0][price_data][product_data][description]", args.sku.description);
        form.set("line_items[0][price_data][unit_amount]", String(Math.round(args.sku.priceUsd * 100)));
        form.set("line_items[0][quantity]", "1");
        // Payment Intent metadata is what charge.succeeded sees.
        form.set("payment_intent_data[metadata][dreyv_user_id]", args.userId);
        form.set("payment_intent_data[metadata][dreyv_agent_payment_id]", args.paymentId);
        form.set("payment_intent_data[metadata][dreyv_sku]", args.sku.id);
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
        // Surface the full Stripe error so callers can distinguish "account
        // restricted" / "invalid_request_error" / etc. from a generic failure.
        const msg = data?.error?.message || "Stripe checkout failed";
        const code = data?.error?.code ? ` [${data.error.code}]` : "";
        const type = data?.error?.type ? ` (${data.error.type})` : "";
        console.error("[x402] Stripe session create failed:", { status: res.status, error: data?.error });
        throw new Error(`${msg}${code}${type}`);
    }
    if (!data?.url || !data?.id) {
        console.error("[x402] Stripe session missing url/id:", data);
        throw new Error("Stripe returned no checkout URL");
    }
    const expiresAt = typeof data.expires_at === "number" ? new Date(data.expires_at * 1000) : null;
    return {
        rail: "stripe",
        checkoutUrl: data.url as string,
        providerRef: data.id as string,
        expiresAt,
    };
}

/**
 * Create a Paystack hosted-checkout transaction for an agent payment.
 * Tier SKUs use the configured plan code (subscription). Per-call SKUs use
 * a one-off charge converted USD → GHS via PAYSTACK_USD_GHS_RATE.
 */
export async function createPaystackRail(args: {
    sku: AgentSku;
    billingEmail: string;
    userId: string;
    paymentId: string;
    headers: Headers;
}): Promise<RailHandoff> {
    if (!paystackIsAvailable()) throw new Error("Paystack is not configured");
    if (args.sku.priceUsd < CARD_RAIL_MIN_USD) {
        throw new Error(`Paystack rail requires SKU price ≥ $${CARD_RAIL_MIN_USD.toFixed(2)}`);
    }

    const origin = originFromHeaders(args.headers);
    const callbackUrl = `${origin}/api/x402/checkout/${args.paymentId}?card=verify`;
    const metadata = {
        dreyv_user_id: args.userId,
        dreyv_agent_payment_id: args.paymentId,
        dreyv_sku: args.sku.id,
    };

    const isTier = args.sku.id.startsWith("dreyv.tier.");
    if (isTier) {
        const tier = args.sku.id.includes(".max.") ? "max" : "mini";
        const plan = planCodeForTier(tier);
        if (!plan) throw new Error(`No Paystack plan code configured for tier ${tier}`);
        const { paystackInitializeTransaction } = await import("@/lib/paystack");
        const session = await paystackInitializeTransaction({
            email: args.billingEmail,
            plan,
            callbackUrl,
            metadata: { ...metadata, tier },
        });
        return {
            rail: "paystack",
            checkoutUrl: session.authorization_url,
            providerRef: session.reference,
            expiresAt: null,
        };
    }

    const session = await paystackInitializeOneTime({
        email: args.billingEmail,
        amountUsd: args.sku.priceUsd,
        callbackUrl,
        metadata,
    });
    return {
        rail: "paystack",
        checkoutUrl: session.authorization_url,
        providerRef: session.reference,
        expiresAt: null,
    };
}
