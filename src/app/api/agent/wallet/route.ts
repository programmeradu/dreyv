export const runtime = "edge";
/**
 * GET /api/agent/wallet
 *
 * Returns the signed-in user's hosted agent wallet — provisioning one on
 * first call. Used by the /app/settings agent-wallet panel to render the
 * funding address, QR, and live USDC/SOL balance.
 *
 * Auth: user session (SIWS / Better Auth), NOT a dak_ bearer. Agents
 * never need to read this — they just call POST /api/x402/pay.
 */
import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth-utils";
import { tokenFor, receivingAddressFor } from "@/lib/billing/crypto-config";
import { getOrCreateAgentWallet, getWalletBalances } from "@/lib/agent/wallet";
import { getAgentBalance, minorToUsd } from "@/lib/agent/balance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const usdc = tokenFor("solana", "usdc");
    if (!usdc?.contract) {
        return NextResponse.json({ error: "usdc_mint_unconfigured" }, { status: 500 });
    }

    let wallet: { publicKey: string; createdAt: Date };
    try {
        wallet = await getOrCreateAgentWallet(user.id);
    } catch (err) {
        const message = err instanceof Error ? err.message : "wallet_provision_failed";
        return NextResponse.json({ error: "wallet_provision_failed", message }, { status: 500 });
    }

    let balances: { solLamports: bigint; tokenMinor: bigint; tokenAccountExists: boolean } | null = null;
    let balanceError: string | null = null;
    try {
        balances = await getWalletBalances({
            publicKey: wallet.publicKey,
            mintAddress: usdc.contract,
        });
    } catch (err) {
        balanceError = err instanceof Error ? err.message : "rpc_failed";
    }

    let prepaid: { balance_minor: string; balance: string; currency: string; updated_at: string } | null = null;
    try {
        const b = await getAgentBalance(user.id);
        prepaid = {
            balance_minor: b.balance_minor.toString(),
            balance: minorToUsd(b.balance_minor),
            currency: b.currency,
            updated_at: b.updated_at.toISOString(),
        };
    } catch { /* non-fatal */ }

    return NextResponse.json({
        address: wallet.publicKey,
        created_at: wallet.createdAt,
        usdc: {
            mint: usdc.contract,
            decimals: usdc.decimals,
            balance_minor: balances ? balances.tokenMinor.toString() : null,
            balance: balances
                ? formatTokenAmount(balances.tokenMinor, usdc.decimals)
                : null,
            account_exists: balances?.tokenAccountExists ?? null,
        },
        sol: {
            balance_lamports: balances ? balances.solLamports.toString() : null,
            balance: balances ? Number(balances.solLamports) / 1e9 : null,
        },
        prepaid,
        receiving_wallet: receivingAddressFor("solana"),
        rpc_error: balanceError,
    });
}

function formatTokenAmount(minor: bigint, decimals: number): string {
    const base = BigInt(10) ** BigInt(decimals);
    const whole = minor / base;
    const frac = minor % base;
    if (frac === BigInt(0)) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr}`;
}
