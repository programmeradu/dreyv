/**
 * Phase 2 — Inflow → Yield autopilot.
 *
 * Cron: every 5 minutes. For each user vault with an active signer + policy
 * `min_idle_usd`, if idle USDC > threshold, plan a `yield_deposit` to the
 * top route and submit through DACS. Idempotent per (vault, slot bucket).
 */
import { inngest } from "../inngest-client";
import { db } from "@/db";
import {
  vaults,
  userAgentPolicy,
  agentSigners,
  agentAutopilotRuns,
  agentCircuitBreaker,
} from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { publish } from "../bus";

const JOB_ID = "inflow_yield";
const SLOT_BUCKET_MS = 5 * 60 * 1000;

export const inflowYieldAutopilot = inngest.createFunction(
  { id: "autopilot-inflow-yield", retries: 1 },
  { cron: "*/5 * * * *" },
  async ({ step, logger }) => {
    if (!db) return { skipped: "no-db" };

    // 1. Find candidate vaults: have an active signer + policy.min_idle_usd set.
    const candidates = await step.run("load-candidates", async () => {
      const rows = await db!
        .select({
          vaultId: vaults.id,
          userId: vaults.userId,
          address: vaults.address,
          policyCaps: agentSigners.policyCaps,
          signerStatus: agentSigners.status,
          minIdleUsd: userAgentPolicy.minIdleUsd,
        })
        .from(vaults)
        .innerJoin(agentSigners, and(eq(agentSigners.vaultId, vaults.id), eq(agentSigners.status, "active")))
        .leftJoin(userAgentPolicy, eq(userAgentPolicy.walletAddress, vaults.address));
      return rows.filter((r) => r.minIdleUsd && Number(r.minIdleUsd) > 0);
    });

    if (!candidates.length) return { processed: 0 };

    const bucket = Math.floor(Date.now() / SLOT_BUCKET_MS);
    let executed = 0, queued = 0, skipped = 0;

    for (const c of candidates) {
      const idemKey = `${JOB_ID}:${c.vaultId}:${bucket}`;

      // 2. Idempotency check.
      const exists = await db
        .select()
        .from(agentAutopilotRuns)
        .where(eq(agentAutopilotRuns.idempotencyKey, idemKey))
        .limit(1);
      if (exists.length) { skipped++; continue; }

      // 3. Circuit breaker check.
      const br = await db
        .select()
        .from(agentCircuitBreaker)
        .where(eq(agentCircuitBreaker.userId, c.userId))
        .limit(1);
      if (br[0]?.frozenUntil && new Date(br[0].frozenUntil) > new Date()) {
        await db.insert(agentAutopilotRuns).values({
          userId: c.userId, vaultId: c.vaultId, jobId: JOB_ID, idempotencyKey: idemKey,
          status: "skipped", outcome: { reason: "circuit-breaker" },
        });
        skipped++; continue;
      }

      // 4. Submit synthetic command for "deposit idle USDC into top yield route".
      try {
        const start = Date.now();
        await publish({
          name: "agent.command.submitted",
          data: {
            commandId: `autopilot-${idemKey}`,
            walletAddress: c.address,
            text: `Autopilot: deposit any idle USDC above $${c.minIdleUsd} into the top-rated yield route within signer caps.`,
            source: "autopilot",
            promptMode: "auto",
          },
        });
        await db.insert(agentAutopilotRuns).values({
          userId: c.userId, vaultId: c.vaultId, jobId: JOB_ID, idempotencyKey: idemKey,
          status: "queued", outcome: { dispatched: true }, durationMs: Date.now() - start,
        });
        queued++;
      } catch (err: any) {
        logger.error("[inflow-yield] failed for vault", c.vaultId, err);
        await db.insert(agentAutopilotRuns).values({
          userId: c.userId, vaultId: c.vaultId, jobId: JOB_ID, idempotencyKey: idemKey,
          status: "failed", outcome: { error: String(err?.message || err) },
        });
      }
    }

    return { processed: candidates.length, executed, queued, skipped };
  },
);
