/**
 * POST /api/billing/crypto/checkout
 * Body: { tier: "mini" | "max", chain: "solana", asset: "usdc" | "usdt" | "sol" }
 *
 * Creates a pending crypto invoice and returns the payment payload the client
 * needs to build/sign the transaction (or paste a signature for verification).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth-utils";
import { mintCryptoInvoice } from "@/lib/billing/crypto-invoice";
export const runtime = "edge";

const Body = z.object({
    tier: z.enum(["mini", "max"]),
    chain: z.enum(["solana", "base", "arbitrum", "polygon", "bsc"]),
    asset: z.enum(["usdc", "usdt", "sol"]),
});

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    try {
        const invoice = await mintCryptoInvoice({
            userId: user.id,
            tier: parsed.data.tier,
            chain: parsed.data.chain,
            asset: parsed.data.asset,
        });
        return NextResponse.json({ ok: true, invoice });
    } catch (err) {
        const message = err instanceof Error ? err.message : "checkout_failed";
        const status = /not enabled|Unknown asset|Database/.test(message) ? 400 : 502;
        return NextResponse.json({ error: "checkout_failed", message }, { status });
    }
}
