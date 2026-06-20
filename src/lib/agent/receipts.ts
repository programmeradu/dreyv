/**
 * Receipt-token validation for x402 fulfilment endpoints.
 *
 * Agents call /api/x402/fulfil/<sku-slug> with `Authorization: Bearer rcpt_…`.
 * This module:
 *   1. Resolves the token to its agent_payments row.
 *   2. Verifies status=paid and the SKU id matches what the endpoint sells.
 *   3. Atomically marks the receipt consumed (single-use). A second redemption
 *      with the same token returns `already_consumed`.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentPayments } from "@/db/schema";

export interface ResolvedReceipt {
    payment: typeof agentPayments.$inferSelect;
}

export type ReceiptError =
    | "missing"
    | "not_found"
    | "wrong_sku"
    | "not_paid"
    | "already_consumed";

export interface ReceiptResult {
    ok: boolean;
    receipt?: ResolvedReceipt;
    error?: ReceiptError;
}

export function extractReceiptToken(req: Request): string | null {
    const auth = req.headers.get("authorization") || req.headers.get("Authorization");
    if (auth) {
        const m = auth.match(/^Bearer\s+(rcpt_[A-Za-z0-9_-]+)\s*$/);
        if (m) return m[1];
    }
    const url = new URL(req.url);
    const qp = url.searchParams.get("receipt") || url.searchParams.get("receipt_token");
    if (qp && /^rcpt_[A-Za-z0-9_-]+$/.test(qp)) return qp;
    return null;
}

/**
 * Consume the receipt atomically. Returns the row if this call won the race,
 * or { error: "already_consumed" } if another caller already burned it.
 */
export async function redeemReceipt(token: string, expectedSku: string): Promise<ReceiptResult> {
    if (!db) return { ok: false, error: "not_found" };

    const [row] = await db
        .select()
        .from(agentPayments)
        .where(eq(agentPayments.receiptToken, token))
        .limit(1);

    if (!row) return { ok: false, error: "not_found" };
    if (row.sku !== expectedSku) return { ok: false, error: "wrong_sku" };
    if (row.status !== "paid") return { ok: false, error: "not_paid" };
    if (row.consumedAt) return { ok: false, error: "already_consumed" };

    // Atomic burn: only succeeds if consumed_at is still null.
    const updated = await db
        .update(agentPayments)
        .set({ consumedAt: new Date() })
        .where(and(eq(agentPayments.id, row.id), isNull(agentPayments.consumedAt)))
        .returning({ id: agentPayments.id });

    if (updated.length === 0) return { ok: false, error: "already_consumed" };

    return { ok: true, receipt: { payment: { ...row, consumedAt: new Date() } } };
}

export function receiptErrorStatus(err: ReceiptError): number {
    switch (err) {
        case "missing": return 401;
        case "not_found": return 401;
        case "not_paid": return 402;
        case "wrong_sku": return 403;
        case "already_consumed": return 410;
    }
}
