import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidBillingEmail } from "@/lib/billing-email";
import {
    getPaystackSecret,
    paystackInitializeTransaction,
    planCodeForTier,
    type PaystackTier,
} from "@/lib/paystack";

/**
 * POST /api/paystack/checkout
 * Body: { tier: "mini" | "max" }
 * Returns: { url } — Paystack hosted checkout (authorization_url)
 */

export const runtime = "edge";
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        getPaystackSecret();
    } catch {
        return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 });
    }

    let body: { tier?: string } = {};
    try {
        body = await req.json();
    } catch {
        // empty
    }

    const tier = body.tier as PaystackTier;
    if (tier !== "mini" && tier !== "max") {
        return NextResponse.json({ error: "tier must be 'mini' or 'max'" }, { status: 400 });
    }

    const plan = planCodeForTier(tier);
    if (!plan) {
        return NextResponse.json(
            { error: `No Paystack plan code configured for tier: ${tier}` },
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
            {
                error:
                    "A valid email is required on your account before checkout. Add it in Settings, then try again.",
            },
            { status: 422 },
        );
    }

    const origin =
        req.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        `https://${req.headers.get("host") || "dreyv.com"}`;
    const callbackUrl = `${origin.replace(/\/$/, "")}/app/billing?paystack=verify`;

    try {
        const session = await paystackInitializeTransaction({
            email: billingEmail,
            plan,
            callbackUrl,
            metadata: {
                dreyv_user_id: user.id,
                wallet: user.walletAddress,
                tier,
            },
        });
        return NextResponse.json({ url: session.authorization_url, reference: session.reference });
    } catch (error) {
        console.error("[Paystack] checkout error:", error);
        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }
}
