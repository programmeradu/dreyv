import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/stripe/status
 *   Optional ?session_id=cs_… — verifies the just-completed Checkout Session
 *   and reconciles users.tier. Otherwise, looks up the Stripe customer by
 *   email and reports their highest active subscription tier.
 */
export const dynamic = "force-dynamic";

type Tier = "free" | "mini" | "max";

function tierForPrice(priceId: string | null | undefined): Tier {
    if (!priceId) return "free";
    const mini = process.env.STRIPE_PRICE_ID_MINI?.trim();
    const max = process.env.STRIPE_PRICE_ID_MAX?.trim();
    if (max && priceId === max) return "max";
    if (mini && priceId === mini) return "mini";
    return "free";
}

async function stripeGet(path: string, key: string) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
        headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return res.json();
}

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) {
        return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
    }
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const sessionId = req.nextUrl.searchParams.get("session_id")?.trim();

    let nextTier: Tier = "free";
    let status = "inactive";
    let nextChargeDate: string | null = null;
    let customerId: string | null = null;

    try {
        // 1. If a checkout session was just completed, resolve customer from it.
        if (sessionId) {
            const session = await stripeGet(
                `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
                key,
            );
            if (session?.customer) {
                customerId = typeof session.customer === "string"
                    ? session.customer
                    : session.customer.id;
            }
        }

        // 2. Otherwise look up Stripe customer by user email.
        if (!customerId) {
            const [row] = await db
                .select({ email: users.email })
                .from(users)
                .where(eq(users.id, user.id))
                .limit(1);
            const email = row?.email?.trim();
            if (email) {
                const list = await stripeGet(
                    `customers?email=${encodeURIComponent(email)}&limit=1`,
                    key,
                );
                customerId = list?.data?.[0]?.id ?? null;
            }
        }

        // 3. Inspect active subscriptions for this customer.
        if (customerId) {
            const subs = await stripeGet(
                `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
                key,
            );
            const order: Record<Tier, number> = { free: 0, mini: 1, max: 2 };
            type SubItem = { price?: { id?: string } };
            type Sub = {
                status?: string;
                current_period_end?: number;
                items?: { data?: SubItem[] };
            };
            const list: Sub[] = subs?.data ?? [];
            for (const sub of list) {
                const s = sub.status;
                if (s !== "active" && s !== "trialing" && s !== "past_due") continue;
                const priceId = sub.items?.data?.[0]?.price?.id ?? null;
                const t = tierForPrice(priceId);
                if (order[t] > order[nextTier]) {
                    nextTier = t;
                    status = s ?? "active";
                    nextChargeDate = sub.current_period_end
                        ? new Date(sub.current_period_end * 1000).toISOString()
                        : null;
                }
            }
        }

        const reconciled = nextTier !== user.tier;
        if (reconciled) {
            await db.update(users).set({ tier: nextTier }).where(eq(users.id, user.id));
        }

        return NextResponse.json({
            tier: nextTier,
            status,
            nextChargeDate,
            reconciled,
        });
    } catch (error) {
        console.error("[Stripe] status error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
