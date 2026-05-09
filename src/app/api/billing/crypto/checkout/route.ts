/**
 * POST /api/billing/crypto/checkout
 * Body: { tier: "mini" | "max", chain: "solana", asset: "usdc" | "usdt" | "sol" }
 *
 * Creates a pending crypto invoice and returns the payment payload the client
 * needs to build/sign the transaction (or paste a signature for verification).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { cryptoInvoices } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import {
    isEnabled,
    receivingAddressFor,
    tokenFor,
    type CryptoAsset,
    type CryptoChain,
} from "@/lib/billing/crypto-config";
import { computeAmountMinor, type CryptoTier } from "@/lib/billing/crypto-pricing";

const Body = z.object({
    tier: z.enum(["mini", "max"]),
    chain: z.enum(["solana", "base", "arbitrum", "polygon", "bsc"]),
    asset: z.enum(["usdc", "usdt", "sol"]),
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
    const tier = parsed.data.tier as CryptoTier;
    const chain = parsed.data.chain as CryptoChain;
    const asset = parsed.data.asset as CryptoAsset;

    if (!isEnabled(chain, asset)) {
        return NextResponse.json({ error: "asset_not_enabled", chain, asset }, { status: 400 });
    }
    const token = tokenFor(chain, asset);
    if (!token) return NextResponse.json({ error: "unknown_asset" }, { status: 400 });

    let pricing;
    try {
        pricing = await computeAmountMinor(tier, chain, asset);
    } catch (err) {
        return NextResponse.json({ error: "pricing_failed", message: (err as Error).message }, { status: 502 });
    }

    const memo = "DRYV-" + randomBytes(6).toString("hex").toUpperCase();
    const receiving = receivingAddressFor(chain);
    // SOL invoices expire fast (price drift); stables get a full day.
    const expiresMs = token.stable ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
    const expiresAt = new Date(Date.now() + expiresMs);

    const [row] = await db.insert(cryptoInvoices).values({
        userId: user.id,
        tier,
        chain,
        asset,
        amountMinor: pricing.amountMinor.toString(),
        amountUsd: pricing.amountUsd.toFixed(2),
        decimals: pricing.decimals,
        contractAddress: token.contract,
        receivingAddress: receiving,
        memo,
        status: "pending",
        expiresAt,
    }).returning();

    return NextResponse.json({
        ok: true,
        invoice: {
            id: row.id,
            tier,
            chain,
            asset,
            amount: pricing.amountDisplay,
            amountMinor: pricing.amountMinor.toString(),
            amountUsd: pricing.amountUsd,
            decimals: pricing.decimals,
            contract: token.contract,
            receivingAddress: receiving,
            memo,
            expiresAt: expiresAt.toISOString(),
        },
    });
}
