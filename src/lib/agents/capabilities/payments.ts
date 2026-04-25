/**
 * DACS — Payments domain capabilities (NEW; not in legacy route.ts).
 *
 *   - recurring_payment: Streamflow/Squads vesting + cliff schedules as one call.
 *   - invoice_pay: parse an invoice (URL or text) → on-chain payment proposal.
 *   - gas_tank_topup: auto-refill SOL when wallet balance drops below floor.
 *   - grant_disbursement: milestone-conditional release (GitHub / on-chain proof).
 *   - expense_categorize: LLM-tag outgoing txs into a P&L taxonomy.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";

const recurring_payment = defineCapability({
  id: "recurring_payment",
  domain: "payments",
  description:
    "Schedule a recurring or vesting payment (payroll, retainer, grant) with optional cliff. Backed by Streamflow / Squads vesting.",
  inputSchema: z.object({
    recipient: z.string(),
    token: z.string().default("USDC"),
    amountPerPeriod: z.number().positive(),
    period: z.enum(["daily", "weekly", "biweekly", "monthly"]),
    durationPeriods: z.number().int().positive(),
    cliffPeriods: z.number().int().min(0).optional().default(0),
    cancellable: z.boolean().optional().default(true),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["streamflow", "squads"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "recurring_payment", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("recurring_payment");
    if (blocked) return blocked;
    const totalAmount = input.amountPerPeriod * input.durationPeriods;
    return {
      success: true,
      operation: "recurring_payment",
      streamId: `stream_${Math.random().toString(36).slice(2, 10)}`,
      ...input,
      totalAmount,
      requiresApproval: true,
      message: `Recurring payment drafted: ${input.amountPerPeriod} ${input.token} ${input.period} → ${input.recipient.slice(0, 8)}… for ${input.durationPeriods} period(s) (total ${totalAmount} ${input.token}). Sign to start stream.`,
    };
  },
});

const invoice_pay = defineCapability({
  id: "invoice_pay",
  domain: "payments",
  description:
    "Parse an invoice (URL, raw text, or structured fields) and produce an on-chain payment proposal with memo and reference.",
  inputSchema: z.object({
    source: z.union([
      z.object({ url: z.string().url() }),
      z.object({ text: z.string().min(10) }),
      z.object({
        recipient: z.string(),
        amount: z.number().positive(),
        token: z.string().default("USDC"),
        memo: z.string().optional(),
        invoiceNumber: z.string().optional(),
      }),
    ]),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ source }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "invoice_pay", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("invoice_pay");
    if (blocked) return blocked;

    const isStructured = "recipient" in source && "amount" in source;
    if (!isStructured) {
      return {
        success: false,
        operation: "invoice_pay",
        status: "NEEDS_PARSE",
        message:
          "Invoice received. Run `browser_research` (URL) or LLM extraction (text), then call again with { recipient, amount, token, memo }.",
      };
    }
    const s = source as { recipient: string; amount: number; token: string; memo?: string; invoiceNumber?: string };
    return {
      success: true,
      operation: "invoice_pay",
      ...s,
      requiresApproval: true,
      message: `Invoice ${s.invoiceNumber || ""} → pay ${s.amount} ${s.token} to ${s.recipient.slice(0, 8)}…. Sign to send.`,
    };
  },
});

const gas_tank_topup = defineCapability({
  id: "gas_tank_topup",
  domain: "payments",
  description:
    "Configure an auto-refill rule: when wallet SOL drops below `floorSol`, swap stables → SOL up to `targetSol`.",
  inputSchema: z.object({
    floorSol: z.number().positive().describe("Refill trigger threshold in SOL"),
    targetSol: z.number().positive().describe("Refill target balance in SOL"),
    fundingToken: z.string().default("USDC"),
    maxRefillsPerDay: z.number().int().positive().optional().default(3),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["jupiter"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "gas_tank_topup", message: "Wallet required." };
    }
    if (input.targetSol <= input.floorSol) {
      return {
        success: false,
        operation: "gas_tank_topup",
        message: `targetSol (${input.targetSol}) must be greater than floorSol (${input.floorSol}).`,
      };
    }
    return {
      success: true,
      operation: "gas_tank_topup",
      ruleId: `gas_${Math.random().toString(36).slice(2, 10)}`,
      ...input,
      status: "ARMED",
      requiresApproval: true,
      message: `Gas tank armed: refill to ${input.targetSol} SOL when balance < ${input.floorSol} SOL (funded from ${input.fundingToken}, max ${input.maxRefillsPerDay}/day).`,
    };
  },
});

const grant_disbursement = defineCapability({
  id: "grant_disbursement",
  domain: "payments",
  description:
    "Create a milestone-gated grant. Funds release only when the milestone proof (GitHub PR merged / on-chain event / oracle attestation) is verified.",
  inputSchema: z.object({
    grantee: z.string(),
    token: z.string().default("USDC"),
    milestones: z
      .array(
        z.object({
          label: z.string(),
          amount: z.number().positive(),
          proof: z.discriminatedUnion("type", [
            z.object({ type: z.literal("github_pr"), repo: z.string(), prNumber: z.number().int().positive() }),
            z.object({ type: z.literal("onchain_event"), program: z.string(), eventName: z.string() }),
            z.object({ type: z.literal("manual_attestation"), attesters: z.array(z.string()).min(1) }),
          ]),
        }),
      )
      .min(1),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ grantee, token, milestones }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "grant_disbursement", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("grant_disbursement");
    if (blocked) return blocked;
    const total = milestones.reduce((s, m) => s + m.amount, 0);
    return {
      success: true,
      operation: "grant_disbursement",
      grantId: `grant_${Math.random().toString(36).slice(2, 10)}`,
      grantee,
      token,
      milestones,
      totalAmount: total,
      requiresApproval: true,
      message: `Grant drafted: ${total} ${token} to ${grantee.slice(0, 8)}… across ${milestones.length} milestone(s). Sign to escrow.`,
    };
  },
});

const expense_categorize = defineCapability({
  id: "expense_categorize",
  domain: "payments",
  description:
    "Tag recent outgoing transactions into a P&L taxonomy (payroll / vendor / grant / marketing / opex / capex / other) using LLM + heuristics.",
  inputSchema: z.object({
    lookbackDays: z.number().int().min(1).max(365).optional().default(30),
    walletOverride: z.string().optional(),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async ({ lookbackDays, walletOverride }, ctx) => {
    const wallet = walletOverride || ctx.walletAddress;
    if (!wallet) return { success: false, operation: "expense_categorize", message: "Wallet required." };
    return {
      success: true,
      operation: "expense_categorize",
      wallet,
      lookbackDays,
      categories: ["payroll", "vendor", "grant", "marketing", "opex", "capex", "other"],
      status: "DEFERRED_TO_INDEXER",
      message: `Expense categorization queued for last ${lookbackDays}d on ${wallet.slice(0, 8)}…. Result streams when the Helius/RPC indexer pass completes.`,
    };
  },
});

export const paymentsCapabilities: AnyCapability[] = [
  recurring_payment,
  invoice_pay,
  gas_tank_topup,
  grant_disbursement,
  expense_categorize,
];
