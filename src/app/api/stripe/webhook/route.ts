import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * POST /api/stripe/webhook
 * Stripe sends subscription lifecycle events here. We reconcile users.tier.
 *
 * Required envs: STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_MINI, STRIPE_PRICE_ID_MAX
 * Configure the endpoint in the Stripe dashboard with these events:
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 */
export const runtime = "edge";
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

function verifyStripeSignature(
    payload: string,
    header: string | null,
    secret: string,
    toleranceSeconds = 300,
): boolean {
    if (!header) return false;
    const parts = Object.fromEntries(
        header.split(",").map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        }),
    );
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) return false;

    const tsNum = Number(t);
    if (!Number.isFinite(tsNum)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > toleranceSeconds) {
        return false;
    }

    const signed = `${t}.${payload}`;
    const expected = crypto
        .createHmac("sha256", secret)
        .update(signed, "utf8")
        .digest("hex");
    try {
        return crypto.timingSafeEqual(
            Buffer.from(expected, "hex"),
            Buffer.from(v1, "hex"),
        );
    } catch {
        return false;
    }
}

async function setTier(userId: string, tier: Tier, expiresAt: Date | null) {
    if (!db) return;
    await db
        .update(users)
        .set({ tier, tierExpiresAt: expiresAt })
        .where(eq(users.id, userId));
}

async function setTierByEmail(email: string, tier: Tier, expiresAt: Date | null) {
    if (!db || !email) return;
    await db
        .update(users)
        .set({ tier, tierExpiresAt: expiresAt })
        .where(eq(users.email, email));
}

export async function POST(req: NextRequest) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
        return NextResponse.json(
            { error: "Stripe webhook is not configured" },
            { status: 503 },
        );
    }

    const payload = await req.text();
    const sig = req.headers.get("stripe-signature");
    if (!verifyStripeSignature(payload, sig, secret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
        event = JSON.parse(payload);
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    try {
        const obj = event.data.object as Record<string, unknown>;
        const metadata = (obj.metadata as Record<string, string> | undefined) ?? {};
        const userId = metadata.dreyv_user_id;
        const agentPaymentId = metadata.dreyv_agent_payment_id;

        // x402 card rail: settle the agent_payments row + mint receipt.
        // Runs in addition to the tier reconciliation below for tier SKUs.
        if (agentPaymentId && (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded")) {
            const { settleAgentPayment } = await import("@/lib/agent/settle");
            const providerRef = (obj.id as string | undefined) ?? null;
            await settleAgentPayment({ paymentId: agentPaymentId, providerRef });
        }

        // Prepaid balance top-up (POST /api/agents/balance/topup, stripe rail).
        if (
            metadata.source === "balance_topup" &&
            userId &&
            metadata.amount_minor &&
            (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded")
        ) {
            try {
                const { creditAgentBalance } = await import("@/lib/agent/balance");
                const amountMinor = BigInt(metadata.amount_minor);
                const ref = (obj.id as string | undefined) ?? `${event.type}:${Date.now()}`;
                await creditAgentBalance({ userId, amountMinor, reason: "topup_stripe", ref });
            } catch (err) {
                console.error("[Stripe] balance top-up credit failed:", err);
            }
        }

        switch (event.type) {
            case "checkout.session.completed": {
                // Initial activation. Resolve tier from metadata.
                const tier = (metadata.tier as Tier) || "free";
                if (userId && tier !== "free") {
                    await setTier(userId, tier, null);
                } else {
                    const email = (obj.customer_email as string | undefined) || "";
                    if (email && tier !== "free") {
                        await setTierByEmail(email, tier, null);
                    }
                }
                break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated": {
                const status = obj.status as string;
                const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? [];
                const priceId = items[0]?.price?.id ?? null;
                const subMeta =
                    (obj.metadata as Record<string, string> | undefined) ?? {};
                const subUserId = subMeta.dreyv_user_id || userId;

                let tier: Tier = tierForPrice(priceId);
                if (status !== "active" && status !== "trialing" && status !== "past_due") {
                    tier = "free";
                }
                const cpe = obj.current_period_end as number | undefined;
                const expiresAt = cpe ? new Date(cpe * 1000) : null;
                if (subUserId) await setTier(subUserId, tier, expiresAt);
                break;
            }
            case "customer.subscription.deleted": {
                const subMeta =
                    (obj.metadata as Record<string, string> | undefined) ?? {};
                const subUserId = subMeta.dreyv_user_id || userId;
                if (subUserId) await setTier(subUserId, "free", null);
                break;
            }
            case "invoice.payment_failed": {
                // Soft signal: leave tier intact; client status route will reconcile.
                break;
            }
            default:
                break;
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error("[Stripe] webhook error:", error);
        return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
    }
}
