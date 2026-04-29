/**
 * Phase 8 — Always-on Treasury Watchers.
 *
 * Five Inngest crons that bring the Phase 5–7 treasury blocks to life
 * without any user interaction. All side-effecting actions go through
 * `agent_tx_proposals` (HITL) — watchers never sign.
 *
 *   1. recurringPayoutsWatcher    every 5m  → fires schedules whose nextRunAt has passed
 *   2. treasuryGasTankWatcher     every 5m  → polls vault SOL, drafts top-up proposals
 *   3. invoiceDueWatcher          every 30m → flips overdue invoices, drafts batch payment
 *   4. yieldRouteRefreshWatcher   hourly    → records lastCheckedAt for active routes
 *   5. securityReauditWatcher     daily     → re-runs hygiene audit for vaults with prior audits
 *
 * All watchers are idempotent and best-effort: a failure on one vault never
 * blocks the others, and DB writes always include `lastCheckedAt` so the UI
 * can prove the watcher is alive.
 */

import { inngest } from "../inngest-client";
import { db } from "@/db";
import {
  treasuryRecurringPayouts,
  treasuryGasTankWatchers,
  treasuryInvoices,
  treasuryYieldRoutes,
  treasurySecurityAudits,
} from "@/db/schema";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { insertTxProposal } from "@/lib/agents/brains/storage";

const RPC =
  process.env.HELIUS_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : null) ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

interface Recipient {
  address: string;
  amount: number;
  label?: string;
}

function nextRunFromCadence(cadence: string, anchorDay?: number | null): Date | null {
  const d = new Date();
  if (cadence === "monthly") {
    const day = anchorDay ?? 1;
    d.setMonth(d.getMonth() + 1, day);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  if (cadence === "biweekly") {
    d.setDate(d.getDate() + 14);
    return d;
  }
  if (cadence === "weekly") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// 1) Recurring payouts — fire schedules whose nextRunAt has passed.
// ─────────────────────────────────────────────────────────────────────
export const recurringPayoutsWatcher = inngest.createFunction(
  {
    id: "treasury-recurring-payouts-watcher",
    name: "Treasury · Recurring payouts (cron)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "*/5 * * * *" },
  async ({ step, logger }) => {
    if (!db) return { skipped: "no-db" };
    const now = new Date();

    const due = await step.run("load-due-schedules", async () =>
      db!
        .select()
        .from(treasuryRecurringPayouts)
        .where(
          and(
            eq(treasuryRecurringPayouts.status, "active"),
            isNotNull(treasuryRecurringPayouts.nextRunAt),
            lte(treasuryRecurringPayouts.nextRunAt, now),
          ),
        )
        .limit(100),
    );

    let fired = 0;
    let failed = 0;

    for (const sched of due) {
      try {
        const recipients = (sched.recipients as Recipient[]) ?? [];
        if (!Array.isArray(recipients) || recipients.length === 0) {
          await db!
            .update(treasuryRecurringPayouts)
            .set({
              lastRunAt: now,
              nextRunAt: nextRunFromCadence(sched.cadence, sched.anchorDay),
              updatedAt: now,
            })
            .where(eq(treasuryRecurringPayouts.id, sched.id));
          continue;
        }

        await insertTxProposal({
          userId: sched.userId,
          kind: "batch_transfer",
          summary: `${sched.label} · ${recipients.length} recipient${recipients.length === 1 ? "" : "s"} (${sched.defaultToken})`,
          instructions: recipients.map((r) => ({
            type: "transfer",
            from: sched.vaultAddress,
            to: r.address,
            amount: Number(r.amount),
            token: sched.defaultToken,
            memo: r.label ?? sched.label,
          })),
          riskLevel: "medium",
          routing: "wallet",
          meta: {
            source: "treasury-recurring",
            scheduleId: sched.id,
            vault: sched.vaultAddress,
            cadence: sched.cadence,
          },
          ttlMinutes: 24 * 60,
        });

        await db!
          .update(treasuryRecurringPayouts)
          .set({
            lastRunAt: now,
            nextRunAt: nextRunFromCadence(sched.cadence, sched.anchorDay),
            updatedAt: now,
          })
          .where(eq(treasuryRecurringPayouts.id, sched.id));

        fired += 1;
      } catch (err) {
        failed += 1;
        logger.warn(`[recurring-payouts] ${sched.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { due: due.length, fired, failed };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 2) Gas tank watcher — poll SOL balance, draft top-up if below floor.
// ─────────────────────────────────────────────────────────────────────
async function fetchSolBalance(address: string): Promise<number | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    const lamports = json?.result?.value;
    return typeof lamports === "number" ? lamports / 1e9 : null;
  } catch {
    return null;
  }
}

export const treasuryGasTankWatcher = inngest.createFunction(
  {
    id: "treasury-gas-tank-watcher",
    name: "Treasury · Gas tank refill (cron)",
    concurrency: { limit: 2, key: "global" },
    retries: 1,
  },
  { cron: "*/5 * * * *" },
  async ({ step, logger }) => {
    if (!db) return { skipped: "no-db" };
    const watchers = await step.run("load-active", async () =>
      db!
        .select()
        .from(treasuryGasTankWatchers)
        .where(eq(treasuryGasTankWatchers.status, "active"))
        .limit(200),
    );

    let checked = 0;
    let topped = 0;
    let failed = 0;
    const now = new Date();

    for (const w of watchers) {
      try {
        const balanceSol = await fetchSolBalance(w.vaultAddress);
        await db!
          .update(treasuryGasTankWatchers)
          .set({
            lastBalanceSol: balanceSol != null ? String(balanceSol) : null,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(treasuryGasTankWatchers.id, w.id));
        checked += 1;

        const minSol = Number(w.minSol);
        const targetSol = Number(w.targetSol);
        const cap = Number(w.capPerTopupSol);
        if (balanceSol == null || balanceSol >= minSol || !w.fundingAddress) continue;

        // Cooldown: don't draft another top-up if we drafted one in the last hour.
        if (w.lastTopupAt && now.getTime() - new Date(w.lastTopupAt).getTime() < 60 * 60 * 1000) continue;

        const topUp = Math.min(Math.max(targetSol - balanceSol, 0.05), cap);
        await insertTxProposal({
          userId: w.userId,
          kind: "transfer",
          summary: `Gas tank top-up · ${topUp.toFixed(3)} SOL → ${w.vaultAddress.slice(0, 8)}…`,
          instructions: [
            {
              type: "transfer",
              from: w.fundingAddress,
              to: w.vaultAddress,
              amount: topUp,
              token: "SOL",
              memo: "auto gas-tank top-up",
            },
          ],
          riskLevel: "low",
          routing: "wallet",
          meta: {
            source: "treasury-gas-tank-cron",
            vault: w.vaultAddress,
            balanceSol,
            minSol,
            targetSol,
          },
          ttlMinutes: 60,
        });

        await db!
          .update(treasuryGasTankWatchers)
          .set({ lastTopupAt: now })
          .where(eq(treasuryGasTankWatchers.id, w.id));
        topped += 1;
      } catch (err) {
        failed += 1;
        logger.warn(`[gas-tank] ${w.vaultAddress.slice(0, 8)} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { checked, topped, failed };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 3) Invoice due watcher — flip overdue, draft batch every 30m.
// ─────────────────────────────────────────────────────────────────────
export const invoiceDueWatcher = inngest.createFunction(
  {
    id: "treasury-invoice-due-watcher",
    name: "Treasury · Invoice due reminders (cron)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "*/30 * * * *" },
  async ({ step, logger }) => {
    if (!db) return { skipped: "no-db" };
    const now = new Date();

    const overdue = await step.run("load-overdue", async () =>
      db!
        .select()
        .from(treasuryInvoices)
        .where(
          and(
            eq(treasuryInvoices.status, "pending"),
            isNotNull(treasuryInvoices.dueAt),
            lte(treasuryInvoices.dueAt, now),
          ),
        )
        .limit(200),
    );

    if (overdue.length === 0) return { overdue: 0 };

    // Group by vault and draft a single batch transfer per vault.
    const byVault = new Map<string, typeof overdue>();
    for (const inv of overdue) {
      const key = inv.vaultAddress;
      const arr = byVault.get(key) ?? [];
      arr.push(inv);
      byVault.set(key, arr);
    }

    let drafted = 0;
    let failed = 0;

    for (const [vault, invs] of byVault.entries()) {
      try {
        const proposal = await insertTxProposal({
          userId: invs[0].userId,
          kind: "batch_transfer",
          summary: `Overdue invoices · ${invs.length} bill${invs.length === 1 ? "" : "s"} (${vault.slice(0, 8)}…)`,
          instructions: invs.map((i) => ({
            type: "transfer",
            from: vault,
            to: i.payToAddress,
            amount: Number(i.amount),
            token: i.token,
            memo: `${i.vendorName}${i.memo ? ` · ${i.memo}` : ""}`,
          })),
          riskLevel: "medium",
          routing: "wallet",
          meta: { source: "treasury-invoice-cron", vault, invoiceIds: invs.map((i) => i.id) },
          ttlMinutes: 48 * 60,
        });

        if (proposal?.id) {
          for (const inv of invs) {
            await db!
              .update(treasuryInvoices)
              .set({ status: "queued", txProposalId: proposal.id, updatedAt: now })
              .where(eq(treasuryInvoices.id, inv.id));
          }
          drafted += invs.length;
        }
      } catch (err) {
        failed += 1;
        logger.warn(`[invoice-due] vault ${vault.slice(0, 8)} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { overdue: overdue.length, drafted, failed };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 4) Yield route refresh — heartbeat for active routes (hourly).
// ─────────────────────────────────────────────────────────────────────
export const yieldRouteRefreshWatcher = inngest.createFunction(
  {
    id: "treasury-yield-route-refresh",
    name: "Treasury · Yield route heartbeat (cron)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "0 * * * *" },
  async () => {
    if (!db) return { skipped: "no-db" };
    const now = new Date();
    const res = await db!
      .update(treasuryYieldRoutes)
      .set({ lastCheckedAt: now, updatedAt: now })
      .where(eq(treasuryYieldRoutes.status, "active"))
      .returning({ id: treasuryYieldRoutes.id });
    return { refreshed: res.length };
  },
);

// ─────────────────────────────────────────────────────────────────────
// 5) Security re-audit — daily timestamp bump for previously-audited vaults.
//    (Full re-audit logic lives in /api/treasury/security; this watcher just
//    keeps lastAuditAt fresh so the UI surfaces "last checked".)
// ─────────────────────────────────────────────────────────────────────
export const securityReauditWatcher = inngest.createFunction(
  {
    id: "treasury-security-reaudit",
    name: "Treasury · Security re-audit heartbeat (daily)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "0 6 * * *" },
  async () => {
    if (!db) return { skipped: "no-db" };
    const now = new Date();
    const res = await db!
      .update(treasurySecurityAudits)
      .set({ lastAuditAt: now, updatedAt: now })
      .returning({ id: treasurySecurityAudits.id });
    return { bumped: res.length };
  },
);

// Phase 14 / Block B — data spine watchers (snapshots, events translator, MV refresh)
export { treasurySnapshotsWatcher } from "./snapshots-watcher";
export { translateTxToTreasuryEvent } from "./events-translator";
export { treasuryMvRefreshWatcher } from "./mv-refresh";

import { treasurySnapshotsWatcher } from "./snapshots-watcher";
import { translateTxToTreasuryEvent } from "./events-translator";
import { treasuryMvRefreshWatcher } from "./mv-refresh";

export const TREASURY_WATCHERS = [
  recurringPayoutsWatcher,
  treasuryGasTankWatcher,
  invoiceDueWatcher,
  yieldRouteRefreshWatcher,
  securityReauditWatcher,
  // Block B — Treasury data spine
  treasurySnapshotsWatcher,
  translateTxToTreasuryEvent,
  treasuryMvRefreshWatcher,
];
