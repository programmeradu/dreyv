/**
 * Phase 7B — Persist categorized txs into Neon `tx_events`.
 *
 * Idempotent on (walletAddress, signature). Loads user rules once per
 * owner wallet, applies categorization, upserts. Bumps the matched rule's
 * `hits`/`lastMatchedAt` counters for observability.
 */
import { db } from "@/db";
import { txEvents, txCategoryRules, txWatchedWallets } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";
import { categorize, type CategoryRule } from "./categorize";

export interface PersistResult {
    inserted: number;
    skipped: number;
    failed: number;
}

async function loadRules(ownerWallet: string | null): Promise<CategoryRule[]> {
    if (!db || !ownerWallet) return [];
    const rows = await db
        .select()
        .from(txCategoryRules)
        .where(and(eq(txCategoryRules.ownerWallet, ownerWallet), eq(txCategoryRules.enabled, true)));
    return rows.map((r) => ({
        id: r.id,
        priority: r.priority,
        enabled: r.enabled,
        matchProgramId: r.matchProgramId,
        matchSource: r.matchSource,
        matchCounterparty: r.matchCounterparty,
        matchTokenMint: r.matchTokenMint,
        matchMemoContains: r.matchMemoContains,
        matchMinAmount: r.matchMinAmount,
        matchMaxAmount: r.matchMaxAmount,
        matchDirection: r.matchDirection,
        category: r.category,
        tags: r.tags,
    }));
}

/**
 * Persist a single Helius enhanced tx for a watched wallet.
 * Returns true if inserted, false if a row already existed.
 */
export async function persistTx(
    walletAddress: string,
    tx: HeliusEnhancedTx,
    rules: CategoryRule[],
): Promise<boolean> {
    if (!db) throw new Error("db not configured");
    const cat = categorize(tx, walletAddress, rules);

    // ON CONFLICT DO NOTHING via raw insert (drizzle's onConflict needs a unique
    // constraint; our schema uses an index, so we wrap in try/catch).
    try {
        await db.insert(txEvents).values({
            walletAddress,
            signature: cat.signature,
            slot: cat.slot,
            blockTime: cat.blockTime,
            feeLamports: cat.feeLamports,
            source: cat.source,
            type: cat.type,
            direction: cat.direction,
            counterparty: cat.counterparty,
            tokenMint: cat.tokenMint,
            tokenSymbol: cat.tokenSymbol,
            amount: cat.amount.toString(),
            amountLamports: cat.amountLamports,
            valueUsd: null,
            category: cat.category,
            categorySource: cat.categorySource,
            matchedRuleId: cat.matchedRuleId,
            tags: cat.tags,
            raw: tx as unknown as object,
        });
    } catch (e) {
        const msg = (e as Error).message || "";
        if (/duplicate|unique/i.test(msg)) return false;
        throw e;
    }

    if (cat.matchedRuleId) {
        await db
            .update(txCategoryRules)
            .set({ hits: sql`${txCategoryRules.hits} + 1`, lastMatchedAt: new Date() })
            .where(eq(txCategoryRules.id, cat.matchedRuleId))
            .catch(() => {});
    }
    return true;
}

/**
 * Bulk persist for a single wallet — loads rules once.
 */
export async function persistTxsForWallet(
    walletAddress: string,
    txs: HeliusEnhancedTx[],
): Promise<PersistResult> {
    if (!db) throw new Error("db not configured");
    const [watch] = await db
        .select({ ownerWallet: txWatchedWallets.ownerWallet })
        .from(txWatchedWallets)
        .where(eq(txWatchedWallets.walletAddress, walletAddress))
        .limit(1);

    const rules = await loadRules(watch?.ownerWallet ?? null);

    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    for (const tx of txs) {
        try {
            const ok = await persistTx(walletAddress, tx, rules);
            if (ok) inserted += 1;
            else skipped += 1;
        } catch {
            failed += 1;
        }
    }

    // Update sync watermark (latest signature first).
    const latest = txs[0];
    if (latest) {
        await db
            .update(txWatchedWallets)
            .set({ lastSyncedSignature: latest.signature, lastSyncedAt: new Date() })
            .where(eq(txWatchedWallets.walletAddress, walletAddress))
            .catch(() => {});
    }

    return { inserted, skipped, failed };
}
