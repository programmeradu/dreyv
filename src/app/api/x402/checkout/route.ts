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
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import { agentApiKeys, agentPayments, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractBearer, resolveAgentKeyOrInternal, type ResolvedAgentKey } from "@/lib/agent/api-keys";
import { resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getSku } from "@/lib/agent/skus";
import { mintCryptoInvoice } from "@/lib/billing/crypto-invoice";
import { chargeAgentBalance, usdToMinor, minorToUsd } from "@/lib/agent/balance";
import {
    CARD_RAIL_MIN_USD,
    createPaystackRail,
    createStripeRail,
    paystackIsAvailable,
    stripeIsAvailable,
} from "@/lib/agent/rails";

export const dynamic = "force-dynamic";

const Body = z.object({
    sku: z.string().min(1).max(200),
    rail: z.enum(["solana", "stripe", "paystack", "balance"]).optional(),
    chain: z.enum(["solana"]).optional(),
    asset: z.enum(["usdc", "usdt"]).optional(),
});

/**
 * Get-or-create a synthetic dak_ anchor row for a public-key (dk_live_) caller,
 * so agent_payments.api_key_id FK is always satisfied.
 */
async function getOrCreatePublicKeyAnchor(userId: string): Promise<ResolvedAgentKey> {
    const syntheticHash = createHash("sha256")
        .update(`public-key-anchor:${userId}`, "utf8")
        .digest("hex");
    let [row] = await db!
        .select()
        .from(agentApiKeys)
        .where(eq(agentApiKeys.keyHash, syntheticHash))
        .limit(1);
    if (!row) {
        [row] = await db!
            .insert(agentApiKeys)
            .values({
                userId,
                label: "anchor · dk_live public key",
                keyPrefix: "dak_pubkey",
                keyHash: syntheticHash,
                scopes: "x402.pay,x402.checkout",
            })
            .returning();
    }
    return {
        id: row.id,
        userId: row.userId,
        label: row.label,
        scopes: (row.scopes ?? "x402.pay").split(",").map((s) => s.trim()).filter(Boolean),
        spendLimitUsd: row.spendLimitUsd != null ? Number(row.spendLimitUsd) : null,
        spentUsd: row.spentUsd != null ? Number(row.spentUsd) : 0,
    };
}

export async function POST(req: NextRequest) {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    // Accept either a dak_ agent payment key (full x402 flow) OR a dk_live_
    // public API key (prepaid-balance settlement only).
    let key = await resolveAgentKeyOrInternal(req);
    let viaPublicKey = false;
    if (!key) {
        const bearer = extractBearer(req);
        const pub = bearer ? await resolvePublicKey(bearer) : null;
        if (pub) {
            key = await getOrCreatePublicKeyAnchor(pub.userId);
            viaPublicKey = true;
        }
    }
    if (!key) {
        return NextResponse.json(
            { error: "unauthorized", message: "Provide Authorization: Bearer dak_… (create at /app/settings/agent-keys) or a dk_live_… key with a funded prepaid balance." },
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

    // ─── Prepaid-balance rail (dk_live_ default, or rail="balance") ────
    // If caller authenticated via a dk_live_ public key, or explicitly asked
    // for the balance rail, try to settle from the pre-funded agent balance.
    if (viaPublicKey || parsed.data.rail === "balance") {
        const amountMinor = usdToMinor(sku.priceUsd);
        const [pendingRow] = await db
            .insert(agentPayments)
            .values({
                apiKeyId: key.id,
                userId: key.userId,
                sku: sku.id,
                amountUsd: sku.priceUsd.toFixed(2),
                status: "pending",
                rail: "balance",
            })
            .returning({ id: agentPayments.id });

        const charged = await chargeAgentBalance({
            userId: key.userId,
            amountMinor,
            reason: `x402_sku:${sku.id}`,
            ref: pendingRow.id,
        });

        if (!charged.ok) {
            await db.update(agentPayments).set({ status: "failed" }).where(eq(agentPayments.id, pendingRow.id));
            // dk_live_ callers cannot fall back to on-chain settlement (no dak_).
            if (viaPublicKey) {
                return NextResponse.json(
                    {
                        error: "insufficient_balance",
                        message: `Prepaid balance ($${minorToUsd(charged.balance_minor)}) is below SKU price ($${sku.priceUsd.toFixed(2)}). Top up at /api/agents/balance/topup, then retry.`,
                        balance_usd: minorToUsd(charged.balance_minor),
                        required_usd: sku.priceUsd.toFixed(2),
                        topup_url: "/api/agents/balance/topup",
                    },
                    { status: 402 },
                );
            }
            // dak_ caller asked for balance rail explicitly — fall through to x402.
        } else {
            const receiptToken = `rcpt_${randomBytes(24).toString("base64url")}`;
            const now = new Date();
            await db
                .update(agentPayments)
                .set({ status: "paid", receiptToken, paidAt: now })
                .where(eq(agentPayments.id, pendingRow.id));
            return NextResponse.json({
                ok: true,
                payment_id: pendingRow.id,
                sku: { id: sku.id, name: sku.name, fulfilment: sku.fulfilmentHint },
                rail: "balance",
                amount_usd: sku.priceUsd,
                status: "paid",
                receipt_token: receiptToken,
                paid_at: now.toISOString(),
                balance_after_usd: minorToUsd(charged.balance_after),
                poll_url: `/api/x402/checkout/${pendingRow.id}`,
            });
        }
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
