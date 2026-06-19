/**
 * POST /api/x402/checkout
 *
 * Agent-facing checkout. Authenticates with `Authorization: Bearer dak_…`
 * (created at /app/settings/agent-keys). Body: { sku, chain?, asset? }.
 *
 * On first call: returns HTTP 402 with an `x402` payment payload
 * (receiving wallet, amount, memo, expires_at). The agent settles the
 * USDC transfer on Solana, then POSTs the signature to
 *   /api/x402/checkout/{invoice}/verify
 *
 * Once verified, the agent receives a single-use receipt token it can
 * present to the fulfilment endpoint described in the SKU.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { agentPayments } from "@/db/schema";
import { extractBearer, resolveAgentKey } from "@/lib/agent/api-keys";
import { getSku } from "@/lib/agent/skus";
import { mintCryptoInvoice } from "@/lib/billing/crypto-invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
    sku: z.string().min(1).max(200),
    chain: z.enum(["solana"]).optional(),
    asset: z.enum(["usdc", "usdt"]).optional(),
});

export async function POST(req: NextRequest) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const bearer = extractBearer(req);
    const key = await resolveAgentKey(bearer);
    if (!key) {
        return NextResponse.json(
            { error: "unauthorized", message: "Provide Authorization: Bearer dak_… (create at /app/settings/agent-keys)." },
            { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv-x402"' } },
        );
    }

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const sku = getSku(parsed.data.sku);
    if (!sku) {
        return NextResponse.json({ error: "unknown_sku", message: `No such SKU: ${parsed.data.sku}` }, { status: 404 });
    }

    // Optional spend cap on the API key.
    if (key.spendLimitUsd != null && key.spentUsd + sku.priceUsd > key.spendLimitUsd) {
        return NextResponse.json(
            {
                error: "spend_limit_exceeded",
                message: `This API key's spend cap ($${key.spendLimitUsd.toFixed(2)}) would be exceeded.`,
                spentUsd: key.spentUsd,
                limitUsd: key.spendLimitUsd,
            },
            { status: 402 },
        );
    }

    const chain = parsed.data.chain ?? "solana";
    const asset = parsed.data.asset ?? "usdc";

    // Mint the underlying invoice using existing rails. We override the USD
    // amount by mapping via crypto-pricing's stable path: USDC settles 1:1 so
    // the SKU price is the on-chain amount. For non-tier SKUs we synthesize a
    // dedicated pseudo-tier by computing the minor amount ourselves.
    const isTierSku = sku.id.startsWith("dreyv.tier.");
    const tier = isTierSku ? (sku.id.includes(".max.") ? "max" : "mini") : "mini";

    const invoice = await mintCryptoInvoice({
        userId: key.userId,
        tier, // satisfies crypto_invoices.tier column; not user-facing here
        chain,
        asset,
    });

    // For non-tier SKUs the mintCryptoInvoice price won't match the SKU
    // price; reflect SKU price in agent_payments and rely on verify step
    // to check the on-chain amount actually transferred.
    const amountUsd = isTierSku ? invoice.amountUsd : sku.priceUsd;

    const [payment] = await db
        .insert(agentPayments)
        .values({
            apiKeyId: key.id,
            userId: key.userId,
            invoiceId: invoice.id,
            sku: sku.id,
            amountUsd: amountUsd.toFixed(2),
            status: "pending",
        })
        .returning({ id: agentPayments.id });

    const payload = {
        x402: {
            scheme: "solana-usdc",
            payment_required: true,
            amount: isTierSku ? invoice.amount : sku.priceUsd.toFixed(2),
            amount_usd: amountUsd,
            asset: asset.toUpperCase(),
            chain,
            receiving_address: invoice.receivingAddress,
            memo: invoice.memo,
            expires_at: invoice.expiresAt,
            solana_pay_url: invoice.solanaPayUrl,
            invoice_id: invoice.id,
            payment_id: payment.id,
            verify_url: `/api/x402/checkout/${payment.id}/verify`,
            poll_url: `/api/x402/checkout/${payment.id}`,
        },
        sku: { id: sku.id, name: sku.name, fulfilment: sku.fulfilmentHint },
    };

    return NextResponse.json(payload, {
        status: 402,
        headers: {
            "X-Payment-Required": "solana-usdc",
            "X-Payment-Address": invoice.receivingAddress,
            "X-Payment-Amount": isTierSku ? invoice.amount : sku.priceUsd.toFixed(2),
            "X-Payment-Memo": invoice.memo,
        },
    });
}
