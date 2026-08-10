/**
 * Phase 7B — Inngest functions for the tx-stream pipeline.
 *
 *   wallet.tx.observed       → process a single Helius enhanced tx (from webhook)
 *   tx-stream/cron.reconcile → nightly backfill via Helius REST + auto-subscribe vaults
 *
 * All handlers are idempotent: persistence dedupes on (wallet, signature),
 * webhook sync is computed from the union of active watches.
 */
import { inngest } from "@/lib/agents/inngest-client";
import { db } from "@/db";
import { txWatchedWallets, vaults, orgVaults } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchHeliusTransactions, type HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";
import { persistTx, persistTxsForWallet } from "./persist";
import { syncSharedWebhook } from "./helius-webhooks";
import { categorize } from "./categorize";

// ── 1) Per-tx processor (webhook → Inngest fan-out) ─────────────────
export const processWalletTx = inngest.createFunction(
    {
        id: "tx-stream-process-wallet-tx",
        name: "tx-stream: process wallet.tx.observed",
        concurrency: { limit: 5 },
        retries: 3,
    },
    { event: "wallet.tx.observed" },
    async ({ event, step, logger }) => {
        const tx = (event.data as { tx?: HeliusEnhancedTx }).tx;
        if (!tx || !tx.signature) {
            return { skipped: true, reason: "missing tx" };
        }

        // Decide which watched wallet(s) this tx belongs to. Helius webhook
        // can fire on any of accountAddresses, so we cross-reference with our
        // active watches.
        const watches = await step.run("load-watches", async () => {
            if (!db) return [] as string[];
            const rows = await db
                .select({ wallet: txWatchedWallets.walletAddress })
                .from(txWatchedWallets)
                .where(eq(txWatchedWallets.active, true));
            return rows.map((r) => r.wallet);
        });

        const involved = new Set<string>();
        for (const nt of tx.nativeTransfers ?? []) {
            if (watches.includes(nt.fromUserAccount)) involved.add(nt.fromUserAccount);
            if (watches.includes(nt.toUserAccount)) involved.add(nt.toUserAccount);
        }
        for (const tt of tx.tokenTransfers ?? []) {
            if (watches.includes(tt.fromUserAccount)) involved.add(tt.fromUserAccount);
            if (watches.includes(tt.toUserAccount)) involved.add(tt.toUserAccount);
        }
        // Fallback: feePayer if we still don't have a match.
        if (involved.size === 0) {
            const fp = (tx as { feePayer?: string }).feePayer;
            if (fp && watches.includes(fp)) involved.add(fp);
        }

        if (involved.size === 0) {
            return { skipped: true, reason: "no watched wallet matches" };
        }

        const results: Record<string, "inserted" | "duplicate" | "failed"> = {};
        for (const wallet of involved) {
            await step.run(`persist:${wallet}`, async () => {
                try {
                    const ok = await persistTx(wallet, tx, []);
                    // Note: empty rules array — single-tx path skips rules to keep
                    // hot path fast. Bulk reconciler applies rules.
                    const cat = categorize(tx, wallet, []);
                    results[wallet] = ok ? "inserted" : "duplicate";
                    logger.info("tx-stream persisted", {
                        wallet,
                        sig: tx.signature,
                        category: cat.category,
                    });
                } catch (e) {
                    results[wallet] = "failed";
                    logger.error("tx-stream persist failed", { wallet, err: (e as Error).message });
                    throw e;
                }
            });
        }
        return { signature: tx.signature, results };
    },
);

// ── 2) Nightly cron: backfill + auto-subscribe vaults ───────────────
export const reconcileTxStream = inngest.createFunction(
    {
        id: "tx-stream-cron-reconcile",
        name: "tx-stream: nightly reconcile + sync webhook",
        retries: 2,
    },
    { cron: "TZ=UTC 0 3 * * *" }, // 03:00 UTC daily
    async ({ step, logger }) => {
        if (!db) return { ok: false, reason: "db not configured" };

        // 2a) Auto-subscribe vaults + org_vaults that aren't already watched.
        const added = await step.run("auto-subscribe-vaults", async () => {
            const [vaultRows, orgRows, existing] = await Promise.all([
                db!.select({ address: vaults.address }).from(vaults),
                db!.select({ address: orgVaults.vaultAddress }).from(orgVaults),
                db!.select({ wallet: txWatchedWallets.walletAddress }).from(txWatchedWallets),
            ]);
            const existingSet = new Set(existing.map((r) => r.wallet));
            const toAdd: { address: string; source: "vault" | "org_vault" }[] = [];
            for (const v of vaultRows) if (!existingSet.has(v.address)) toAdd.push({ address: v.address, source: "vault" });
            for (const v of orgRows) if (!existingSet.has(v.address)) toAdd.push({ address: v.address, source: "org_vault" });
            if (toAdd.length === 0) return 0;
            await db!.insert(txWatchedWallets).values(
                toAdd.map((t) => ({
                    walletAddress: t.address,
                    source: t.source,
                    label: `auto:${t.source}`,
                    active: true,
                })),
            );
            return toAdd.length;
        });

        // 2b) Sync the shared Helius webhook with the union of active watches.
        const webhookId = await step.run("sync-helius-webhook", async () => {
            const rows = await db!
                .select({ wallet: txWatchedWallets.walletAddress })
                .from(txWatchedWallets)
                .where(eq(txWatchedWallets.active, true));
            const addrs = Array.from(new Set(rows.map((r) => r.wallet))).filter(Boolean);
            try {
                return await syncSharedWebhook(addrs);
            } catch (e) {
                logger.warn("syncSharedWebhook failed (skipping)", { err: (e as Error).message });
                return "";
            }
        });

        // 2c) Backfill last 24h via Helius REST per active watch (max 200 txs each).
        const watches = await step.run("load-active-watches", async () => {
            const rows = await db!
                .select()
                .from(txWatchedWallets)
                .where(eq(txWatchedWallets.active, true));
            return rows;
        });

        const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
        let totalInserted = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (const w of watches) {
            await step.run(`backfill:${w.walletAddress}`, async () => {
                let txs: HeliusEnhancedTx[] = [];
                try {
                    txs = await fetchHeliusTransactions(w.walletAddress, { sinceUnix: since, limit: 200 });
                } catch (e) {
                    logger.warn("backfill fetch failed", { wallet: w.walletAddress, err: (e as Error).message });
                    return;
                }
                if (txs.length === 0) return;
                const r = await persistTxsForWallet(w.walletAddress, txs);
                totalInserted += r.inserted;
                totalSkipped += r.skipped;
                totalFailed += r.failed;
            });
        }

        return {
            ok: true,
            autoSubscribed: added,
            webhookId,
            watches: watches.length,
            inserted: totalInserted,
            skipped: totalSkipped,
            failed: totalFailed,
        };
    },
);

export const TX_STREAM_FUNCTIONS = [processWalletTx, reconcileTxStream];
