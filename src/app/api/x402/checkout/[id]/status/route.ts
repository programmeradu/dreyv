export const runtime = "edge";
/**
 * GET /api/x402/checkout/[id]/status
 * Public, unauthenticated status probe used by the browser success/cancel
 * landing pages to confirm a card payment actually settled before showing
 * a "Payment received" UI. Never returns the receipt token — that stays
 * gated behind the bearer-authenticated poll endpoint for the agent.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentPayments, cryptoInvoices } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const { id } = await ctx.params;
    const [payment] = await db
        .select()
        .from(agentPayments)
        .where(eq(agentPayments.id, id))
        .limit(1);

    if (!payment) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let status = payment.status;
    if (status === "pending" && payment.invoiceId) {
        const [invoice] = await db
            .select()
            .from(cryptoInvoices)
            .where(eq(cryptoInvoices.id, payment.invoiceId))
            .limit(1);
        if (invoice?.expiresAt && invoice.expiresAt.getTime() < Date.now()) {
            status = "expired";
        }
    }

    return NextResponse.json({
        id: payment.id,
        status,
        rail: payment.rail,
        amount_usd: Number(payment.amountUsd),
        paid_at: payment.paidAt,
        sku: payment.sku,
    });
}
