/**
 * DACS Phase 4 — Sub-agent ticker.
 *
 * Two entry points:
 *   1. `subagentTickerCron` — runs every 2 minutes, finds sub-agents whose
 *      `next_run_at <= now`, and fires `agent.subagent.tick` for each.
 *   2. `subagentTick` — on `agent.subagent.tick`, re-submits the stored
 *      raw_text as a fresh `agent.command.submitted` event so it flows
 *      through the normal DACS pipeline (intent → plan → route → execute or
 *      HITL). This keeps the runtime composable with policy/episodes/HITL.
 */
import { randomUUID } from "node:crypto";
import { inngest } from "../inngest-client";
import { publish } from "../bus";
import { dueSubagents, getSubagent, recordTick } from "./subagent-store";

export const subagentTickerCron = inngest.createFunction(
  {
    id: "dacs-subagent-cron",
    name: "DACS · Sub-agent cron sweep",
    concurrency: { limit: 1 },
  },
  { cron: "*/2 * * * *" },
  async ({ step }) => {
    const due = await step.run("query-due", async () => dueSubagents());
    if (due.length === 0) return { ticked: 0 };

    await step.run("fan-out", async () => {
      await Promise.all(
        due.map((row) =>
          publish({
            name: "agent.subagent.tick" as never,
            data: { subagentId: row.id, scheduledFor: row.nextRunAt.toISOString() },
          }),
        ),
      );
    });
    return { ticked: due.length };
  },
);

export const subagentTick = inngest.createFunction(
  {
    id: "dacs-subagent-tick",
    name: "DACS · Sub-agent tick",
    concurrency: { limit: 5 },
    retries: 1,
  },
  { event: "agent.subagent.tick" as never },
  async ({ event, step }) => {
    const { subagentId } = event.data as { subagentId: string };

    const sa = await step.run("load", async () => getSubagent(subagentId));
    if (!sa || sa.status !== "active") {
      return { subagentId, skipped: true, reason: sa ? sa.status : "not_found" };
    }

    // Submit a fresh command so the existing DACS pipeline handles policy +
    // HITL + episodes for this tick. Reuses the original raw_text.
    const childCommandId = `sa_${sa.id.slice(0, 8)}_${randomUUID().slice(0, 8)}`;
    await step.run("submit-child-command", async () => {
      await publish({
        name: "agent.command.submitted",
        data: {
          commandId: childCommandId,
          walletAddress: sa.walletAddress,
          rawText: sa.rawText,
          promptMode: "execute",
          vaultState: null,
          walletState: null,
          submittedAt: Date.now(),
        },
      });
    });

    await step.run("record-tick", async () => {
      await recordTick({ id: sa.id, status: "ok", note: `tick→${childCommandId}` });
    });

    return { subagentId, childCommandId };
  },
);
