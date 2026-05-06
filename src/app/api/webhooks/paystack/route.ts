import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
    getPaystackSecret,
    paystackTierForCustomer,
    tierForPlanCode,
    verifyPaystackWebhookSignature,
} from "@/lib/paystack";

const HANDLED = new Set([
    "charge.success",
    "subscription.create",
    "subscription.disable",
    "subscription.not_renew",
    "subscription.expiring_cards",
    "invoice.create",
    "invoice.update",
    "invoice.payment_failed",
]);

/**
 * POST /api/webhooks/paystack
 * Verifies HMAC-SHA512 signature, then reconciles user tier.
 */
export async function POST(req: NextRequest) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    let secret: string;
    try {
        // Paystack signs webhooks with the SECRET KEY. We accept PAYSTACK_WEBHOOK_SECRET
        // as an override for environments that prefer a separate value, but default to the
        // secret key when not set.
        secret = (process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || getPaystackSecret());
    } catch {
        return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 });
    }

    const rawBody = await req.text();
    const sig = req.headers.get("x-paystack-signature");

    if (!verifyPaystackWebhookSignature(rawBody, sig, secret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: { event?: string; data?: any };
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const event = payload.event || "";
    if (!HANDLED.has(event)) {
        return NextResponse.json({ ok: true, ignored: true, event });
    }

    const data = payload.data || {};
    const customerCode: string | undefined =
        data?.customer?.customer_code || data?.subscription?.customer?.customer_code;
    const customerEmail: string | undefined =
        data?.customer?.email || data?.subscription?.customer?.email;
    const metaUserId: string | undefined =
        data?.metadata?.dreyv_user_id || data?.metadata?.keystone_user_id;
    const planCodeFromEvent: string | undefined =
        data?.plan?.plan_code || data?.subscription?.plan?.plan_code || data?.plan_object?.plan_code;

    // Resolve user
    let userId: string | null = null;
    if (metaUserId && /^[0-9a-f-]{36}$/i.test(metaUserId)) {
        userId = metaUserId;
    } else if (customerEmail) {
        const [row] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, customerEmail))
            .limit(1);
        userId = row?.id ?? null;
    }

    if (!userId) {
        return NextResponse.json({ ok: true, ignored: true, message: "No mapped user" });
    }

    let nextTier: "free" | "mini" | "max" = "free";

    if (event === "subscription.disable" || event === "subscription.not_renew") {
        // Re-check active subscriptions before downgrading
        if (customerCode) {
            const r = await paystackTierForCustomer(customerCode);
            nextTier = r.tier;
        } else {
            nextTier = "free";
        }
    } else if (customerCode) {
        const r = await paystackTierForCustomer(customerCode);
        nextTier = r.tier !== "free" ? r.tier : tierForPlanCode(planCodeFromEvent);
    } else {
        nextTier = tierForPlanCode(planCodeFromEvent);
    }

    await db.update(users).set({ tier: nextTier }).where(eq(users.id, userId));

    return NextResponse.json({ ok: true, userId, tier: nextTier, event });
}
