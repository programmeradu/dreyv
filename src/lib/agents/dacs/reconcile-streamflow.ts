/**
 * Phase 7B.1 — Streamflow reconciliation cron.
 *
 * Every 5 minutes, polls each `streamflow_streams` row in `pending_signature`
 * by calling `SolanaStreamClient.getOne({ id: metadataId })`:
 *
 *   - Stream account exists on-chain → mark `confirmed`, write a follow-up
 *     `agent_episodes` note (best-effort) so the planner sees a successful
 *     stream creation in this user's history.
 *   - 404/account-not-found AND row is older than 30 minutes → mark `expired`
 *     (the user almost certainly cancelled at the wallet prompt).
 *   - Any other error → bump `reconcile_attempts`; row stays `pending_signature`
 *     and gets retried next tick. After 12 attempts (~1h) we give up and
 *     mark `failed` with the last error.
 *
 * Idempotent — re-running on already-confirmed rows is a no-op.
 */
import { inngest } from "../inngest-client";
import { db } from "@/db";
import { streamflowStreams, agentEpisodes } from "@/db/schema";
import { and, eq, lt, or } from "drizzle-orm";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MAX_ATTEMPTS = 12;
const EXPIRE_AFTER_MS = 30 * 60_000;

type PendingRow = typeof streamflowStreams.$inferSelect;

async function tryGetStream(streamId: string): Promise<{ exists: boolean; error?: string }> {
  try {
    const { SolanaStreamClient, ICluster } = await import("@streamflow/stream");
    const client = new SolanaStreamClient(RPC, ICluster.Mainnet, "confirmed");
    const stream = await client.getOne({ id: streamId });
    return { exists: !!stream };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/account.*does not exist|not found|404/i.test(msg)) {
      return { exists: false };
    }
    return { exists: false, error: msg };
  }
}

export const reconcileStreamflowStreams = inngest.createFunction(
  {
    id: "dacs-reconcile-streamflow-streams",
    name: "DACS · Streamflow stream reconciliation",
    concurrency: { limit: 1 },
    retries: 0,
  },
  { cron: "*/5 * * * *" },
  async ({ step, logger }) => {
    if (!db) {
      logger.warn("[reconcile-streamflow] DB not initialized, skipping");
      return { skipped: true };
    }

    const pending: PendingRow[] = await step.run("load-pending", async () => {
      return await db!
        .select()
        .from(streamflowStreams)
        .where(eq(streamflowStreams.status, "pending_signature"))
        .limit(50);
    });

    if (pending.length === 0) {
      return { checked: 0 };
    }

    const now = Date.now();
    let confirmed = 0;
    let expired = 0;
    let failed = 0;
    let stillPending = 0;

    for (const row of pending) {
      const ageMs = now - new Date(row.createdAt).getTime();
      const result = await step.run(`check-${row.streamId}`, async () => tryGetStream(row.streamId));

      if (result.exists) {
        await step.run(`confirm-${row.streamId}`, async () => {
          await db!
            .update(streamflowStreams)
            .set({
              status: "confirmed",
              reconciledAt: new Date(),
              reconcileAttempts: row.reconcileAttempts + 1,
              lastReconcileError: null,
              updatedAt: new Date(),
            })
            .where(eq(streamflowStreams.id, row.id));

          try {
            await db!.insert(agentEpisodes).values({
              commandId: row.commandId ?? `streamflow-reconcile-${row.id}`,
              walletAddress: row.walletAddress,
              intentKind: "schedule_payment",
              capabilityIds: ["recurring_payment"] as unknown as Record<string, unknown>,
              outcome: "approved_executed",
              signature: row.signature,
              notes: `Reconciled streamflow stream ${row.streamId} (${row.totalAmount} ${row.tokenSymbol} → ${row.recipient.slice(0, 8)}…)`,
            });
          } catch (epErr) {
            logger.warn(`[reconcile-streamflow] episode insert failed for ${row.streamId}:`, epErr);
          }
        });
        confirmed += 1;
        continue;
      }

      const attempts = row.reconcileAttempts + 1;
      if (ageMs > EXPIRE_AFTER_MS) {
        await step.run(`expire-${row.streamId}`, async () => {
          await db!
            .update(streamflowStreams)
            .set({
              status: "expired",
              reconciledAt: new Date(),
              reconcileAttempts: attempts,
              lastReconcileError: result.error ?? "Stream not found on-chain after 30 minutes",
              updatedAt: new Date(),
            })
            .where(eq(streamflowStreams.id, row.id));
        });
        expired += 1;
      } else if (attempts >= MAX_ATTEMPTS) {
        await step.run(`fail-${row.streamId}`, async () => {
          await db!
            .update(streamflowStreams)
            .set({
              status: "failed",
              reconciledAt: new Date(),
              reconcileAttempts: attempts,
              lastReconcileError: result.error ?? "Max reconcile attempts reached",
              updatedAt: new Date(),
            })
            .where(eq(streamflowStreams.id, row.id));
        });
        failed += 1;
      } else {
        await step.run(`bump-${row.streamId}`, async () => {
          await db!
            .update(streamflowStreams)
            .set({
              reconcileAttempts: attempts,
              lastReconcileError: result.error ?? null,
              updatedAt: new Date(),
            })
            .where(eq(streamflowStreams.id, row.id));
        });
        stillPending += 1;
      }
    }

    // GC very old terminal rows so the table stays small.
    await step.run("gc-old-rows", async () => {
      const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
      await db!
        .delete(streamflowStreams)
        .where(
          and(
            or(
              eq(streamflowStreams.status, "expired"),
              eq(streamflowStreams.status, "failed"),
            ),
            lt(streamflowStreams.createdAt, cutoff),
          ),
        );
    });

    return { checked: pending.length, confirmed, expired, failed, stillPending };
  },
);
