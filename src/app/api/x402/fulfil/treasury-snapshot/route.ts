/**
 * GET /api/x402/fulfil/treasury-snapshot?wallet=<addr>
 *
 * SKU: dreyv.treasury.snapshot ($0.10)
 *
 * Auth: `Authorization: Bearer rcpt_…` (single-use receipt minted by
 *       /api/x402/pay or /api/x402/checkout/[id] after settlement).
 *
 * Returns the current portfolio value, holdings, and a 24h price delta
 * for the requested Solana wallet. Live on-chain data via Helius DAS.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildLiveVaultSnapshot } from "@/lib/benchmark/vault-live";
import {
    extractReceiptToken,
    receiptErrorStatus,
    redeemReceipt,
} from "@/lib/agent/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: NextRequest) {
    const token = extractReceiptToken(req);
    if (!token) {
        return NextResponse.json(
            { error: "missing_receipt", hint: "Authorization: Bearer rcpt_…" },
            { status: 401 },
        );
    }

    const wallet = req.nextUrl.searchParams.get("wallet")?.trim();
    if (!wallet || !SOLANA_ADDR_RE.test(wallet)) {
        return NextResponse.json(
            { error: "invalid_wallet", hint: "?wallet=<solana_address>" },
            { status: 400 },
        );
    }

    const redeem = await redeemReceipt(token, "dreyv.treasury.snapshot");
    if (!redeem.ok) {
        return NextResponse.json(
            { error: redeem.error },
            { status: receiptErrorStatus(redeem.error!) },
        );
    }

    try {
        const snap = await buildLiveVaultSnapshot(wallet);
        return NextResponse.json({
            sku: "dreyv.treasury.snapshot",
            wallet,
            as_of: snap.asOf,
            total_usd: snap.totalUsd,
            sol_balance: snap.solBalance,
            fungible_count: snap.fungibleCount,
            nft_count: snap.nftCount,
            holdings: snap.holdings.map((h) => ({
                symbol: h.symbol,
                mint: h.mint,
                amount: h.amount,
                price_usd: h.priceUsd,
                usd: h.usd,
            })),
            source: snap.source,
            warning: snap.warning ?? null,
            receipt: { id: redeem.receipt!.payment.id, consumed: true },
        });
    } catch (e) {
        return NextResponse.json(
            { error: "fulfilment_failed", detail: e instanceof Error ? e.message : "unknown" },
            { status: 500 },
        );
    }
}
