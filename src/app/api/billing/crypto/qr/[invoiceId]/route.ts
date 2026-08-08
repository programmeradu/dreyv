/**
 * GET /api/billing/crypto/qr/[invoiceId]
 *
 * Returns a Dreyv-branded QR PNG for a pending crypto invoice. The QR encodes
 * the Solana Pay URL (or, on EVM chains, the receiving address fallback) so
 * any wallet app can scan and pre-fill the transfer.
 *
 * Public read by invoice ID — no auth required. Memo + invoice ID gate
 * confirmation on the webhook side, not here.
 */
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/db";
import { cryptoInvoices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { tokenFor, type CryptoAsset, type CryptoChain } from "@/lib/billing/crypto-config";
import { buildSolanaPayUrl } from "@/lib/billing/crypto-invoice";

export const dynamic = "force-dynamic";

const VIOLET = "#7c3aed"; // aurora-violet
const WHITE = "#ffffff";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
    const { invoiceId } = await ctx.params;
    if (!invoiceId) return NextResponse.json({ error: "invoice_id_required" }, { status: 400 });
    if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

    const [row] = await db
        .select()
        .from(cryptoInvoices)
        .where(eq(cryptoInvoices.id, invoiceId))
        .limit(1);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const chain = row.chain as CryptoChain;
    const asset = row.asset as CryptoAsset;
    const token = tokenFor(chain, asset);

    // Build the payload the QR encodes.
    // Solana → Solana Pay URL (wallets recognise it directly).
    // EVM   → ERC-681 URI (EIP-681) so wallets like MetaMask prefill transfers.
    let payload: string;
    if (chain === "solana") {
        const amountDisplay = formatAmountFromMinor(BigInt(row.amountMinor), row.decimals);
        payload = buildSolanaPayUrl({
            recipient: row.receivingAddress,
            amountDisplay,
            splToken: token?.contract ?? null,
            memo: row.memo ?? `inv-${row.id}`,
            label: "Dreyv",
            message: `Dreyv ${row.tier === "mini" ? "Mini" : "Max"} subscription`,
        });
    } else {
        // EIP-681: ethereum:<contract>@<chainId>/transfer?address=<to>&uint256=<amount>
        const chainId = EVM_CHAIN_ID[chain] ?? 1;
        if (token?.contract) {
            payload = `ethereum:${token.contract}@${chainId}/transfer?address=${row.receivingAddress}&uint256=${row.amountMinor}`;
        } else {
            payload = `ethereum:${row.receivingAddress}@${chainId}?value=${row.amountMinor}`;
        }
    }

    // Render the QR as a high-contrast, Dreyv-violet PNG buffer.
    const png = await QRCode.toBuffer(payload, {
        type: "png",
        errorCorrectionLevel: "H", // tolerant of partial occlusion (we don't overlay, but H is standard for branding)
        margin: 2,
        width: 512,
        color: { dark: VIOLET, light: WHITE },
    });

    return new NextResponse(new Uint8Array(png), {
        status: 200,
        headers: {
            "Content-Type": "image/png",
            // Invoices expire — short cache, no CDN cache.
            "Cache-Control": "private, max-age=60",
            "X-Dreyv-Invoice": row.id,
        },
    });
}

const EVM_CHAIN_ID: Record<Exclude<CryptoChain, "solana">, number> = {
    base: 8453, arbitrum: 42161, polygon: 137, bsc: 56,
};

function formatAmountFromMinor(amountMinor: bigint, decimals: number): string {
    if (decimals <= 0) return amountMinor.toString();
    const s = amountMinor.toString().padStart(decimals + 1, "0");
    const head = s.slice(0, s.length - decimals);
    const tail = s.slice(s.length - decimals).replace(/0+$/, "");
    return tail ? `${head}.${tail}` : head;
}
