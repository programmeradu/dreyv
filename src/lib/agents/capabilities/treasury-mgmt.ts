/**
 * DACS — Treasury management capabilities (Phase 9 — CommandBar bridge).
 *
 * These capabilities let the user manage the Phase 5–7 treasury infra in
 * natural language via the CommandBar. Every write goes through DB only —
 * the always-on watchers (Phase 8) pick it up on the next tick and draft
 * `agent_tx_proposals` for HITL approval.
 *
 * Capabilities:
 *   - schedule_recurring_payout        create a payroll/grant schedule
 *   - list_recurring_payouts           read schedules for a vault
 *   - pause_recurring_payout           pause/resume by label or id
 *   - configure_gas_tank               set min/target SOL for auto top-up
 *   - list_invoices                    inbox with optional status filter
 *   - add_invoice                      add a single bill to the inbox
 *   - pay_overdue_invoices             draft batch proposal for overdue bills
 *   - draft_yield_route                propose USDC → venue at risk band
 *   - generate_treasury_report         snapshot + shareable token
 *   - run_security_audit               hygiene score + signer/multisig info
 *
 * All execute() handlers are best-effort: they return success:false with a
 * clear message instead of throwing when the DB or wallet is unavailable.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { db } from "@/db";
import {
  treasuryRecurringPayouts,
  treasuryGasTankWatchers,
  treasuryInvoices,
  treasuryYieldRoutes,
  treasuryReports,
  treasurySecurityAudits,
} from "@/db/schema";
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { resolveUserIdFromWallet, insertTxProposal } from "@/lib/agents/brains/storage";

function notReady(operation: string, message = "Backend unavailable") {
  return { success: false as const, operation, message };
}

function needWallet(operation: string) {
  return { success: false as const, operation, message: "Connect a wallet to manage treasury settings." };
}

function shareToken(): string {
  // 12-char URL-safe slug — collision-resistant for our scale.
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

// ─────────────────────────────────────────────────────────────────────
// Recurring payouts
// ─────────────────────────────────────────────────────────────────────
const RecipientSchema = z.object({
  address: z.string().min(32),
  amount: z.number().positive(),
  label: z.string().max(64).optional(),
});

const schedule_recurring_payout = defineCapability({
  id: "schedule_recurring_payout",
  domain: "payments",
  description:
    "Create a recurring payout schedule (payroll, grants, retainers) on a vault. The Phase 8 watcher fires it on cadence and drafts a batch transfer proposal for approval.",
  inputSchema: z.object({
    label: z.string().min(1).max(80),
    cadence: z.enum(["monthly", "biweekly", "weekly", "manual"]).default("monthly"),
    anchorDay: z.number().int().min(1).max(28).optional(),
    token: z.string().default("USDC"),
    recipients: z.array(RecipientSchema).min(1),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("schedule_recurring_payout");
    if (!ctx.walletAddress) return needWallet("schedule_recurring_payout");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const [row] = await db
      .insert(treasuryRecurringPayouts)
      .values({
        userId,
        vaultAddress: ctx.walletAddress,
        label: input.label,
        cadence: input.cadence,
        anchorDay: input.anchorDay ?? null,
        defaultToken: input.token.toUpperCase(),
        recipients: input.recipients as unknown as object,
        status: "active",
      })
      .returning();
    return {
      success: true,
      operation: "schedule_recurring_payout",
      scheduleId: row?.id,
      message: `Scheduled "${input.label}" — ${input.recipients.length} recipient(s) on ${input.cadence}.`,
    };
  },
});

const list_recurring_payouts = defineCapability({
  id: "list_recurring_payouts",
  domain: "payments",
  description: "List recurring payout schedules for the connected vault.",
  inputSchema: z.object({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (_input, ctx) => {
    if (!db) return notReady("list_recurring_payouts");
    if (!ctx.walletAddress) return needWallet("list_recurring_payouts");
    const rows = await db
      .select()
      .from(treasuryRecurringPayouts)
      .where(eq(treasuryRecurringPayouts.vaultAddress, ctx.walletAddress))
      .orderBy(desc(treasuryRecurringPayouts.createdAt))
      .limit(50);
    return { success: true, operation: "list_recurring_payouts", count: rows.length, schedules: rows };
  },
});

const pause_recurring_payout = defineCapability({
  id: "pause_recurring_payout",
  domain: "payments",
  description: "Pause, resume, or archive a recurring payout schedule by label or id.",
  inputSchema: z.object({
    match: z.string().describe("Schedule label or id"),
    action: z.enum(["pause", "resume", "archive"]).default("pause"),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("pause_recurring_payout");
    if (!ctx.walletAddress) return needWallet("pause_recurring_payout");
    const rows = await db
      .select()
      .from(treasuryRecurringPayouts)
      .where(eq(treasuryRecurringPayouts.vaultAddress, ctx.walletAddress));
    const target = rows.find((r) => r.id === input.match || r.label.toLowerCase() === input.match.toLowerCase());
    if (!target) return { success: false, operation: "pause_recurring_payout", message: `No schedule matched "${input.match}".` };
    const status = input.action === "pause" ? "paused" : input.action === "resume" ? "active" : "archived";
    await db
      .update(treasuryRecurringPayouts)
      .set({ status, updatedAt: new Date() })
      .where(eq(treasuryRecurringPayouts.id, target.id));
    return { success: true, operation: "pause_recurring_payout", scheduleId: target.id, status };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Gas tank
// ─────────────────────────────────────────────────────────────────────
const configure_gas_tank = defineCapability({
  id: "configure_gas_tank",
  domain: "payments",
  description:
    "Set up auto SOL refill for the connected vault. Phase 8 watcher polls every 5m and drafts a top-up proposal when balance falls below minSol.",
  inputSchema: z.object({
    minSol: z.number().positive(),
    targetSol: z.number().positive(),
    fundingAddress: z.string().optional(),
    capPerTopupSol: z.number().positive().default(1),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("configure_gas_tank");
    if (!ctx.walletAddress) return needWallet("configure_gas_tank");
    if (input.targetSol <= input.minSol) {
      return { success: false, operation: "configure_gas_tank", message: "targetSol must be greater than minSol." };
    }
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const [existing] = await db
      .select()
      .from(treasuryGasTankWatchers)
      .where(eq(treasuryGasTankWatchers.vaultAddress, ctx.walletAddress))
      .limit(1);
    if (existing) {
      await db
        .update(treasuryGasTankWatchers)
        .set({
          minSol: String(input.minSol),
          targetSol: String(input.targetSol),
          fundingAddress: input.fundingAddress ?? existing.fundingAddress,
          capPerTopupSol: String(input.capPerTopupSol),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(treasuryGasTankWatchers.id, existing.id));
      return { success: true, operation: "configure_gas_tank", watcherId: existing.id, updated: true };
    }
    const [row] = await db
      .insert(treasuryGasTankWatchers)
      .values({
        userId,
        vaultAddress: ctx.walletAddress,
        minSol: String(input.minSol),
        targetSol: String(input.targetSol),
        fundingAddress: input.fundingAddress ?? null,
        capPerTopupSol: String(input.capPerTopupSol),
        status: "active",
      })
      .returning();
    return { success: true, operation: "configure_gas_tank", watcherId: row?.id, updated: false };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────────────
const list_invoices = defineCapability({
  id: "list_invoices",
  domain: "payments",
  description: "List invoices in the inbox for the connected vault, optionally filtered by status.",
  inputSchema: z.object({
    status: z.enum(["pending", "queued", "paid", "rejected"]).optional(),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("list_invoices");
    if (!ctx.walletAddress) return needWallet("list_invoices");
    const where = input.status
      ? and(eq(treasuryInvoices.vaultAddress, ctx.walletAddress), eq(treasuryInvoices.status, input.status))
      : eq(treasuryInvoices.vaultAddress, ctx.walletAddress);
    const rows = await db.select().from(treasuryInvoices).where(where).orderBy(desc(treasuryInvoices.dueAt)).limit(50);
    return { success: true, operation: "list_invoices", count: rows.length, invoices: rows };
  },
});

const add_invoice = defineCapability({
  id: "add_invoice",
  domain: "payments",
  description: "Add an invoice to the vault inbox. Overdue invoices are auto-batched by the Phase 8 watcher.",
  inputSchema: z.object({
    vendorName: z.string().min(1).max(120),
    payToAddress: z.string().min(32),
    amount: z.number().positive(),
    token: z.string().default("USDC"),
    memo: z.string().max(280).optional(),
    dueAt: z.string().datetime().optional().describe("ISO timestamp"),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("add_invoice");
    if (!ctx.walletAddress) return needWallet("add_invoice");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const [row] = await db
      .insert(treasuryInvoices)
      .values({
        userId,
        vaultAddress: ctx.walletAddress,
        vendorName: input.vendorName,
        payToAddress: input.payToAddress,
        amount: String(input.amount),
        token: input.token.toUpperCase(),
        memo: input.memo ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: "pending",
      })
      .returning();
    return { success: true, operation: "add_invoice", invoiceId: row?.id };
  },
});

const pay_overdue_invoices = defineCapability({
  id: "pay_overdue_invoices",
  domain: "payments",
  description:
    "Draft a single batch transfer proposal for every overdue pending invoice on the connected vault. User must approve in the HITL queue.",
  inputSchema: z.object({}),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async (_input, ctx) => {
    if (!db) return notReady("pay_overdue_invoices");
    if (!ctx.walletAddress) return needWallet("pay_overdue_invoices");
    const blocked = ctx.blockExecutionForBuildIntent("pay_overdue_invoices");
    if (blocked) return blocked;
    const now = new Date();
    const overdue = await db
      .select()
      .from(treasuryInvoices)
      .where(
        and(
          eq(treasuryInvoices.vaultAddress, ctx.walletAddress),
          eq(treasuryInvoices.status, "pending"),
          isNotNull(treasuryInvoices.dueAt),
          lte(treasuryInvoices.dueAt, now),
        ),
      );
    if (overdue.length === 0) {
      return { success: true, operation: "pay_overdue_invoices", count: 0, message: "No overdue invoices." };
    }
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const proposal = await insertTxProposal({
      userId,
      kind: "batch_transfer",
      summary: `Pay overdue invoices · ${overdue.length} bill${overdue.length === 1 ? "" : "s"}`,
      instructions: overdue.map((i) => ({
        type: "transfer",
        from: ctx.walletAddress!,
        to: i.payToAddress,
        amount: Number(i.amount),
        token: i.token,
        memo: `${i.vendorName}${i.memo ? ` · ${i.memo}` : ""}`,
      })),
      riskLevel: "medium",
      routing: "wallet",
      meta: { source: "commandbar.pay_overdue_invoices", invoiceIds: overdue.map((i) => i.id) },
      ttlMinutes: 48 * 60,
    });
    if (proposal?.id) {
      for (const inv of overdue) {
        await db
          .update(treasuryInvoices)
          .set({ status: "queued", txProposalId: proposal.id, updatedAt: now })
          .where(eq(treasuryInvoices.id, inv.id));
      }
    }
    return {
      success: true,
      operation: "pay_overdue_invoices",
      count: overdue.length,
      proposalId: proposal?.id ?? null,
      requiresApproval: true,
      message: `Drafted batch proposal for ${overdue.length} overdue invoice(s). Approve in the HITL queue.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Yield routing
// ─────────────────────────────────────────────────────────────────────
const draft_yield_route = defineCapability({
  id: "draft_yield_route",
  domain: "yield",
  description:
    "Draft or arm a yield route (token → venue at a risk band). For 'activates when idle stables land', create status='armed' so the watcher can queue a policy-gated deposit when funds arrive.",
  inputSchema: z.object({
    token: z.string().default("USDC").describe("Token symbol only, e.g. 'USDC', 'SOL'. For pair positions like 'SOL-USDC' pass the deposit token."),
    venue: z.string().min(1).describe("e.g. 'Marinade', 'Kamino USDC', 'JitoSOL', 'Orca'"),
    riskBand: z.enum(["conservative", "balanced", "aggressive"]).default("conservative")
      .describe("Map 'higher risk'/'high'→'aggressive', 'medium'/'moderate'→'balanced', 'low'/'safe'→'conservative'."),
    targetAmount: z.coerce.number().nonnegative().default(0)
      .describe("Numeric token amount. If unknown or user says 'available balance', OMIT this field (defaults to 0 → uses idle balance)."),
    minApyBps: z.coerce.number().int().min(0).max(50000).optional()
      .describe("Minimum APY in basis points (integer). 80.85% APY = 8085."),
    notes: z.string().max(280).optional(),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("draft_yield_route");
    if (!ctx.walletAddress) return needWallet("draft_yield_route");
    const token = input.token.toUpperCase();
    const venue = input.venue.trim();
    const isStable = ["USDC", "USDT", "USDS", "PYUSD"].includes(token);
    if (isStable && /marinade|jito|blaze|stake|msol|jitosol|bsol/i.test(venue)) {
      return {
        success: false,
        operation: "draft_yield_route",
        status: "INVALID_TOKEN_VENUE_PAIR",
        message: `${venue} is SOL staking, not a ${token} lending venue. Use Jupiter Earn, Kamino, Drift, or MarginFi for stablecoin yield.`,
      };
    }
    const shouldArm = /activate|when|inflow|idle|land|auto/i.test(input.notes ?? "") || input.targetAmount === 0;
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const [row] = await db
      .insert(treasuryYieldRoutes)
      .values({
        userId,
        vaultAddress: ctx.walletAddress,
        token,
        venue,
        riskBand: input.riskBand,
        targetAmount: String(input.targetAmount),
        minApyBps: input.minApyBps ?? null,
        notes: input.notes ?? null,
        status: shouldArm ? "armed" : "draft",
      })
      .returning();
    return {
      success: true,
      operation: "draft_yield_route",
      routeId: row?.id,
      message: shouldArm
        ? `Armed ${token} → ${venue} (${input.riskBand}). It will queue a deposit proposal when idle ${token} lands in the vault.`
        : `Drafted ${token} → ${venue} (${input.riskBand}). Activate from /app/treasury when ready.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────
const generate_treasury_report = defineCapability({
  id: "generate_treasury_report",
  domain: "intel",
  description:
    "Generate a snapshot treasury report for the connected vault and return a public share link slug.",
  inputSchema: z.object({
    title: z.string().min(1).max(120).default("Treasury report"),
    expiresInDays: z.number().int().min(1).max(90).default(7),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("generate_treasury_report");
    if (!ctx.walletAddress) return needWallet("generate_treasury_report");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const token = shareToken();
    const expires = new Date(Date.now() + input.expiresInDays * 86_400_000);
    const snapshot = {
      vault: ctx.walletAddress,
      generatedAt: new Date().toISOString(),
      tokens: ctx.vaultState?.tokens ?? [],
    };
    const [row] = await db
      .insert(treasuryReports)
      .values({
        userId,
        vaultAddress: ctx.walletAddress,
        title: input.title,
        periodEnd: new Date(),
        shareToken: token,
        shareExpiresAt: expires,
        snapshot: snapshot as unknown as object,
        status: "shared",
      })
      .returning();
    return {
      success: true,
      operation: "generate_treasury_report",
      reportId: row?.id,
      shareToken: token,
      shareUrl: `/r/${token}`,
      expiresAt: expires.toISOString(),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Security audit
// ─────────────────────────────────────────────────────────────────────
const run_security_audit = defineCapability({
  id: "run_security_audit",
  domain: "risk",
  description:
    "Run a hygiene audit on the connected vault: signer count, multisig detection, basic findings, score 0–100.",
  inputSchema: z.object({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (_input, ctx) => {
    if (!db) return notReady("run_security_audit");
    if (!ctx.walletAddress) return needWallet("run_security_audit");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);

    // Lightweight scoring — full Squads detection lives in /api/treasury/security.
    const findings: Array<{ severity: "info" | "warn" | "high"; message: string }> = [];
    let score = 70;
    const tokens = ctx.vaultState?.tokens ?? [];
    if (tokens.length === 0) {
      findings.push({ severity: "info", message: "No tokens detected on this vault." });
    } else {
      score += 10;
    }
    findings.push({ severity: "info", message: "Run the on-chain audit from /app/treasury for multisig + Squads detection." });

    const [row] = await db
      .insert(treasurySecurityAudits)
      .values({
        userId,
        vaultAddress: ctx.walletAddress,
        score: Math.min(score, 100),
        findings: findings as unknown as object,
        signers: [],
        threshold: null,
        isMultisig: false,
        lastAuditAt: new Date(),
      })
      .returning();
    return { success: true, operation: "run_security_audit", auditId: row?.id, score: row?.score, findings };
  },
});

export const treasuryMgmtCapabilities: AnyCapability[] = [
  schedule_recurring_payout as AnyCapability,
  list_recurring_payouts as AnyCapability,
  pause_recurring_payout as AnyCapability,
  configure_gas_tank as AnyCapability,
  list_invoices as AnyCapability,
  add_invoice as AnyCapability,
  pay_overdue_invoices as AnyCapability,
  draft_yield_route as AnyCapability,
  generate_treasury_report as AnyCapability,
  run_security_audit as AnyCapability,
];
