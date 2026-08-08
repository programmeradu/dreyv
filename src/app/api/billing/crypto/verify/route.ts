/**
 * POST /api/billing/crypto/verify
 * Body: { invoiceId: string, signature: string }
 *
 * Verifies the on-chain payment, marks the invoice confirmed, and advances
 * users.tier + users.tier_expires_at by ~31 days.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cryptoInvoices, users } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { verifySolanaPayment } from "@/lib/billing/crypto-verify-solana";
import { verifyEvmPayment } from "@/lib/billing/crypto-verify-evm";
import { EVM_ENABLED } from "@/lib/feature-flags";

const Body = z.object({
    invoiceId: z.string().uuid(),
    signature: z.string().min(20).max(200),
});

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const [invoice] = await db.select().from(cryptoInvoices)
        .where(and(eq(cryptoInvoices.id, parsed.data.invoiceId), eq(cryptoInvoices.userId, user.id)))
        .limit(1);
    if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

    if (invoice.status === "confirmed") {
        return NextResponse.json({ ok: true, status: "confirmed", tier: invoice.tier, alreadyConfirmed: true });
    }
    if (new Date(invoice.expiresAt).getTime() < Date.now()) {
        await db.update(cryptoInvoices).set({ status: "expired" }).where(eq(cryptoInvoices.id, invoice.id));
        return NextResponse.json({ error: "invoice_expired" }, { status: 410 });
    }

    if (invoice.chain !== "solana" && !EVM_ENABLED) {
        return NextResponse.json({ error: "evm_paused" }, { status: 410 });
    }

    const result = invoice.chain === "solana"
        ? await verifySolanaPayment({
            signature: parsed.data.signature,
            receivingAddress: invoice.receivingAddress,
            mint: invoice.contractAddress, // null for SOL
            expectedMinor: BigInt(invoice.amountMinor),
            memo: invoice.memo,
        })
        : await verifyEvmPayment({
            chain: invoice.chain as "base" | "arbitrum" | "polygon" | "bsc",
            txHash: parsed.data.signature,
            receivingAddress: invoice.receivingAddress,
            contract: invoice.contractAddress!, // EVM stables always have a contract
            expectedMinor: BigInt(invoice.amountMinor),
            memo: invoice.memo,
        });

    if (!result.ok) {
        return NextResponse.json({
            error: "verification_failed",
            reason: result.reason,
            actualMinor: result.actualMinor?.toString(),
        }, { status: 422 });
    }

    // Mark confirmed + advance tier by 31 days.
    const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await db.update(cryptoInvoices).set({
        status: "confirmed",
        txSignature: parsed.data.signature,
        confirmedAt: new Date(),
    }).where(eq(cryptoInvoices.id, invoice.id));

    await db.update(users).set({
        tier: invoice.tier,
        tierExpiresAt: expiresAt,
    }).where(eq(users.id, user.id));

    return NextResponse.json({
        ok: true,
        status: "confirmed",
        tier: invoice.tier,
        tierExpiresAt: expiresAt.toISOString(),
    });
}
