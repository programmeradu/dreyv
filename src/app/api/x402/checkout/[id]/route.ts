/**
 * GET /api/x402/checkout/[id]
 * Poll the status of an agent payment. Returns one of pending / paid / expired.
 * When paid, includes the single-use receipt token (only ever returned to the
 * caller that owns the originating API key).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentPayments, cryptoInvoices } from "@/db/schema";
import { extractBearer, resolveAgentKey } from "@/lib/agent/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const key = await resolveAgentKey(extractBearer(req));
    if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const [row] = await db
        .select({
            id: agentPayments.id,
            sku: agentPayments.sku,
            status: agentPayments.status,
            amountUsd: agentPayments.amountUsd,
            txSignature: agentPayments.txSignature,
            receiptToken: agentPayments.receiptToken,
            paidAt: agentPayments.paidAt,
            invoiceId: agentPayments.invoiceId,
            expiresAt: cryptoInvoices.expiresAt,
            memo: cryptoInvoices.memo,
            receivingAddress: cryptoInvoices.receivingAddress,
        })
        .from(agentPayments)
        .innerJoin(cryptoInvoices, eq(cryptoInvoices.id, agentPayments.invoiceId))
        .where(and(eq(agentPayments.id, id), eq(agentPayments.apiKeyId, key.id)))
        .limit(1);

    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let status = row.status;
    if (status === "pending" && row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        status = "expired";
    }

    return NextResponse.json({
        id: row.id,
        sku: row.sku,
        status,
        amount_usd: Number(row.amountUsd),
        tx_signature: row.txSignature,
        receipt_token: status === "paid" ? row.receiptToken : null,
        paid_at: row.paidAt,
        memo: row.memo,
        receiving_address: row.receivingAddress,
    });
}
