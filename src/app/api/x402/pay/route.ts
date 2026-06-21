/**
 * POST /api/x402/pay
 *
 * One-call, end-to-end autonomous agent payment + delivery.
 *
 * - For dreyv.treasury.snapshot / .report:
 *     body may pass an optional `target_wallet`. If absent we resolve a
 *     primary treasury wallet from the API-key owner's vaults; if we can't
 *     unambiguously pick one we return HTTP 409 with the candidate list so
 *     the calling agent can ask the human.
 *
 * - For dreyv.tier.mini.month / .max.month:
 *     bumps users.tier + tierExpiresAt, sends a branded activation email.
 *
 * On success, `createDeliverable` runs the SKU's fulfilment inline,
 * persists a permanent `agent_deliverables` row, and emails the API-key
 * owner. Response carries both the legacy receipt token (single-use,
 * back-compat with /fulfil) and a `deliverable` object with a permalink
 * view URL on the dashboard.
 *
 * Underfunded wallet → HTTP 402 + funding instructions, same as before.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { agentApiKeys, agentPayments, cryptoInvoices, users } from "@/db/schema";
import { resolveAgentKeyOrInternal } from "@/lib/agent/api-keys";
import { getSku } from "@/lib/agent/skus";
import { mintCryptoInvoice } from "@/lib/billing/crypto-invoice";
import {
    getOrCreateAgentWallet,
    getWalletBalances,
    MIN_SOL_LAMPORTS_FOR_TX,
    payInvoiceFromAgentWallet,
} from "@/lib/agent/wallet";
import { tokenFor } from "@/lib/billing/crypto-config";
import { createDeliverable } from "@/lib/agent/deliverables";
import { resolvePrimaryTreasuryWallet } from "@/lib/agent/wallet-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const Body = z.object({
    sku: z.string().min(1).max(200),
    target_wallet: z
        .string()
        .trim()
        .regex(SOLANA_ADDR_RE, "target_wallet must be a base58 Solana address")
        .optional(),
});

function formatToken(minor: bigint, decimals: number): string {
    const base = BigInt(10) ** BigInt(decimals);
    const whole = minor / base;
    const frac = minor % base;
    if (frac === BigInt(0)) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const key = await resolveAgentKey(extractBearer(req));
    if (!key) {
        return NextResponse.json(
            { error: "unauthorized", message: "Provide Authorization: Bearer dak_…" },
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

    // 0. Resolve `target_wallet` for snapshot/report BEFORE we charge,
    //    so an agent that doesn't pass one isn't billed for output it
    //    can't address.
    const isWalletSku = sku.id === "dreyv.treasury.snapshot" || sku.id === "dreyv.treasury.report";
    const isTierSku = sku.id.startsWith("dreyv.tier.");
    const tier: "mini" | "max" = isTierSku && sku.id.includes(".max.") ? "max" : "mini";

    let targetWallet: string | null = null;
    if (isWalletSku) {
        if (parsed.data.target_wallet) {
            targetWallet = parsed.data.target_wallet;
        } else {
            const { wallet, candidates } = await resolvePrimaryTreasuryWallet(key.userId);
            if (!wallet) {
                return NextResponse.json(
                    {
                        error: "wallet_required",
                        message: candidates.length === 0
                            ? "This account has no treasury wallet connected yet. Pass `target_wallet` explicitly, or connect a wallet in /app first."
                            : "Multiple treasury wallets connected and none is unambiguously primary. Ask the human which wallet to use, then resend with `target_wallet` set.",
                        candidates: candidates.map((c) => ({
                            address: c.address,
                            label: c.label,
                            kind: c.kind,
                            is_multisig: c.isMultisig,
                        })),
                    },
                    { status: 409 },
                );
            }
            targetWallet = wallet.address;
        }
    }

    const usdc = tokenFor("solana", "usdc");
    if (!usdc?.contract) {
        return NextResponse.json({ error: "usdc_mint_unconfigured" }, { status: 500 });
    }

    // 1. Provision (or reuse) the hosted wallet, decrypting the secret
    //    only inside this request boundary.
    let wallet: { publicKey: string; secretBase58?: string };
    try {
        wallet = await getOrCreateAgentWallet(key.userId, { withSecret: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : "wallet_provision_failed";
        return NextResponse.json({ error: "wallet_provision_failed", message }, { status: 500 });
    }
    if (!wallet.secretBase58) {
        return NextResponse.json({ error: "wallet_decrypt_failed" }, { status: 500 });
    }

    // 2. Mint the on-chain invoice (also pinned to this user).
    const invoice = await mintCryptoInvoice({
        userId: key.userId,
        tier,
        chain: "solana",
        asset: "usdc",
        amountUsdOverride: isTierSku ? undefined : sku.priceUsd,
        message: isTierSku
            ? `Dreyv ${tier === "mini" ? "Mini" : "Max"} subscription`
            : `Dreyv · ${sku.name}`,
    });
    const amountUsd = isTierSku ? invoice.amountUsd : sku.priceUsd;
    const amountMinor = BigInt(invoice.amountMinor);

    // 3. Balance check — fail fast with a 402 + funding instructions so
    //    the agent can surface a clear actionable message upstream.
    let balances;
    try {
        balances = await getWalletBalances({
            publicKey: wallet.publicKey,
            mintAddress: usdc.contract,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "rpc_failed";
        return NextResponse.json({ error: "balance_check_failed", message }, { status: 502 });
    }

    const usdcShort = balances.tokenMinor < amountMinor;
    const solShort = balances.solLamports < MIN_SOL_LAMPORTS_FOR_TX;
    if (usdcShort || solShort) {
        const needMinor = usdcShort ? amountMinor - balances.tokenMinor : BigInt(0);
        return NextResponse.json(
            {
                error: "insufficient_funds",
                message: usdcShort
                    ? `Agent wallet needs ${formatToken(needMinor, usdc.decimals)} more USDC (and a tiny SOL float for tx fees).`
                    : "Agent wallet has enough USDC but no SOL for tx fees. Send ~0.01 SOL to the agent wallet.",
                agent_wallet: wallet.publicKey,
                required: {
                    usdc: invoice.amount,
                    usdc_minor: invoice.amountMinor,
                    sol_lamports_min: MIN_SOL_LAMPORTS_FOR_TX.toString(),
                },
                balance: {
                    usdc: formatToken(balances.tokenMinor, usdc.decimals),
                    usdc_minor: balances.tokenMinor.toString(),
                    sol_lamports: balances.solLamports.toString(),
                },
                fund_with: {
                    address: wallet.publicKey,
                    usdc_mint: usdc.contract,
                    note: "Send USDC (SPL) on Solana mainnet. Include ~0.01 SOL once for tx fees.",
                    solana_pay_url: needMinor > BigInt(0)
                        ? `solana:${wallet.publicKey}?amount=${formatToken(needMinor, usdc.decimals)}&spl-token=${usdc.contract}&label=Dreyv%20Agent%20Wallet&message=Top-up%20for%20agent%20payments`
                        : `solana:${wallet.publicKey}?amount=0.01&label=Dreyv%20Agent%20Wallet&message=SOL%20float%20for%20tx%20fees`,
                },
                retry_after_funding: true,
            },
            { status: 402 },
        );
    }

    // 4. Insert the agent_payments row up-front so a tx that lands but
    //    crashes mid-settle still has a paper trail.
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

    // 5. Sign + broadcast + confirm.
    let signature: string;
    try {
        const res = await payInvoiceFromAgentWallet({
            agentSecretBase58: wallet.secretBase58,
            recipient: invoice.receivingAddress,
            mintAddress: usdc.contract,
            amountMinor,
            decimals: usdc.decimals,
            memo: invoice.memo,
        });
        signature = res.signature;
    } catch (err) {
        await db.update(agentPayments).set({ status: "failed" }).where(eq(agentPayments.id, payment.id));
        const message = err instanceof Error ? err.message : "solana_send_failed";
        console.error("[x402/pay] solana send failed:", err);
        return NextResponse.json(
            {
                error: "payment_failed",
                payment_id: payment.id,
                message,
                hint: "Retry. If this persists, fall back to POST /api/x402/checkout and settle manually.",
            },
            { status: 502 },
        );
    }

    // 6. Settle — mirrors /verify side-effects so the agent gets a
    //    receipt token in the same response.
    const receiptToken = `rcpt_${randomBytes(24).toString("base64url")}`;
    const now = new Date();

    await db.update(agentPayments)
        .set({ status: "paid", txSignature: signature, receiptToken, paidAt: now })
        .where(and(eq(agentPayments.id, payment.id), eq(agentPayments.status, "pending")));

    await db.update(cryptoInvoices)
        .set({ status: "confirmed", txSignature: signature, confirmedAt: now })
        .where(eq(cryptoInvoices.id, invoice.id));

    await db.update(agentApiKeys)
        .set({ spentUsd: sql`${agentApiKeys.spentUsd} + ${amountUsd.toFixed(4)}` })
        .where(eq(agentApiKeys.id, key.id));

    let tierExpiresAt: Date | null = null;
    if (isTierSku) {
        tierExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await db.update(users)
            .set({ tier, tierExpiresAt })
            .where(eq(users.id, key.userId));
    }

    // 7. Create the persistent deliverable + email — best-effort, never
    //    fails the response.
    let deliverableOut: {
        id: string;
        view_url: string;
        pdf_url: string | null;
        kind: string;
        summary: Record<string, unknown>;
        emailed: boolean;
    } | null = null;
    try {
        const paidAtIso = now.toISOString();
        const amountUsdcStr = formatToken(amountMinor, usdc.decimals);

        if (isWalletSku && targetWallet) {
            const d = await createDeliverable({
                paymentId: payment.id,
                userId: key.userId,
                apiKeyId: key.id,
                sku: sku.id,
                amountUsdc: amountUsdcStr,
                paidAtIso,
                kind: sku.id === "dreyv.treasury.snapshot" ? "snapshot" : "report",
                targetWallet,
            });
            deliverableOut = {
                id: d.deliverableId, view_url: d.viewUrl, pdf_url: d.pdfUrl,
                kind: d.kind, summary: d.summary, emailed: d.emailed,
            };
        } else if (isTierSku && tierExpiresAt) {
            const d = await createDeliverable({
                paymentId: payment.id,
                userId: key.userId,
                apiKeyId: key.id,
                sku: sku.id,
                amountUsdc: amountUsdcStr,
                paidAtIso,
                kind: "subscription",
                tier,
                renewalAt: tierExpiresAt,
            });
            deliverableOut = {
                id: d.deliverableId, view_url: d.viewUrl, pdf_url: d.pdfUrl,
                kind: d.kind, summary: d.summary, emailed: d.emailed,
            };
        }
    } catch (err) {
        // Already logged inside createDeliverable; do not fail the call.
        console.error("[x402/pay] deliverable creation failed:", err);
    }

    const balanceRemainingMinor = balances.tokenMinor - amountMinor;

    return NextResponse.json({
        payment_id: payment.id,
        status: "paid",
        rail: "solana",
        tx_signature: signature,
        receipt_token: receiptToken,
        amount_usd: amountUsd,
        amount_usdc: invoice.amount,
        sku: { id: sku.id, name: sku.name, fulfilment: sku.fulfilmentHint },
        agent_wallet: wallet.publicKey,
        balance_remaining: {
            usdc: formatToken(balanceRemainingMinor, usdc.decimals),
            usdc_minor: balanceRemainingMinor.toString(),
        },
        paid_at: now,
        target_wallet: targetWallet,
        deliverable: deliverableOut,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[x402/pay] unhandled:", message, stack);
    return NextResponse.json(
      {
        error: "unhandled_exception",
        message,
        where: stack?.split("\n").slice(0, 5).join(" | "),
      },
      { status: 500 },
    );
  }
}
