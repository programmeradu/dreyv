/**
 * tx-reconciler — server-side sweeper for `submitted` tx proposals.
 *
 * The inbox client polls `getSignatureStatuses` after approval, but if the
 * tab closes mid-poll we'd strand the row in `submitted` forever. This
 * runs on a cron, re-checks every `submitted` row's signature, and flips
 * it to `confirmed` or `failed` based on on-chain truth.
 *
 * Only Solana for now (chain === "solana"); EVM tx reconciliation will
 * land in a separate module when we wire EVM signers.
 */
import { Connection } from "@solana/web3.js";
import { listQueuedTxProposals, updateTxProposalStatus } from "./storage";
import { pollConfirmation } from "@/lib/solana/poll-confirmation";

const SOLANA_RPC =
  process.env.SOLANA_RPC ||
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  process.env.HELIUS_RPC ||
  process.env.NEXT_PUBLIC_HELIUS_RPC ||
  "https://api.mainnet-beta.solana.com";

// Don't reconcile freshly-submitted rows — give the client poller a head start.
const MIN_AGE_MS = 30_000;
// Don't sit on a stuck row forever; after this we mark `failed: stuck`.
const STUCK_AFTER_MS = 30 * 60_000;

export interface ReconcileSummary {
  scanned: number;
  confirmed: number;
  failed: number;
  skipped: number;
}

export async function reconcileSubmittedTxProposals(
  limit = 100,
): Promise<ReconcileSummary> {
  const rows = await listQueuedTxProposals(limit, { status: "submitted" });
  const summary: ReconcileSummary = { scanned: rows.length, confirmed: 0, failed: 0, skipped: 0 };
  if (!rows.length) return summary;

  const conn = new Connection(SOLANA_RPC, "confirmed");

  for (const r of rows) {
    const row = r as unknown as {
      id: string;
      chain: string;
      signature: string | null;
      submittedAt: Date | null;
      createdAt: Date;
    };

    // Only Solana for now
    if (row.chain && row.chain !== "solana") {
      summary.skipped++;
      continue;
    }
    if (!row.signature) {
      summary.skipped++;
      continue;
    }

    const submittedAt = row.submittedAt ?? row.createdAt;
    const ageMs = Date.now() - new Date(submittedAt).getTime();
    if (ageMs < MIN_AGE_MS) {
      summary.skipped++;
      continue;
    }

    try {
      // Single-shot status check with light retry — we're the safety net,
      // not the primary poller, so a 6s budget is enough.
      const verdict = await pollConfirmation(conn, row.signature, {
        maxWaitMs: 6_000,
        intervalMs: 2_000,
      });

      if (verdict.confirmed) {
        await updateTxProposalStatus(row.id, { status: "confirmed", signature: row.signature });
        summary.confirmed++;
      } else if (verdict.error && verdict.error !== "timeout") {
        await updateTxProposalStatus(row.id, {
          status: "failed",
          signature: row.signature,
          errorMessage: `reconcile: ${verdict.error}`.slice(0, 400),
        });
        summary.failed++;
      } else if (ageMs > STUCK_AFTER_MS) {
        await updateTxProposalStatus(row.id, {
          status: "failed",
          signature: row.signature,
          errorMessage: "reconcile: stuck (no on-chain status)",
        });
        summary.failed++;
      } else {
        summary.skipped++;
      }
    } catch (e) {
      console.warn("[brains:reconciler]", row.id, (e as Error).message);
      summary.skipped++;
    }
  }

  return summary;
}
