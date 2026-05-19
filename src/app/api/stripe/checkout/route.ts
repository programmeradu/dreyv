import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidBillingEmail } from "@/lib/billing-email";

/**
 * POST /api/stripe/checkout
 * Body: { tier: "mini" | "max" }
 * Returns: { url } — Stripe Checkout (subscription) hosted URL.
 *
 * Requires env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_MINI, STRIPE_PRICE_ID_MAX
 */
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeKey) {
        return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
    }

    let body: { tier?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const tier = body.tier as "mini" | "max";
    if (tier !== "mini" && tier !== "max") {
        return NextResponse.json({ error: "tier must be 'mini' or 'max'" }, { status: 400 });
    }

    const priceId =
        tier === "mini"
            ? process.env.STRIPE_PRICE_ID_MINI?.trim()
            : process.env.STRIPE_PRICE_ID_MAX?.trim();
    if (!priceId) {
        return NextResponse.json(
            { error: `No Stripe price ID configured for tier: ${tier}` },
            { status: 503 },
        );
    }

    let email: string | null = null;
    if (db) {
        const [row] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);
        email = row?.email ?? null;
    }
    const billingEmail = (email || "").trim();
    if (!isValidBillingEmail(billingEmail)) {
        return NextResponse.json(
            { error: "A valid email is required on your account before checkout. Add it in Settings, then try again." },
            { status: 422 },
        );
    }

    const origin =
        req.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        `https://${req.headers.get("host") || "dreyv.com"}`;
    const base = origin.replace(/\/$/, "");

    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("customer_email", billingEmail);
    form.set("line_items[0][price]", priceId);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${base}/app/billing?stripe=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${base}/app/billing?stripe=cancel`);
    form.set("allow_promotion_codes", "true");
    form.set("metadata[dreyv_user_id]", user.id);
    form.set("metadata[wallet]", user.walletAddress ?? "");
    form.set("metadata[tier]", tier);
    form.set("subscription_data[metadata][dreyv_user_id]", user.id);
    form.set("subscription_data[metadata][tier]", tier);

    try {
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${stripeKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
        });
        const data = await res.json();
        if (!res.ok) {
            console.error("[Stripe] checkout error:", data);
            return NextResponse.json(
                { error: data?.error?.message || "Failed to create Stripe checkout" },
                { status: 502 },
            );
        }
        return NextResponse.json({ url: data.url, sessionId: data.id });
    } catch (error) {
        console.error("[Stripe] checkout error:", error);
        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }
}
