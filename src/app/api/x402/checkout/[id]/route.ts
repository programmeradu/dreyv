export const runtime = "edge";
/**
 * GET /api/x402/checkout/[id]
 * Poll the status of an agent payment. Returns pending / paid / expired.
 * When paid, includes the single-use receipt token (only ever returned to
 * the caller that owns the originating API key).
 *
 * Card-rail rows (Stripe, Paystack) have no on-chain invoice; their
 * expiry / address fields will be null.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentPayments, cryptoInvoices } from "@/db/schema";
import { extractBearer, resolveAgentKey } from "@/lib/agent/api-keys";

export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const key = await resolveAgentKey(extractBearer(req));
    if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const [payment] = await db
        .select()
        .from(agentPayments)
        .where(and(eq(agentPayments.id, id), eq(agentPayments.apiKeyId, key.id)))
        .limit(1);

    if (!payment) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let invoice: typeof cryptoInvoices.$inferSelect | null = null;
    if (payment.invoiceId) {
        const [row] = await db
            .select()
            .from(cryptoInvoices)
            .where(eq(cryptoInvoices.id, payment.invoiceId))
            .limit(1);
        invoice = row ?? null;
    }

    let status = payment.status;
    if (status === "pending" && invoice?.expiresAt && invoice.expiresAt.getTime() < Date.now()) {
        status = "expired";
    }

    return NextResponse.json({
        id: payment.id,
        sku: payment.sku,
        status,
        rail: payment.rail,
        amount_usd: Number(payment.amountUsd),
        tx_signature: payment.txSignature,
        provider_ref: payment.providerRef,
        checkout_url: payment.checkoutUrl,
        receipt_token: status === "paid" ? payment.receiptToken : null,
        paid_at: payment.paidAt,
        memo: invoice?.memo ?? null,
        receiving_address: invoice?.receivingAddress ?? null,
    });
}
