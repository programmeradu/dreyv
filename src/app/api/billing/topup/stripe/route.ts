export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidBillingEmail } from "@/lib/billing-email";

/**
 * POST /api/billing/topup/stripe
 * Body: { amount: number }  // USD
 * Returns: { url } — Stripe Checkout (one-time) for prepaid balance top-up.
 */
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeKey) return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });

    let body: { amount?: number } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 5 || amount > 10000) {
        return NextResponse.json({ error: "amount must be between $5 and $10,000" }, { status: 400 });
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
            { error: "Add a valid email on your account before topping up." },
            { status: 422 },
        );
    }

    const origin =
        req.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        `https://${req.headers.get("host") || "dreyv.com"}`;
    const base = origin.replace(/\/$/, "");
    const amountMinor = Math.round(amount * 100);

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("customer_email", billingEmail);
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][product_data][name]", "Dreyv prepaid balance top-up");
    form.set(
        "line_items[0][price_data][product_data][description]",
        `Adds $${amount.toFixed(2)} USDC credit to your Dreyv prepaid balance.`,
    );
    form.set("line_items[0][price_data][unit_amount]", String(amountMinor));
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${base}/app/settings?topup=success&amount=${amount}`);
    form.set("cancel_url", `${base}/app/settings?topup=cancel`);
    form.set("metadata[dreyv_user_id]", user.id);
    form.set("metadata[purpose]", "prepaid_topup");
    form.set("metadata[amount_usd]", String(amount));
    form.set("payment_intent_data[metadata][dreyv_user_id]", user.id);
    form.set("payment_intent_data[metadata][purpose]", "prepaid_topup");
    form.set("payment_intent_data[metadata][amount_usd]", String(amount));

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
            console.error("[Stripe topup] error:", data);
            return NextResponse.json(
                { error: data?.error?.message || "Failed to create Stripe checkout" },
                { status: 502 },
            );
        }
        return NextResponse.json({ url: data.url, sessionId: data.id });
    } catch (error) {
        console.error("[Stripe topup] error:", error);
        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }
}
