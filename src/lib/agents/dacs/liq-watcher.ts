/**
 * DACS Phase 7C.5 — Liquidation watcher cron.
 *
 * Runs every 2 minutes. For each enabled `liquidation_watches` row:
 *   1. Probe the on-chain position via `probeVenue` (Helius RPC + offset decode).
 *   2. Update `last_health_factor`, `last_checked_at`, `last_check_error`.
 *   3. If HF < `health_factor_floor`: mark `breached`, fire alert webhook,
 *      write an `agent_episodes` row with `outcome: needs_attention`.
 *      (Auto-deleverage tx drafting is a follow-up — left as TODO; we never
 *       fabricate a "deleveraged" outcome.)
 *
 * Discovery-pending rows (no `position_account`) are skipped each tick and
 * kept so users can patch the account later.
 */

import { Inngest, type InngestHandlerArgs } from "inngest";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { liquidationWatches, agentEpisodes } from "@/db/schema";
import { probeVenue } from "./liq-probes";

const inngest = new Inngest({ id: "dacs-liq-watcher" });

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
    console.warn("[liq-watcher] alert webhook failed:", err instanceof Error ? err.message : err);
  }
}

export const liquidationWatcher = inngest.createFunction(
  {
    id: "dacs-liquidation-watcher",
    name: "DACS · Liquidation watcher (Kamino/MarginFi/Drift HF poll)",
    concurrency: { limit: 1, key: "global" },
    retries: 2,
  },
  { cron: "*/2 * * * *" },
  async ({ step, logger }: InngestHandlerArgs) => {
    const watches = await step.run("load-watches", async () =>
      db
        .select()
        .from(liquidationWatches)
        .where(and(eq(liquidationWatches.enabled, true), isNotNull(liquidationWatches.positionAccount))),
    );

    if (watches.length === 0) return { checked: 0, breached: 0 };

    let breached = 0;
    const now = new Date();

    for (const w of watches) {
      await step.run(`probe-${w.id}`, async () => {
        try {
          const result = await probeVenue(
            w.venue as "kamino" | "marginfi" | "drift",
            w.positionAccount!,
          );
          const hf = result.healthFactor;
          const floor = Number(w.healthFactorFloor);

          await db
            .update(liquidationWatches)
            .set({
              lastHealthFactor: hf != null && Number.isFinite(hf) ? String(hf) : null,
              lastCheckedAt: now,
              lastCheckError: result.error ?? null,
              checkAttempts: w.checkAttempts + 1,
              status: hf != null && hf < floor ? "breached" : "active",
              lastBreachedAt: hf != null && hf < floor ? now : w.lastBreachedAt,
              updatedAt: now,
            })
            .where(eq(liquidationWatches.id, w.id));

          if (hf != null && hf < floor) {
            breached += 1;
            await fireAlert(w.alertWebhook, {
              type: "liquidation_breach",
              watchId: w.id,
              wallet: w.walletAddress,
              venue: w.venue,
              positionAccount: w.positionAccount,
              healthFactor: hf,
              floor,
              autoDeleverage: w.autoDeleverage,
              at: now.toISOString(),
            });
            await db.insert(agentEpisodes).values({
              walletAddress: w.walletAddress,
              capabilityId: "liquidation_watch",
              input: { watchId: w.id, venue: w.venue, positionAccount: w.positionAccount, floor },
              output: { healthFactor: hf, collateralUsd: result.collateralUsd, liabilitiesUsd: result.liabilitiesUsd, autoDeleverage: w.autoDeleverage },
              outcome: "needs_attention",
              note: w.autoDeleverage
                ? `HF ${hf.toFixed(3)} < ${floor} on ${w.venue}. Auto-deleverage TX drafting not yet wired — manual action required.`
                : `HF ${hf.toFixed(3)} < ${floor} on ${w.venue}. Alert-only watch fired.`,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`probe ${w.id} failed: ${msg}`);
          await db
            .update(liquidationWatches)
            .set({ lastCheckError: msg, lastCheckedAt: now, checkAttempts: w.checkAttempts + 1, updatedAt: now })
            .where(eq(liquidationWatches.id, w.id));
        }
      });
    }

    return { checked: watches.length, breached };
  },
);
