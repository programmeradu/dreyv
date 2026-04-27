/**
 * DACS Phase 7F.1 — Monthly burn statement cron.
 *
 * Runs once per month (3am UTC on the 1st) and, for every wallet that has
 * opted into automated treasury monitoring (i.e. has at least one enabled
 * `runway_autopilot_rules` row), generates a PDF treasury report for the
 * PREVIOUS month using existing infra:
 *
 *   - `buildTreasuryReportData` — pulls real txs + proposals + episodes
 *   - `renderTreasuryReportPdf` — @react-pdf/renderer
 *   - `uploadArtifact`          — Lovable Cloud storage with signed URL
 *   - `agent_episodes`          — searchable record with artifact pointer
 *
 * Honest scope:
 *   - Only opted-in wallets (no spam to non-monitoring users).
 *   - Skips wallets with zero on-chain activity for the period.
 *   - If the rule has an `alertWebhook`, posts the signed URL there.
 *   - Idempotent per (wallet, month) via dedup of `agent_episodes.commandId`.
 */

import { Inngest, type InngestHandlerArgs } from "inngest";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { runwayAutopilotRules, agentEpisodes, users, userSettings } from "@/db/schema";
import { buildTreasuryReportData } from "@/lib/agents/artifacts/build-report";
import { renderTreasuryReportPdf } from "@/lib/agents/artifacts/pdf";
import { uploadArtifact } from "@/lib/agents/artifacts/storage";
import { sendNotificationEmail } from "@/lib/email-service";

const inngest = new Inngest({ id: "dacs-monthly-burn-statement" });

/** Returns "YYYY-MM" for the month immediately before the given date (UTC). */
function previousMonth(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0..11, this month
  // previous month = m-1; if -1 → Dec of last year
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 12 : m;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

async function fireAlert(webhook: string | null, payload: Record<string, unknown>): Promise<void> {
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn("[burn-statement] webhook failed:", err instanceof Error ? err.message : err);
  }
}

export const monthlyBurnStatementCron = inngest.createFunction(
  {
    id: "dacs-monthly-burn-statement",
    name: "DACS · Monthly burn statement (PDF per opted-in wallet)",
    concurrency: { limit: 2, key: "global" },
    retries: 1,
  },
  // 03:00 UTC on the 1st of each month.
  { cron: "0 3 1 * *" },
  async ({ step, logger }: InngestHandlerArgs) => {
    if (!db) {
      logger.warn("[burn-statement] DB not initialized");
      return { skipped: true, reason: "no-db" };
    }

    const month = previousMonth();

    // Distinct wallets that opted into runway monitoring = our subscriber set.
    const subscribers = await step.run("load-subscribers", async () =>
      db!
        .selectDistinct({
          walletAddress: runwayAutopilotRules.walletAddress,
          alertWebhook: runwayAutopilotRules.alertWebhook,
        })
        .from(runwayAutopilotRules)
        .where(eq(runwayAutopilotRules.enabled, true))
        .limit(500),
    );

    if (subscribers.length === 0) {
      return { month, subscribers: 0, generated: 0 };
    }

    let generated = 0;
    let skippedEmpty = 0;
    let skippedDup = 0;
    let failed = 0;

    for (const sub of subscribers) {
      const wallet = sub.walletAddress;
      const commandId = `burn-statement:${wallet}:${month}`;

      await step.run(`statement-${wallet.slice(0, 8)}`, async () => {
        // Idempotency: skip if we already produced one for this (wallet, month).
        const dup = await db!
          .select({ id: agentEpisodes.id })
          .from(agentEpisodes)
          .where(eq(agentEpisodes.commandId, commandId))
          .limit(1);
        if (dup.length > 0) {
          skippedDup += 1;
          return;
        }

        try {
          const data = await buildTreasuryReportData({
            walletOrVault: wallet,
            month,
            userId: null,
          });

          if (data.transactions.length === 0 && data.proposals.length === 0) {
            // Nothing to report — log but do not generate a noise PDF.
            skippedEmpty += 1;
            await db!.insert(agentEpisodes).values({
              commandId,
              walletAddress: wallet,
              intentKind: "deliverable.monthly_burn_statement",
              capabilityIds: ["monthly_burn_statement"],
              outcome: "skipped",
              notes: `period=${month} reason=no-activity`,
            });
            return;
          }

          const pdf = await renderTreasuryReportPdf(data);
          const artifact = await uploadArtifact({
            body: pdf,
            filename: `dreyv-monthly-burn-${wallet.slice(0, 8)}-${month}.pdf`,
            mime: "application/pdf",
            kind: "pdf",
            ownerKey: wallet,
            folder: `monthly-burn/${month}`,
            capabilityId: "monthly_burn_statement",
            meta: { month, wallet, source: "cron" },
          });

          await db!.insert(agentEpisodes).values({
            commandId,
            walletAddress: wallet,
            intentKind: "deliverable.monthly_burn_statement",
            capabilityIds: ["monthly_burn_statement"],
            outcome: "produced",
            valueUsd: data.summary.netFlowUsd != null ? String(Math.abs(data.summary.netFlowUsd)) : null,
            notes: `period=${month} txs=${data.transactions.length} proposals=${data.proposals.length} netFlowUsd=${data.summary.netFlowUsd ?? "n/a"} | artifact=${artifact.kind}:${artifact.path}`,
          });

          await fireAlert(sub.alertWebhook, {
            type: "monthly_burn_statement",
            wallet,
            month,
            artifactPath: artifact.path,
            signedUrl: (artifact as { signedUrl?: string }).signedUrl ?? null,
            summary: data.summary,
            at: new Date().toISOString(),
          });

          generated += 1;
        } catch (err) {
          failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[burn-statement] ${wallet.slice(0, 8)} ${month} failed: ${msg}`);
          await db!.insert(agentEpisodes).values({
            commandId,
            walletAddress: wallet,
            intentKind: "deliverable.monthly_burn_statement",
            capabilityIds: ["monthly_burn_statement"],
            outcome: "failed",
            notes: `period=${month} error=${msg.slice(0, 240)}`,
          });
        }
      });
    }

    return {
      month,
      subscribers: subscribers.length,
      generated,
      skippedEmpty,
      skippedDup,
      failed,
    };
  },
);

// Avoid unused-import warning for future schema-driven aggregations.
void dsql;
void and;
