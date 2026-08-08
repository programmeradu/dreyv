import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
    getPaystackSecret,
    paystackTierForCustomer,
    paystackVerifyTransaction,
    tierForPlanCode,
} from "@/lib/paystack";

/**
 * GET /api/paystack/status
 *   Optional ?reference=… — verifies the transaction and reconciles tier.
 *   Without reference, looks up customer by email and returns highest active subscription tier.
 */

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        getPaystackSecret();
    } catch {
        return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 });
    }

    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const reference = req.nextUrl.searchParams.get("reference")?.trim();

    let nextTier: "free" | "mini" | "max" = "free";
    let status = "inactive";
    let nextChargeDate: string | null = null;
    let customerCode: string | null = null;

    try {
        if (reference) {
            const tx = await paystackVerifyTransaction(reference);
            if (tx?.status === "success") {
                customerCode = tx?.customer?.customer_code ?? null;
                const planCode = tx?.plan_object?.plan_code || tx?.plan || null;
                nextTier = tierForPlanCode(planCode);
                status = "active";
            }
        }

        // Always reconcile from active subscriptions if we have a customer code
        if (!customerCode) {
            const [row] = await db
                .select({ email: users.email })
                .from(users)
                .where(eq(users.id, user.id))
                .limit(1);
            const email = row?.email?.trim();
            if (email) {
                // lookup customer by email
                const r = await fetch(
                    `https://api.paystack.co/customer/${encodeURIComponent(email)}`,
                    { headers: { Authorization: `Bearer ${getPaystackSecret()}` } },
                );
                if (r.ok) {
                    const json = await r.json();
                    customerCode = json?.data?.customer_code ?? null;
                }
            }
        }

        if (customerCode) {
            const result = await paystackTierForCustomer(customerCode);
            if (result.tier !== "free") {
                nextTier = result.tier;
                status = result.status;
                nextChargeDate = result.nextChargeDate;
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
        console.error("[Paystack] status error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
