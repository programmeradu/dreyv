/**
 * POST /api/x402/checkout/[id]/verify
 * Body: { signature: string }
 *
 * Verifies the Solana transaction credits our receiving wallet with the
 * exact expected amount, mint, and memo. On success: marks the payment
 * `paid`, mints a single-use receipt token, applies any SKU side-effects
 * (e.g. tier upgrade), and updates the API key's `spentUsd`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentApiKeys, agentPayments, cryptoInvoices, users } from "@/db/schema";
import { extractBearer, resolveAgentKey } from "@/lib/agent/api-keys";
import { getSku } from "@/lib/agent/skus";
import { verifySolanaPayment } from "@/lib/billing/crypto-verify-solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
    signature: z.string().trim().min(32).max(200),
});

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const key = await resolveAgentKey(extractBearer(req));
    if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }
    const signature = parsed.data.signature;

    const { id } = await ctx.params;
    const [row] = await db
        .select({
            payment: agentPayments,
            invoice: cryptoInvoices,
        })
        .from(agentPayments)
        .innerJoin(cryptoInvoices, eq(cryptoInvoices.id, agentPayments.invoiceId))
        .where(and(eq(agentPayments.id, id), eq(agentPayments.apiKeyId, key.id)))
        .limit(1);

    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Already paid → return idempotent success (but never re-reveal the receipt).
    if (row.payment.status === "paid") {
        return NextResponse.json({
            id: row.payment.id,
            status: "paid",
            tx_signature: row.payment.txSignature,
            receipt_token: null,
            already_settled: true,
        });
    }

    if (row.invoice.expiresAt.getTime() < Date.now()) {
        await db.update(agentPayments)
            .set({ status: "expired" })
            .where(eq(agentPayments.id, row.payment.id));
        return NextResponse.json({ error: "invoice_expired" }, { status: 410 });
    }

    // Verify on-chain.
    const expectedMinor = BigInt(row.invoice.amountMinor);
    const result = await verifySolanaPayment({
        signature,
        receivingAddress: row.invoice.receivingAddress,
        mint: row.invoice.contractAddress,
        expectedMinor,
        memo: row.invoice.memo,
    });

    if (!result.ok) {
        return NextResponse.json(
            { error: "payment_unverified", reason: result.reason ?? "verification_failed" },
            { status: 402 },
        );
    }

    // Mint receipt + finalise everything in a small transactional sequence.
    const receiptToken = `rcpt_${randomBytes(24).toString("base64url")}`;
    const now = new Date();
    const sku = getSku(row.payment.sku);

    await db.update(agentPayments)
        .set({
            status: "paid",
            txSignature: signature,
            receiptToken,
            paidAt: now,
        })
        .where(eq(agentPayments.id, row.payment.id));

    await db.update(cryptoInvoices)
        .set({ status: "confirmed", txSignature: signature, confirmedAt: now })
        .where(eq(cryptoInvoices.id, row.invoice.id));

    const amountUsdNum = Number(row.payment.amountUsd);
    await db.update(agentApiKeys)
        .set({ spentUsd: sql`${agentApiKeys.spentUsd} + ${amountUsdNum.toFixed(4)}` })
        .where(eq(agentApiKeys.id, key.id));

    // SKU side-effect: tier upgrades apply to the key owner.
    if (sku && (sku.id === "dreyv.tier.mini.month" || sku.id === "dreyv.tier.max.month")) {
        const tier = sku.id === "dreyv.tier.max.month" ? "max" : "mini";
        const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await db.update(users)
            .set({ tier, tierExpiresAt: expires })
            .where(eq(users.id, key.userId));
    }

    return NextResponse.json({
        id: row.payment.id,
        status: "paid",
        tx_signature: signature,
        receipt_token: receiptToken,
        sku: sku ? { id: sku.id, name: sku.name, fulfilment: sku.fulfilmentHint } : null,
        paid_at: now,
    });
}
