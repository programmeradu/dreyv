/**
 * Treasury-wallet resolution for autonomous agent payments.
 *
 * When an agent calls POST /api/x402/pay for a snapshot/report without
 * specifying `target_wallet`, we resolve a sensible default from the
 * vaults the API-key owner has connected. If we can't pick a single
 * winner, the route returns 409 wallet_required with the candidate list
 * so the calling agent can ask the human which wallet to use.
 */
import { eq, desc } from "drizzle-orm";

import { db } from "@/db";
import { vaults } from "@/db/schema";

export interface CandidateWallet {
    address: string;
    label: string;
    kind: string; // connected | watch | multisig
    isMultisig: boolean;
}

export async function listTreasuryWallets(userId: string): Promise<CandidateWallet[]> {
    if (!db) return [];
    const rows = await db
        .select({
            address: vaults.address,
            label: vaults.label,
            kind: vaults.kind,
            isMultisig: vaults.isMultisig,
            createdAt: vaults.createdAt,
        })
        .from(vaults)
        .where(eq(vaults.userId, userId))
        .orderBy(desc(vaults.createdAt));

    return rows.map((r) => ({
        address: r.address,
        label: r.label,
        kind: r.kind,
        isMultisig: r.isMultisig,
    }));
}

/**
 * Returns a single "primary" wallet to use as the default `target_wallet`
 * for snapshot/report SKUs, or `null` if we can't unambiguously pick one
 * and the caller must clarify.
 *
 * Heuristic:
 *  - If the user has exactly one wallet → use it.
 *  - If multiple but exactly one is `kind='connected'` (their signed-in
 *    wallet) → use that.
 *  - Otherwise (0 wallets, or many ambiguous) → return null so the route
 *    returns 409 wallet_required.
 */
export async function resolvePrimaryTreasuryWallet(
    userId: string,
): Promise<{ wallet: CandidateWallet | null; candidates: CandidateWallet[] }> {
    const candidates = await listTreasuryWallets(userId);
    if (candidates.length === 0) return { wallet: null, candidates };
    if (candidates.length === 1) return { wallet: candidates[0], candidates };

    const connected = candidates.filter((c) => c.kind === "connected");
    if (connected.length === 1) return { wallet: connected[0], candidates };

    return { wallet: null, candidates };
}
