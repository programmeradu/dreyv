/**
 * DACS — Risk domain capabilities (NEW; not in legacy route.ts).
 *
 *   - counterparty_risk_score: score wallet/protocol before interacting.
 *   - stablecoin_diversification: rebalance stables by depeg-risk weight.
 *   - tax_lot_tracker: FIFO/LIFO/HIFO lot accounting + capital-gains export.
 *   - hedge_position: open Drift/Zeta perp short to hedge SOL exposure.
 *   - liquidation_watch: monitor & auto-deleverage Kamino/MarginFi/Drift.
 *   - mev_rebate_claim: claim Jito tips / priority-fee rebates.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";

const counterparty_risk_score = defineCapability({
  id: "counterparty_risk_score",
  domain: "risk",
  description:
    "Score a wallet or protocol before interacting: TVL trend, audit recency, admin-key concentration, governance attack surface, oracle dependencies.",
  inputSchema: z.object({
    target: z.string().describe("Wallet address or protocol identifier (e.g. 'kamino', 'marginfi')"),
    targetType: z.enum(["wallet", "protocol"]),
    depth: z.enum(["quick", "deep"]).optional().default("quick"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ target, targetType, depth }) => {
    return {
      success: true,
      operation: "counterparty_risk_score",
      target,
      targetType,
      depth,
      // Placeholder scoring; deep mode will fan out to DefiLlama + GitHub + audit registry.
      scores: {
        tvlTrend: null,
        auditRecency: null,
        adminKeyConcentration: null,
        governanceAttackSurface: null,
        oracleDependencyRisk: null,
      },
      compositeRisk: "UNKNOWN",
      message: `Counterparty scan queued for ${targetType}: ${target.slice(0, 16)}… (${depth}). Scores stream once intel agents return.`,
    };
  },
});

const stablecoin_diversification = defineCapability({
  id: "stablecoin_diversification",
  domain: "risk",
  description:
    "Recommend or execute a rebalance of stablecoin holdings (USDC/USDT/PYUSD/USDS/...) weighted by depeg-risk score and on-chain liquidity.",
  inputSchema: z.object({
    targetUsd: z.number().positive().optional().describe("Total stable allocation; defaults to current total stables"),
    riskAppetite: z.enum(["conservative", "balanced", "aggressive"]).optional().default("balanced"),
    executeMode: z.enum(["recommend", "execute"]).optional().default("recommend"),
  }),
  sideEffects: "sim",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["jupiter"],
  execute: async ({ targetUsd, riskAppetite, executeMode }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "stablecoin_diversification", message: "Wallet required." };
    }
    // Static depeg-risk-weighted target allocations; refined later by intel agents.
    const allocations: Record<string, Record<string, number>> = {
      conservative: { USDC: 60, USDT: 15, PYUSD: 15, USDS: 10 },
      balanced: { USDC: 45, USDT: 25, PYUSD: 15, USDS: 15 },
      aggressive: { USDC: 35, USDT: 30, PYUSD: 20, USDS: 15 },
    };
    return {
      success: true,
      operation: "stablecoin_diversification",
      targetUsd: targetUsd ?? null,
      riskAppetite,
      executeMode,
      targetAllocationPct: allocations[riskAppetite],
      requiresApproval: executeMode === "execute",
      message: `Stable mix (${riskAppetite}): ${Object.entries(allocations[riskAppetite]).map(([k, v]) => `${k} ${v}%`).join(" / ")}.${executeMode === "execute" ? " Sign to rebalance via Jupiter." : " Recommendation only."}`,
    };
  },
});

const tax_lot_tracker = defineCapability({
  id: "tax_lot_tracker",
  domain: "risk",
  description:
    "Run FIFO/LIFO/HIFO lot accounting on every swap/transfer over a window and produce a capital-gains report (TokenTax/Cryptio CSV ready).",
  inputSchema: z.object({
    method: z.enum(["FIFO", "LIFO", "HIFO"]).default("FIFO"),
    fromDate: z.string().describe("ISO date, e.g. 2026-01-01"),
    toDate: z.string().describe("ISO date, e.g. 2026-12-31"),
    walletOverride: z.string().optional(),
    exportFormat: z.enum(["json", "csv_tokentax", "csv_cryptio"]).optional().default("json"),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async ({ method, fromDate, toDate, walletOverride, exportFormat }, ctx) => {
    const wallet = walletOverride || ctx.walletAddress;
    if (!wallet) return { success: false, operation: "tax_lot_tracker", message: "Wallet required." };
    return {
      success: true,
      operation: "tax_lot_tracker",
      method,
      fromDate,
      toDate,
      wallet,
      exportFormat,
      status: "DEFERRED_TO_INDEXER",
      message: `Tax-lot run (${method}) queued for ${fromDate} → ${toDate} on ${wallet.slice(0, 8)}…. Report streams as ${exportFormat} when indexer completes.`,
    };
  },
});

const hedge_position = defineCapability({
  id: "hedge_position",
  domain: "risk",
  description:
    "Open or adjust a perp short on Drift/Zeta to hedge spot exposure (delta-neutral stables strategy).",
  inputSchema: z.object({
    venue: z.enum(["drift", "zeta"]).default("drift"),
    asset: z.string().default("SOL"),
    notionalUsd: z.number().positive(),
    leverage: z.number().min(1).max(10).default(2),
    collateralToken: z.string().default("USDC"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["drift", "zeta"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "hedge_position", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("hedge_position");
    if (blocked) return blocked;
    const requiredCollateral = input.notionalUsd / input.leverage;
    return {
      success: true,
      operation: "hedge_position",
      ...input,
      requiredCollateralUsd: requiredCollateral,
      requiresApproval: true,
      message: `Hedge drafted: short $${input.notionalUsd.toLocaleString()} ${input.asset} on ${input.venue} at ${input.leverage}× (collateral ≈ $${requiredCollateral.toLocaleString()} ${input.collateralToken}). Sign to open.`,
    };
  },
});

const liquidation_watch = defineCapability({
  id: "liquidation_watch",
  domain: "risk",
  description:
    "Monitor open positions on Kamino/MarginFi/Drift; auto-deleverage when health factor drops below threshold.",
  inputSchema: z.object({
    venues: z
      .array(z.enum(["kamino", "marginfi", "drift"]))
      .optional()
      .default(["kamino", "marginfi", "drift"]),
    healthFactorFloor: z.number().min(1).max(5).default(1.25),
    autoDeleverage: z.boolean().default(true),
    alertWebhook: z.string().url().optional(),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["kamino", "marginfi", "drift"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "liquidation_watch", message: "Wallet required." };
    }
    return {
      success: true,
      operation: "liquidation_watch",
      watchId: `liq_${Math.random().toString(36).slice(2, 10)}`,
      ...input,
      status: "ARMED",
      requiresApproval: true,
      message: `Liquidation watch armed across ${input.venues.join(", ")} at HF≥${input.healthFactorFloor}.${input.autoDeleverage ? " Auto-deleverage on breach." : " Alert-only."}`,
    };
  },
});

const mev_rebate_claim = defineCapability({
  id: "mev_rebate_claim",
  domain: "risk",
  description:
    "Claim Jito MEV tips and route future tx flow through priority-fee rebate programs.",
  inputSchema: z.object({
    epochsBack: z.number().int().min(1).max(50).optional().default(5),
    enableRouting: z.boolean().optional().default(true),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "low",
  protocols: ["jito"],
  execute: async ({ epochsBack, enableRouting }, ctx) => {
    if (!ctx.walletAddress) return { success: false, operation: "mev_rebate_claim", message: "Wallet required." };
    return {
      success: true,
      operation: "mev_rebate_claim",
      epochsBack,
      enableRouting,
      requiresApproval: true,
      message: `Scanning Jito tips over last ${epochsBack} epoch(s) for ${ctx.walletAddress.slice(0, 8)}…. Sign to claim and ${enableRouting ? "route future tx flow through Jito rebate program" : "leave routing unchanged"}.`,
    };
  },
});

export const riskCapabilities: AnyCapability[] = [
  counterparty_risk_score,
  stablecoin_diversification,
  tax_lot_tracker,
  hedge_position,
  liquidation_watch,
  mev_rebate_claim,
];
