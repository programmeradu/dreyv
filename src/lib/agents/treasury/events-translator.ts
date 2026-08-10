/**
 * Phase 14 / Block B Step 2 — `tx_events` → `treasury_events` translator.
 *
 * Listens to the same `wallet.tx.observed` event the persist pipeline does,
 * computes a USD-attributed treasury impact, and writes it to the
 * `treasury_events` append-only stream that powers `/app/analytics`
 * attribution + the Foresight burn/inflow priors.
 *
 * Categorization uses the same rules as `tx_events` (so attribution stays
 * consistent), but maps to a smaller `kind` vocabulary that the Foresight
 * engine understands: inflow | outflow | yield | fee | swap | rebalance |
 * airdrop | unknown.
 *
 * Idempotent on (wallet_address, signature) via the unique partial index
 * defined in 0006_foresight_foundation.sql.
 */

import { inngest } from "../inngest-client";
import { db } from "@/db";
import { treasuryEvents } from "@/db/schema";
import { categorize } from "@/lib/agents/tx-stream/categorize";
import type { HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";
import { txWatchedWallets } from "@/db/schema";
import { eq } from "drizzle-orm";

const STABLES = new Set([
  "USDC", "USDT", "DAI", "BUSD", "TUSD", "USDP", "FRAX", "LUSD", "PYUSD",
  "GUSD", "USDD", "CUSD", "SUSD", "EURC",
]);

type TreasuryKind =
  | "inflow"
  | "outflow"
  | "yield"
  | "fee"
  | "swap"
  | "rebalance"
  | "airdrop"
  | "unknown";

function mapCategoryToKind(category: string): TreasuryKind {
  switch (category) {
    case "transfer-in":
      return "inflow";
    case "transfer-out":
      return "outflow";
    case "payroll":
      return "outflow";
    case "yield":
      return "yield";
    case "fee":
      return "fee";
    case "swap":
      return "swap";
    case "stake":
      return "rebalance";
    case "mev":
      return "fee";
    case "airdrop":
      return "airdrop";
    case "internal":
    case "uncategorized":
    default:
      return "unknown";
  }
}

function signedUsdImpact(
  kind: TreasuryKind,
  rawUsd: number | null,
): number | null {
  if (rawUsd == null || !Number.isFinite(rawUsd)) return null;
  const mag = Math.abs(rawUsd);
  switch (kind) {
    case "inflow":
    case "yield":
    case "airdrop":
      return mag;
    case "outflow":
    case "fee":
      return -mag;
    case "swap":
    case "rebalance":
      // Net-zero in expectation; we still log them with 0 so the events
      // stream stays auditable. Foresight ignores 0-amount events.
      return 0;
    default:
      return null;
  }
}

/**
 * Best-effort USD value extraction from Helius enhanced tx.
 *  - SOL transfers: native lamports * (priceUsd injected by upstream classifier)
 *  - Token transfers: tokenTransfers[].tokenAmount * tokenPrice (when present)
 *  - Falls back to `tx.amountUsd` if the upstream classifier already attached one.
 */
function extractUsd(tx: HeliusEnhancedTx, watchedWallet: string): number | null {
  const fromUpstream = (tx as any)?.amountUsd;
  if (typeof fromUpstream === "number" && Number.isFinite(fromUpstream)) {
    return fromUpstream;
  }

  // Sum signed token transfers involving the watched wallet
  let netToken = 0;
  let touched = false;
  for (const tt of tx.tokenTransfers ?? []) {
    const amt = Number(tt.tokenAmount ?? 0);
    const symbol = String((tt as any).symbol ?? "").toUpperCase();
    const usd = STABLES.has(symbol) ? amt : 0; // Only stables priced inline; rest gets reconciled later.
    if (!Number.isFinite(amt) || !Number.isFinite(usd)) continue;
    if (tt.toUserAccount === watchedWallet) {
      netToken += usd;
      touched = true;
    } else if (tt.fromUserAccount === watchedWallet) {
      netToken -= usd;
      touched = true;
    }
  }
  if (touched) return netToken;
  return null;
}

// ─── Inngest function ─────────────────────────────────────────────────

export const translateTxToTreasuryEvent = inngest.createFunction(
  {
    id: "treasury-events-translator",
    name: "Treasury · tx_events → treasury_events translator",
    concurrency: { limit: 5 },
    retries: 2,
  },
  { event: "wallet.tx.observed" },
  async ({ event, step, logger }) => {
    if (!db) return { skipped: "no-db" };

    const tx = (event.data as { tx?: HeliusEnhancedTx }).tx;
    if (!tx?.signature) return { skipped: "no-signature" };

    // Identify which watched wallet this tx affects (mirrors persist pipeline).
    const watches = await step.run("load-watches", async () => {
      const rows = await db!
        .select({ wallet: txWatchedWallets.walletAddress })
        .from(txWatchedWallets)
        .where(eq(txWatchedWallets.active, true));
      return new Set(rows.map((r) => r.wallet));
    });

    const involved = new Set<string>();
    for (const nt of tx.nativeTransfers ?? []) {
      if (watches.has(nt.fromUserAccount)) involved.add(nt.fromUserAccount);
      if (watches.has(nt.toUserAccount)) involved.add(nt.toUserAccount);
    }
    for (const tt of tx.tokenTransfers ?? []) {
      if (watches.has(tt.fromUserAccount)) involved.add(tt.fromUserAccount);
      if (watches.has(tt.toUserAccount)) involved.add(tt.toUserAccount);
    }
    if (involved.size === 0) {
      const fp = (tx as { feePayer?: string }).feePayer;
      if (fp && watches.has(fp)) involved.add(fp);
    }
    if (involved.size === 0) return { skipped: "no-watched-wallet" };

    const results: Record<string, "inserted" | "duplicate" | "no-usd" | "failed"> = {};

    for (const wallet of involved) {
      await step.run(`translate:${wallet}`, async () => {
        try {
          const cat = categorize(tx, wallet, []);
          const kind = mapCategoryToKind(cat.category);
          const rawUsd = extractUsd(tx, wallet);
          const signedUsd = signedUsdImpact(kind, rawUsd);

          if (signedUsd == null) {
            results[wallet] = "no-usd";
            return;
          }

          const userId = await resolveUserIdFromWallet(wallet).catch(() => null);
          const occurredAt = tx.timestamp
            ? new Date(tx.timestamp * 1000)
            : new Date();

          // Use a single primary token symbol for downstream filtering.
          const primaryToken =
            (tx.tokenTransfers ?? [])[0]?.mint ??
            cat.tokenMint ??
            null;
          const primarySymbol =
            ((tx.tokenTransfers ?? [])[0] as any)?.symbol ??
            cat.tokenSymbol ??
            null;

          await db!.insert(treasuryEvents).values({
            userId: userId ?? null,
            walletAddress: wallet,
            vaultAddress: null,
            occurredAt,
            kind,
            category: cat.category,
            amountUsd: signedUsd.toFixed(6),
            tokenSymbol: primarySymbol ?? null,
            tokenMint: primaryToken ?? null,
            counterparty: cat.counterparty ?? null,
            signature: tx.signature,
            source: "derived",
            metadata: {
              feeLamports: cat.feeLamports ?? null,
              tags: cat.tags,
              categorySource: cat.categorySource,
            },
          });
          results[wallet] = "inserted";
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (msg.includes("duplicate key") || msg.includes("treasury_events_sig_uniq")) {
            results[wallet] = "duplicate";
            return;
          }
          results[wallet] = "failed";
          logger?.warn?.(`[treasury-events] translate failed for ${wallet}`, e);
          throw e;
        }
      });
    }

    return { signature: tx.signature, results };
  },
);
