/**
 * Paystack helpers — Dreyv subscription billing.
 *
 * Flow:
 *  1. POST /transaction/initialize with plan code → user redirected to authorization_url
 *  2. Paystack redirects back to our callback → we call /transaction/verify/:reference
 *  3. Webhook (charge.success, subscription.create, subscription.disable, invoice.*) reconciles tier
 *
 * Env:
 *   PAYSTACK_SECRET_KEY        sk_live_… or sk_test_…
 *   PAYSTACK_WEBHOOK_SECRET    same value as PAYSTACK_SECRET_KEY (Paystack signs webhooks with the secret key)
 *   PAYSTACK_PLAN_CODE_MINI    PLN_xxx for Mini
 *   PAYSTACK_PLAN_CODE_MAX     PLN_xxx for Max
 */
import crypto from "crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

const PAYSTACK_TIER_PRICES: Record<PaystackTier, { amount: number; currency: "GHS" }> = {
    mini: { amount: 55000, currency: "GHS" },
    max: { amount: 225000, currency: "GHS" },
};

export type PaystackTier = "mini" | "max";

export function getPaystackSecret(): string {
    const k = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!k) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    return k;
}

export function planCodeForTier(tier: PaystackTier): string | null {
    if (tier === "mini") return process.env.PAYSTACK_PLAN_CODE_MINI?.trim() || null;
    if (tier === "max") return process.env.PAYSTACK_PLAN_CODE_MAX?.trim() || null;
    return null;
}

export function tierForPlanCode(code: string | null | undefined): "free" | "mini" | "max" {
    if (!code) return "free";
    const mini = process.env.PAYSTACK_PLAN_CODE_MINI?.trim();
    const max = process.env.PAYSTACK_PLAN_CODE_MAX?.trim();
    if (max && code === max) return "max";
    if (mini && code === mini) return "mini";
    return "free";
}

function priceForPlanCode(code: string): { amount: number; currency: "GHS" } {
    const tier = tierForPlanCode(code);
    if (tier === "mini" || tier === "max") return PAYSTACK_TIER_PRICES[tier];
    throw new Error("No Paystack amount configured for the selected plan");
}

async function paystackFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${getPaystackSecret()}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    const text = await res.text();
    let json: any = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        // pass through
    }
    if (!res.ok) {
        throw new Error(
            `Paystack ${path} failed [${res.status}]: ${json?.message || text || "unknown"}`,
        );
    }
    return json;
}

/**
 * Initialize a transaction. For subscription plans, pass plan code; amount is taken from the plan.
 * Returns { authorization_url, reference, access_code }.
 */
export async function paystackInitializeTransaction(args: {
    email: string;
    plan: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
    reference?: string;
}): Promise<{ authorization_url: string; reference: string; access_code: string }> {
    const price = priceForPlanCode(args.plan);
    const json = await paystackFetch("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
            email: args.email,
            amount: price.amount,
            currency: price.currency,
            plan: args.plan,
            callback_url: args.callbackUrl,
            metadata: args.metadata ?? {},
            ...(args.reference ? { reference: args.reference } : {}),
        }),
    });
    if (!json?.status || !json?.data?.authorization_url) {
        throw new Error(`Paystack initialize returned no authorization_url: ${JSON.stringify(json)}`);
    }
    return {
        authorization_url: json.data.authorization_url,
        reference: json.data.reference,
        access_code: json.data.access_code,
    };
}

/**
 * Verify a transaction by reference. Returns the full transaction record.
 */
export async function paystackVerifyTransaction(reference: string): Promise<any> {
    const json = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, {
        method: "GET",
    });
    return json?.data ?? null;
}

/**
 * Fetch a customer's active subscriptions and return the highest tier they currently have.
 */
export async function paystackTierForCustomer(customerCode: string): Promise<{
    tier: "free" | "mini" | "max";
    status: string;
    nextChargeDate: string | null;
}> {
    const json = await paystackFetch(
        `/subscription?customer=${encodeURIComponent(customerCode)}&perPage=50`,
        { method: "GET" },
    );
    const subs: any[] = json?.data ?? [];
    const active = subs.filter((s) => s.status === "active" || s.status === "non-renewing");

    let bestTier: "free" | "mini" | "max" = "free";
    let bestStatus = "inactive";
    let next: string | null = null;

    for (const s of active) {
        const code = s?.plan?.plan_code as string | undefined;
        const t = tierForPlanCode(code);
        if (t === "max" || (t === "mini" && bestTier !== "max")) {
            bestTier = t;
            bestStatus = s.status;
            next = s.next_payment_date ?? null;
        }
    }

    return { tier: bestTier, status: bestStatus, nextChargeDate: next };
}

/**
 * Verify the X-Paystack-Signature header. Paystack signs the raw body with HMAC-SHA512
 * using the secret key.
 */
export function verifyPaystackWebhookSignature(
    rawBody: string,
    signature: string | null,
    secret: string,
): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
        return false;
    }
}
