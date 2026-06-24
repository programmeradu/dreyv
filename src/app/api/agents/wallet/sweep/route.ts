/**
 * POST /api/agents/wallet/sweep — bearer-authenticated pre-claim wallet drain.
 *
 * Auth: Authorization: Bearer dk_live_… from the agent being claimed.
 * Body: { destination_wallet } (aliases: customer_wallet, to, address)
 *
 * Moves the agent's hosted Solana wallet contents to the destination wallet,
 * removes the agent wallet DB row, then the human can retry the claim redeem.
 */

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agentWallets } from "@/db/schema";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { sweepHostedWallet } from "@/lib/agent/wallet";
import { tokenFor } from "@/lib/billing/crypto-config";
import { decryptKeypair } from "@/lib/keypair-envelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SweepBody = Partial<Record<
    "destination_wallet" | "customer_wallet" | "destinationWallet" | "customerWallet" | "to" | "address",
    unknown
>>;

function normalizeSolanaAddress(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (!raw) return null;
    try {
        return new PublicKey(raw).toBase58();
    } catch {
        return null;
    }
}

function formatTokenAmount(minor: bigint, decimals: number): string {
    const base = BigInt(10) ** BigInt(decimals);
    const whole = minor / base;
    const frac = minor % base;
    if (frac === BigInt(0)) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr}`;
}

export async function POST(req: NextRequest) {
    if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

    const key = await resolvePublicKey(extractBearer(req));
    if (!key) {
        return NextResponse.json(
            {
                error: "unauthorized",
                message: "Pass `Authorization: Bearer dk_live_…` from the agent wallet you want to sweep.",
            },
            { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv-agent-wallet"' } },
        );
    }

    if (key.keyPrefix === "oauth_jwt") {
        return NextResponse.json(
            {
                error: "unsupported_bearer",
                message: "Wallet sweeps must be authorized by the agent's dk_live_ key, not a short-lived OAuth token.",
            },
            { status: 400 },
        );
    }

    let body: SweepBody = {};
    try {
        body = (await req.json()) as SweepBody;
    } catch {
        body = {};
    }

    const destinationWallet = normalizeSolanaAddress(
        body.destination_wallet ??
        body.customer_wallet ??
        body.destinationWallet ??
        body.customerWallet ??
        body.to ??
        body.address,
    );
    if (!destinationWallet) {
        return NextResponse.json(
            {
                error: "destination_wallet_required",
                message: "Provide the customer hosted wallet as `destination_wallet` (or `customer_wallet`). Use the `customer_wallet` returned by the claim conflict response.",
            },
            { status: 400 },
        );
    }

    const [wallet] = await db
        .select()
        .from(agentWallets)
        .where(eq(agentWallets.userId, key.userId))
        .limit(1);

    if (!wallet) {
        return NextResponse.json({ ok: true, swept: false, reason: "agent_wallet_not_found" });
    }
    if (wallet.publicKey === destinationWallet) {
        return NextResponse.json(
            { error: "destination_matches_source", message: "Destination wallet must be different from the agent wallet." },
            { status: 400 },
        );
    }

    const [destinationHostedWallet] = await db
        .select({ userId: agentWallets.userId })
        .from(agentWallets)
        .where(eq(agentWallets.publicKey, destinationWallet))
        .limit(1);

    if (!destinationHostedWallet) {
        return NextResponse.json(
            {
                error: "destination_not_hosted_wallet",
                message: "For claim safety, sweeps can only land in an existing Dreyv hosted customer wallet. Use the `customer_wallet` returned by POST /api/agents/claim/redeem.",
            },
            { status: 400 },
        );
    }

    const usdc = tokenFor("solana", "usdc");
    if (!usdc?.contract) {
        return NextResponse.json({ error: "usdc_mint_unconfigured" }, { status: 500 });
    }

    let result;
    try {
        result = await sweepHostedWallet({
            sourceSecretBase58: decryptKeypair(wallet.encryptedSecret),
            destinationPublicKey: destinationWallet,
            mintAddress: usdc.contract,
            decimals: usdc.decimals,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "sweep_failed";
        const status = message.startsWith("insufficient_sol_for_sweep") ? 402 : 500;
        return NextResponse.json({ error: "sweep_failed", message }, { status });
    }

    if (result.skippedReason === "sol_below_fee") {
        return NextResponse.json(
            {
                error: "sol_below_fee",
                message: "The agent wallet only contains SOL dust below the network fee needed to move it. Top it up with a tiny SOL amount, then retry the sweep.",
                source_wallet: wallet.publicKey,
                destination_wallet: destinationWallet,
                estimated_fee_lamports: result.estimatedFeeLamports.toString(),
            },
            { status: 409 },
        );
    }

    await db.delete(agentWallets).where(eq(agentWallets.userId, key.userId));

    return NextResponse.json({
        ok: true,
        swept: Boolean(result.signature),
        source_wallet: wallet.publicKey,
        destination_wallet: destinationWallet,
        tx_signature: result.signature,
        transferred: {
            usdc_minor: result.tokenMinor.toString(),
            usdc: formatTokenAmount(result.tokenMinor, usdc.decimals),
            sol_lamports: result.solLamports.toString(),
            sol: Number(result.solLamports) / 1e9,
        },
        cleanup: {
            source_token_account_existed: result.sourceTokenAccountExisted,
            source_token_account_closed: result.sourceTokenAccountClosed,
            destination_token_account_created: result.destinationTokenAccountCreated,
            wallet_record_removed: true,
        },
        network_costs: {
            estimated_fee_lamports: result.estimatedFeeLamports.toString(),
            destination_ata_rent_lamports: result.rentReserveLamports.toString(),
        },
        notice: "Agent hosted wallet swept. Retry POST /api/agents/claim/redeem with the same claim token to finish the account claim.",
    });
}