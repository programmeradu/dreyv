/**
 * POST /api/x402/checkout
 *
 * Agent-facing checkout. Authenticates with `Authorization: Bearer dak_…`
 * (created at /app/settings/agent-keys). Body: { sku, rail?, chain?, asset? }.
 *
 * Default behaviour: returns HTTP 402 with a Solana/USDC `x402` payload PLUS
 * an `alternatives` block listing any card rails (Stripe, Paystack) that are
 * available for this SKU. The agent picks one and either:
 *   - settles USDC on-chain → POSTs the signature to
 *     /api/x402/checkout/{payment_id}/verify
 *   - opens the hosted card checkout URL → provider webhook mints the
 *     receipt → agent polls /api/x402/checkout/{payment_id} until `paid`.
 *
 * Pass `rail: "stripe" | "paystack" | "solana"` to receive only that rail.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { agentPayments, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractBearer, resolveAgentKey } from "@/lib/agent/api-keys";
import { getSku } from "@/lib/agent/skus";
import { mintCryptoInvoice } from "@/lib/billing/crypto-invoice";
import {
    CARD_RAIL_MIN_USD,
    createPaystackRail,
    createStripeRail,
    paystackIsAvailable,
    stripeIsAvailable,
} from "@/lib/agent/rails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
    sku: z.string().min(1).max(200),
    rail: z.enum(["solana", "stripe", "paystack"]).optional(),
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

    const requestedRail = parsed.data.rail;
    const cardEligible = sku.priceUsd >= CARD_RAIL_MIN_USD;

    // Resolve billing email up-front; required for card rails.
    let billingEmail: string | null = null;
    {
        const [row] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, key.userId))
            .limit(1);
        billingEmail = (row?.email || "").trim() || null;
    }

    // ─── Card-only rail (caller explicitly asked) ──────────────────────
    if (requestedRail === "stripe" || requestedRail === "paystack") {
        if (!cardEligible) {
            return NextResponse.json(
                {
                    error: "rail_unavailable",
                    rail: requestedRail,
                    message: `SKU price $${sku.priceUsd.toFixed(2)} is below the $${CARD_RAIL_MIN_USD.toFixed(2)} minimum for card rails. Use rail="solana" for micro-payments.`,
                },
                { status: 422 },
            );
        }
        if (!billingEmail) {
            return NextResponse.json(
                {
                    error: "missing_email",
                    message: "Card rails require a billing email on the key owner's account. Add one in Settings → Profile, then retry.",
                },
                { status: 422 },
            );
        }
        if (requestedRail === "stripe" && !stripeIsAvailable()) {
            return NextResponse.json({ error: "rail_unavailable", rail: "stripe", message: "Stripe is not configured on this deployment." }, { status: 503 });
        }
        if (requestedRail === "paystack" && !paystackIsAvailable()) {
            return NextResponse.json({ error: "rail_unavailable", rail: "paystack", message: "Paystack is not configured on this deployment." }, { status: 503 });
        }

        const [payment] = await db
            .insert(agentPayments)
            .values({
                apiKeyId: key.id,
                userId: key.userId,
                sku: sku.id,
                amountUsd: sku.priceUsd.toFixed(2),
                status: "pending",
                rail: requestedRail,
            })
            .returning({ id: agentPayments.id });

        try {
            const handoff =
                requestedRail === "stripe"
                    ? await createStripeRail({ sku, billingEmail, userId: key.userId, paymentId: payment.id, headers: req.headers })
                    : await createPaystackRail({ sku, billingEmail, userId: key.userId, paymentId: payment.id, headers: req.headers });

            await db.update(agentPayments)
                .set({ providerRef: handoff.providerRef, checkoutUrl: handoff.checkoutUrl })
                .where(eq(agentPayments.id, payment.id));

            return NextResponse.json(
                {
                    x402: {
                        scheme: `card-${requestedRail}`,
                        payment_required: true,
                        amount_usd: sku.priceUsd,
                        rail: requestedRail,
                        checkout_url: handoff.checkoutUrl,
                        provider_ref: handoff.providerRef,
                        expires_at: handoff.expiresAt,
                        payment_id: payment.id,
                        poll_url: `/api/x402/checkout/${payment.id}`,
                    },
                    sku: { id: sku.id, name: sku.name, fulfilment: sku.fulfilmentHint },
                },
                {
                    status: 402,
                    headers: {
                        "X-Payment-Required": `card-${requestedRail}`,
                        "X-Payment-Amount": sku.priceUsd.toFixed(2),
                        "X-Payment-Checkout-Url": handoff.checkoutUrl,
                    },
                },
            );
        } catch (error) {
            await db.update(agentPayments).set({ status: "failed" }).where(eq(agentPayments.id, payment.id));
            const message = error instanceof Error ? error.message : "card rail failed";
            return NextResponse.json({ error: "rail_failed", rail: requestedRail, message }, { status: 502 });
        }
    }

    // ─── Default: Solana primary + card alternatives ───────────────────
    const chain = parsed.data.chain ?? "solana";
    const asset = parsed.data.asset ?? "usdc";

    const isTierSku = sku.id.startsWith("dreyv.tier.");
    const tier = isTierSku ? (sku.id.includes(".max.") ? "max" : "mini") : "mini";

    const invoice = await mintCryptoInvoice({
        userId: key.userId,
        tier,
        chain,
        asset,
        // Per-call SKUs must price the on-chain transfer at the SKU's own USD
        // amount — not the tier's $44.10/$179.10 subscription price. Otherwise
        // the Solana Pay URL asks the wallet for the wrong amount.
        amountUsdOverride: isTierSku ? undefined : sku.priceUsd,
        message: isTierSku
            ? `Dreyv ${tier === "mini" ? "Mini" : "Max"} subscription`
            : `Dreyv · ${sku.name}`,
    });

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
            rail: "solana",
        })
        .returning({ id: agentPayments.id });

    // Best-effort card alternatives. Failures here MUST NOT break the primary
    // 402 response — Solana is always shippable.
    const alternatives: Record<string, unknown> = {};
    if (cardEligible && billingEmail) {
        const attempts: Array<Promise<void>> = [];

        if (stripeIsAvailable()) {
            attempts.push((async () => {
                try {
                    const [altRow] = await db
                        .insert(agentPayments)
                        .values({
                            apiKeyId: key.id,
                            userId: key.userId,
                            sku: sku.id,
                            amountUsd: sku.priceUsd.toFixed(2),
                            status: "pending",
                            rail: "stripe",
                        })
                        .returning({ id: agentPayments.id });
                    const handoff = await createStripeRail({ sku, billingEmail: billingEmail!, userId: key.userId, paymentId: altRow.id, headers: req.headers });
                    await db.update(agentPayments)
                        .set({ providerRef: handoff.providerRef, checkoutUrl: handoff.checkoutUrl })
                        .where(eq(agentPayments.id, altRow.id));
                    alternatives.stripe = {
                        rail: "stripe",
                        amount_usd: sku.priceUsd,
                        checkout_url: handoff.checkoutUrl,
                        provider_ref: handoff.providerRef,
                        expires_at: handoff.expiresAt,
                        payment_id: altRow.id,
                        poll_url: `/api/x402/checkout/${altRow.id}`,
                    };
                } catch (err) {
                    console.warn("[x402] stripe alt failed:", err);
                }
            })());
        }

        if (paystackIsAvailable()) {
            attempts.push((async () => {
                try {
                    const [altRow] = await db
                        .insert(agentPayments)
                        .values({
                            apiKeyId: key.id,
                            userId: key.userId,
                            sku: sku.id,
                            amountUsd: sku.priceUsd.toFixed(2),
                            status: "pending",
                            rail: "paystack",
                        })
                        .returning({ id: agentPayments.id });
                    const handoff = await createPaystackRail({ sku, billingEmail: billingEmail!, userId: key.userId, paymentId: altRow.id, headers: req.headers });
                    await db.update(agentPayments)
                        .set({ providerRef: handoff.providerRef, checkoutUrl: handoff.checkoutUrl })
                        .where(eq(agentPayments.id, altRow.id));
                    alternatives.paystack = {
                        rail: "paystack",
                        amount_usd: sku.priceUsd,
                        checkout_url: handoff.checkoutUrl,
                        provider_ref: handoff.providerRef,
                        payment_id: altRow.id,
                        poll_url: `/api/x402/checkout/${altRow.id}`,
                    };
                } catch (err) {
                    console.warn("[x402] paystack alt failed:", err);
                }
            })());
        }

        await Promise.all(attempts);
    }

    const payload = {
        x402: {
            scheme: "solana-usdc",
            payment_required: true,
            amount: isTierSku ? invoice.amount : sku.priceUsd.toFixed(2),
            amount_usd: amountUsd,
            asset: asset.toUpperCase(),
            chain,
            rail: "solana",
            receiving_address: invoice.receivingAddress,
            memo: invoice.memo,
            expires_at: invoice.expiresAt,
            solana_pay_url: invoice.solanaPayUrl,
            invoice_id: invoice.id,
            payment_id: payment.id,
            verify_url: `/api/x402/checkout/${payment.id}/verify`,
            poll_url: `/api/x402/checkout/${payment.id}`,
        },
        alternatives: Object.keys(alternatives).length ? alternatives : undefined,
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
