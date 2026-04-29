/**
 * Phase 14 / Block B Step 3 — refresh materialized views.
 *
 * The two MVs (`mv_vault_pnl_daily`, `mv_vault_composition_daily`) live in
 * migration `0021_treasury_materialized_views.sql`. We refresh them every
 * 30 minutes — the cadence is a pragmatic compromise:
 *   - shorter than the 24h aggregation window so refresh churn stays low,
 *   - longer than the 15min snapshot cron so we always include the latest
 *     full snapshot tick.
 *
 * Refresh is non-CONCURRENT on first run (no rows yet) and CONCURRENT on
 * subsequent runs; we try CONCURRENT first and fall back if Postgres
 * complains about "must be populated".
 */

import { inngest } from "../inngest-client";
import { db } from "@/db";
import { sql } from "drizzle-orm";

async function refreshMv(name: string): Promise<"concurrent" | "blocking" | "failed"> {
  if (!db) return "failed";
  try {
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${name}`));
    return "concurrent";
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // First-run case — view has never been populated, CONCURRENTLY fails.
    if (msg.includes("must be populated") || msg.includes("first")) {
      try {
        await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${name}`));
        return "blocking";
      } catch {
        return "failed";
      }
    }
    return "failed";
  }
}

export const treasuryMvRefreshWatcher = inngest.createFunction(
  {
    id: "treasury-mv-refresh",
    name: "Treasury · Refresh PnL + composition MVs (every 30m)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "*/30 * * * *" },
  async () => {
    if (!db) return { skipped: "no-db" };
    const pnl = await refreshMv("mv_vault_pnl_daily");
    const comp = await refreshMv("mv_vault_composition_daily");
    return { pnl, composition: comp };
  },
);
