/**
 * DACS Phase 7D.2 — Runway autopilot watcher cron.
 *
 * Every 5 minutes, for each enabled `runway_autopilot_rules` row:
 *   1. Value the treasury via Helius DAS + Jupiter prices (real, no demo).
 *   2. Use stored `monthlyBurnUsd` if set, else infer from 90d outflows.
 *   3. runwayMonths = treasuryUsd / burnUsd.
 *   4. Persist `last_treasury_usd` / `last_runway_months` / `last_checked_at`.
 *   5. If runway < target: mark `breached`, fire alert webhook, write
 *      `agent_episodes` row with `outcome: needs_attention`.
 *
 * We do NOT auto-execute rebalance txs here — that requires an approved
 * plan via DACS executor. The rule's `actionsAllowed` is surfaced in the
 * episode notes so the planner / HITL can pick the right response.
 */

import { Inngest, type InngestHandlerArgs } from "inngest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { runwayAutopilotRules, agentEpisodes } from "@/db/schema";
import { valueTreasuryUsd, inferMonthlyBurnUsd } from "./treasury-valuation";

const inngest = new Inngest({ id: "dacs-runway-autopilot" });

const RPC =
  process.env.HELIUS_RPC_URL ||
  (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : null) ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

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
    console.warn("[runway-autopilot] alert failed:", err instanceof Error ? err.message : err);
  }
}

export const runwayAutopilotWatcher = inngest.createFunction(
  {
    id: "dacs-runway-autopilot-watcher",
    name: "DACS · Runway autopilot (treasury value + burn-rate poll)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "*/5 * * * *" },
  async ({ step, logger }: InngestHandlerArgs) => {
    if (!db) {
      logger.warn("[runway-autopilot] DB not initialized");
      return { skipped: true };
    }

    const rules = await step.run("load-rules", async () =>
      db!
        .select()
        .from(runwayAutopilotRules)
        .where(eq(runwayAutopilotRules.enabled, true))
        .limit(100),
    );

    if (rules.length === 0) return { checked: 0, breached: 0 };

    let breached = 0;
    const now = new Date();

    for (const rule of rules) {
      await step.run(`tick-${rule.id}`, async () => {
        try {
          const valuation = await valueTreasuryUsd({ wallet: rule.walletAddress, rpcEndpoint: RPC });
          let burnUsd = rule.monthlyBurnUsd != null ? Number(rule.monthlyBurnUsd) : null;
          let inferredBurn: number | null = null;
          if (burnUsd == null || !Number.isFinite(burnUsd) || burnUsd <= 0) {
            const inf = await inferMonthlyBurnUsd({ wallet: rule.walletAddress, windowDays: 90 });
            inferredBurn = inf.monthlyBurnUsd;
            burnUsd = inferredBurn > 0 ? inferredBurn : null;
          }

          const target = Number(rule.targetRunwayMonths);
          const runwayMonths = burnUsd && burnUsd > 0 ? valuation.totalUsd / burnUsd : Infinity;
          const isBreached = burnUsd != null && burnUsd > 0 && runwayMonths < target;

          await db!
            .update(runwayAutopilotRules)
            .set({
              lastTreasuryUsd: String(valuation.totalUsd),
              lastRunwayMonths: Number.isFinite(runwayMonths) ? String(runwayMonths) : null,
              inferredBurnUsd: inferredBurn != null ? String(inferredBurn) : rule.inferredBurnUsd,
              lastCheckedAt: now,
              lastCheckError: null,
              checkAttempts: rule.checkAttempts + 1,
              status: isBreached ? "breached" : "active",
              lastBreachedAt: isBreached ? now : rule.lastBreachedAt,
              updatedAt: now,
            })
            .where(eq(runwayAutopilotRules.id, rule.id));

          if (isBreached) {
            breached += 1;
            const actions = Array.isArray(rule.actionsAllowed) ? (rule.actionsAllowed as string[]) : [];
            await fireAlert(rule.alertWebhook, {
              type: "runway_breach",
              ruleId: rule.id,
              wallet: rule.walletAddress,
              treasuryUsd: valuation.totalUsd,
              monthlyBurnUsd: burnUsd,
              runwayMonths,
              targetMonths: target,
              actionsAllowed: actions,
              at: now.toISOString(),
            });
            await db!.insert(agentEpisodes).values({
              commandId: `runway:${rule.id}:${now.getTime()}`,
              walletAddress: rule.walletAddress,
              intentKind: "policy.runway_autopilot",
              capabilityIds: ["treasury_runway_autopilot"],
              outcome: "needs_attention",
              valueUsd: String(valuation.totalUsd),
              notes: `Runway ${runwayMonths.toFixed(2)}mo < target ${target}mo at $${valuation.totalUsd.toFixed(0)} treasury / $${burnUsd!.toFixed(0)}/mo burn (${rule.rebalanceMode}). Allowed actions: ${actions.join(", ") || "alert_only"}.`,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`runway tick ${rule.id} failed: ${msg}`);
          await db!
            .update(runwayAutopilotRules)
            .set({
              lastCheckError: msg,
              lastCheckedAt: now,
              checkAttempts: rule.checkAttempts + 1,
              updatedAt: now,
            })
            .where(eq(runwayAutopilotRules.id, rule.id));
        }
      });
    }

    return { checked: rules.length, breached };
  },
);
