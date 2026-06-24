import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidBillingEmail } from "@/lib/billing-email";
import { getPaystackSecret, paystackInitializeOneTime } from "@/lib/paystack";

/**
 * POST /api/billing/topup/paystack
 * Body: { amount: number }  // USD (converted to GHS via PAYSTACK_USD_GHS_RATE)
 * Returns: { url } — Paystack authorization_url for prepaid balance top-up.
 */
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try { getPaystackSecret(); } catch {
        return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 });
    }

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
    const callbackUrl = `${origin.replace(/\/$/, "")}/app/settings?paystack=verify&purpose=topup`;

    try {
        const session = await paystackInitializeOneTime({
            email: billingEmail,
            amountUsd: amount,
            callbackUrl,
            metadata: {
                dreyv_user_id: user.id,
                wallet: user.walletAddress,
                purpose: "prepaid_topup",
                amount_usd: amount,
            },
        });
        return NextResponse.json({
            url: session.authorization_url,
            reference: session.reference,
            amount: session.amount,
            currency: session.currency,
        });
    } catch (error) {
        console.error("[Paystack topup] error:", error);
        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }
}
