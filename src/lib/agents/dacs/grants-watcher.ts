/**
 * Phase 7B.4 — Grants watcher cron.
 *
 * Every 10 minutes, walks every `grant_milestones` row in `pending` status
 * (capped per tick) and re-verifies its proof:
 *   - GitHub PR merged → mark `ready_to_release`, store evidence, emit episode.
 *   - On-chain event observed → same.
 *   - Manual attestation → no-op (funder must call `grant_milestone_release`
 *     directly with `skipReverify: false` after attesters confirm off-chain).
 *
 * Persistent failures (rate-limit / 4xx) bump `check_attempts` and back off
 * implicitly via the 10-minute cadence. Errors stay in `last_check_error`
 * for UI surfacing.
 */
import { inngest } from "../inngest-client";
import { db } from "@/db";
import { grants, grantMilestones, agentEpisodes } from "@/db/schema";
import { and, eq, lt, or } from "drizzle-orm";
import { verifyProof, type ProofSpec } from "./grant-proof";

const PER_TICK_LIMIT = 25;
const MAX_PENDING_ATTEMPTS = 144; // ~24h at 10-min cadence before giving up

type MilestoneRow = typeof grantMilestones.$inferSelect;

export const grantsWatcher = inngest.createFunction(
  {
    id: "dacs-grants-watcher",
    name: "DACS · Grants milestone watcher",
    concurrency: { limit: 1 },
    retries: 0,
  },
  { cron: "*/10 * * * *" },
  async ({ step, logger }) => {
    if (!db) {
      logger.warn("[grants-watcher] DB not initialized, skipping");
      return { skipped: true };
    }

    const pending: MilestoneRow[] = await step.run("load-pending", async () => {
      return await db!
        .select()
        .from(grantMilestones)
        .where(eq(grantMilestones.status, "pending"))
        .limit(PER_TICK_LIMIT);
    });

    if (pending.length === 0) return { checked: 0 };

    let verified = 0;
    let stillPending = 0;
    let failed = 0;
    let manualSkipped = 0;

    for (const m of pending) {
      const proof = m.proof as unknown as ProofSpec;
      if (proof?.type === "manual_attestation") {
        manualSkipped += 1;
        continue;
      }
      const result = await step.run(`verify-${m.id}`, async () => verifyProof(proof));
      const attempts = m.checkAttempts + 1;
      if (result.verified) {
        await step.run(`mark-ready-${m.id}`, async () => {
          await db!
            .update(grantMilestones)
            .set({
              status: "ready_to_release",
              proofVerifiedAt: new Date(),
              proofEvidence: result.evidence as Record<string, unknown> | undefined,
              lastCheckedAt: new Date(),
              lastCheckError: null,
              checkAttempts: attempts,
              updatedAt: new Date(),
            })
            .where(eq(grantMilestones.id, m.id));

          // Best-effort episode log so the planner sees the milestone unlocked.
          try {
            const [grant] = await db!.select().from(grants).where(eq(grants.id, m.grantId)).limit(1);
            await db!.insert(agentEpisodes).values({
              commandId: `grant-milestone-ready-${m.id}`,
              walletAddress: grant?.funderWallet ?? null,
              intentKind: "grant_milestone",
              capabilityIds: ["grant_disbursement", "grant_milestone_release"] as unknown as Record<string, unknown>,
              outcome: "approved_executed",
              notes: `Milestone '${m.label}' verified (${proof.type}). Awaiting funder release.`,
            });
          } catch (epErr) {
            logger.warn(`[grants-watcher] episode insert failed for ${m.id}:`, epErr);
          }
        });
        verified += 1;
      } else if (attempts >= MAX_PENDING_ATTEMPTS) {
        await step.run(`fail-${m.id}`, async () => {
          await db!
            .update(grantMilestones)
            .set({
              status: "rejected",
              lastCheckedAt: new Date(),
              lastCheckError: result.error ?? "Max verification attempts reached",
              checkAttempts: attempts,
              updatedAt: new Date(),
            })
            .where(eq(grantMilestones.id, m.id));
        });
        failed += 1;
      } else {
        await step.run(`bump-${m.id}`, async () => {
          await db!
            .update(grantMilestones)
            .set({
              lastCheckedAt: new Date(),
              lastCheckError: result.error ?? null,
              checkAttempts: attempts,
              updatedAt: new Date(),
            })
            .where(eq(grantMilestones.id, m.id));
        });
        stillPending += 1;
      }
    }

    // GC very old rejected milestones to keep the table small.
    await step.run("gc-old-rejected", async () => {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      await db!
        .delete(grantMilestones)
        .where(and(eq(grantMilestones.status, "rejected"), lt(grantMilestones.createdAt, cutoff)));
    });

    return { checked: pending.length, verified, stillPending, failed, manualSkipped };
  },
);
