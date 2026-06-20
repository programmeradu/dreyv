/**
 * Settles an agent_payments row when its hosted-checkout provider confirms
 * payment. Idempotent: a second call with the same paymentId is a no-op.
 *
 * Used by both the Stripe and Paystack webhooks.
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentApiKeys, agentPayments, users } from "@/db/schema";
import { getSku } from "@/lib/agent/skus";

export async function settleAgentPayment(args: {
    paymentId: string;
    providerRef?: string | null;
}): Promise<{ ok: boolean; alreadySettled?: boolean; receiptToken?: string }> {
    if (!db) return { ok: false };

    const [row] = await db
        .select()
        .from(agentPayments)
        .where(eq(agentPayments.id, args.paymentId))
        .limit(1);
    if (!row) return { ok: false };
    if (row.status === "paid") return { ok: true, alreadySettled: true };

    const receiptToken = `rcpt_${randomBytes(24).toString("base64url")}`;
    const now = new Date();

    await db.update(agentPayments)
        .set({
            status: "paid",
            receiptToken,
            paidAt: now,
            providerRef: args.providerRef ?? row.providerRef,
        })
        .where(eq(agentPayments.id, row.id));

    const amountUsdNum = Number(row.amountUsd);
    await db.update(agentApiKeys)
        .set({ spentUsd: sql`${agentApiKeys.spentUsd} + ${amountUsdNum.toFixed(4)}` })
        .where(eq(agentApiKeys.id, row.apiKeyId));

    const sku = getSku(row.sku);
    if (sku && (sku.id === "dreyv.tier.mini.month" || sku.id === "dreyv.tier.max.month")) {
        const tier = sku.id === "dreyv.tier.max.month" ? "max" : "mini";
        const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await db.update(users)
            .set({ tier, tierExpiresAt: expires })
            .where(eq(users.id, row.userId));
    }

    return { ok: true, receiptToken };
}
