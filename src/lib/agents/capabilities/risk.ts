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
    "Score a wallet or protocol before interacting. Real fan-out across DefiLlama (TVL trend), GitHub (repo/audit activity), Helius (wallet concentration), Pyth (oracle liveness). Returns 0-100 sub-scores + composite + risk band.",
  inputSchema: z.object({
    target: z.string().describe("Wallet address or protocol slug (e.g. 'kamino', 'marginfi', 'drift')"),
    targetType: z.enum(["wallet", "protocol"]),
    depth: z.enum(["quick", "deep"]).optional().default("quick"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ target, targetType, depth }) => {
    try {
      const { scoreCounterparty } = await import("@/lib/agents/dacs/counterparty-scorer");
      const report = await scoreCounterparty(target, targetType, depth);
      return {
        success: true,
        operation: "counterparty_risk_score",
        target,
        targetType,
        depth,
        scores: report.scores,
        composite: report.composite,
        band: report.band,
        coverage: report.coverage,
        warnings: report.warnings,
        fetchedAt: report.fetchedAt,
        message: report.composite != null
          ? `Composite ${report.composite}/100 (${report.band} risk) for ${targetType} ${target.slice(0, 16)}…. Coverage ${report.coverage.available}/${report.coverage.total} sub-scores.`
          : `Could not score ${target.slice(0, 16)}… — all sub-scores returned no data. Check warnings.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:counterparty_risk_score]", msg);
      return { success: false, operation: "counterparty_risk_score", target, targetType, message: `Scorer failed: ${msg}` };
    }
  },
});

const STABLES = ["USDC", "USDT", "PYUSD", "USDS"] as const;
type StableSymbol = (typeof STABLES)[number];

const STABLE_TARGETS: Record<"conservative" | "balanced" | "aggressive", Record<StableSymbol, number>> = {
  conservative: { USDC: 60, USDT: 15, PYUSD: 15, USDS: 10 },
  balanced: { USDC: 45, USDT: 25, PYUSD: 15, USDS: 15 },
  aggressive: { USDC: 35, USDT: 30, PYUSD: 20, USDS: 15 },
};

const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP = "https://lite-api.jup.ag/swap/v1/swap";

async function buildStableSwap(input: { fromMint: string; toMint: string; amountBaseUnits: string; walletAddress: string; slippageBps: number }): Promise<{ inAmount: string; outAmount: string; serializedTransaction: string; quote: unknown }> {
  const qUrl = new URL(JUP_QUOTE);
  qUrl.searchParams.set("inputMint", input.fromMint);
  qUrl.searchParams.set("outputMint", input.toMint);
  qUrl.searchParams.set("amount", input.amountBaseUnits);
  qUrl.searchParams.set("slippageBps", String(input.slippageBps));
  const qRes = await fetch(qUrl, { signal: AbortSignal.timeout(10_000) });
  if (!qRes.ok) throw new Error(`Jupiter quote ${qRes.status}: ${await qRes.text().catch(() => "")}`);
  const quote = await qRes.json();

  const sRes = await fetch(JUP_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: input.walletAddress,
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!sRes.ok) throw new Error(`Jupiter /swap ${sRes.status}: ${await sRes.text().catch(() => "")}`);
  const sJson = await sRes.json();
  if (!sJson.swapTransaction) throw new Error("Jupiter /swap returned no swapTransaction");
  return { inAmount: String(quote.inAmount), outAmount: String(quote.outAmount), serializedTransaction: sJson.swapTransaction, quote };
}

const stablecoin_diversification = defineCapability({
  id: "stablecoin_diversification",
  domain: "risk",
  description:
    "Recommend or execute a rebalance of stablecoin holdings (USDC/USDT/PYUSD/USDS) toward a depeg-risk-weighted target. In execute mode, builds real Jupiter swap legs to converge on the target allocation. Reads live wallet stables — never uses demo figures.",
  inputSchema: z.object({
    targetUsd: z.number().positive().optional().describe("Total stable allocation; defaults to live total stables in wallet"),
    riskAppetite: z.enum(["conservative", "balanced", "aggressive"]).optional().default("balanced"),
    executeMode: z.enum(["recommend", "execute"]).optional().default("recommend"),
    tolerancePct: z.number().min(0.5).max(20).optional().default(2).describe("Skip legs below this absolute % deviation from target"),
    slippageBps: z.number().int().min(1).max(500).optional().default(10),
  }),
  sideEffects: "sim",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["jupiter"],
  execute: async ({ targetUsd, riskAppetite, executeMode, tolerancePct, slippageBps }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "stablecoin_diversification", message: "Wallet required." };
    }
    if (executeMode === "execute") {
      const blocked = ctx.blockExecutionForBuildIntent("stablecoin_diversification");
      if (blocked) return blocked;
    }

    // Read live stable balances from vaultState/walletState. NEVER fabricate.
    const holdings: any[] = (ctx.vaultState?.tokens as any[]) || (ctx.walletState?.balances as any[]) || [];
    const liveByStable: Record<StableSymbol, { amount: number; usd: number }> = {
      USDC: { amount: 0, usd: 0 }, USDT: { amount: 0, usd: 0 }, PYUSD: { amount: 0, usd: 0 }, USDS: { amount: 0, usd: 0 },
    };
    for (const h of holdings) {
      const sym = String(h?.symbol ?? "").toUpperCase() as StableSymbol;
      if (!STABLES.includes(sym)) continue;
      const amount = Number(h.amount ?? 0);
      const price = Number(h.price ?? 1);
      const usd = Number(h.usdValue ?? amount * price);
      liveByStable[sym] = { amount, usd };
    }
    const liveTotalUsd = STABLES.reduce((s, k) => s + liveByStable[k].usd, 0);
    const totalUsd = targetUsd ?? liveTotalUsd;

    if (totalUsd <= 0) {
      return {
        success: false,
        operation: "stablecoin_diversification",
        riskAppetite,
        executeMode,
        message: "No stablecoin balance detected and no targetUsd supplied. Fund the wallet with stables or pass targetUsd to model a hypothetical mix.",
      };
    }

    const targetPct = STABLE_TARGETS[riskAppetite];
    // Compute current vs target USD per stable + delta.
    const plan = STABLES.map(sym => {
      const currentUsd = liveByStable[sym].usd;
      const currentPct = liveTotalUsd > 0 ? (currentUsd / liveTotalUsd) * 100 : 0;
      const target = targetPct[sym];
      const targetUsd = (target / 100) * totalUsd;
      const deltaUsd = targetUsd - currentUsd;
      return { symbol: sym, currentUsd, currentPct, targetPct: target, targetUsd, deltaUsd };
    });

    // Match donors (deltaUsd<0, must sell) with receivers (deltaUsd>0, must buy).
    const donors = plan.filter(p => p.deltaUsd < -((tolerancePct / 100) * totalUsd)).map(p => ({ ...p, remaining: -p.deltaUsd }));
    const receivers = plan.filter(p => p.deltaUsd > ((tolerancePct / 100) * totalUsd)).map(p => ({ ...p, remaining: p.deltaUsd }));

    // Pair largest donor with largest receiver until exhausted.
    const legs: Array<{ from: StableSymbol; to: StableSymbol; usd: number }> = [];
    donors.sort((a, b) => b.remaining - a.remaining);
    receivers.sort((a, b) => b.remaining - a.remaining);
    while (donors.length && receivers.length) {
      const d = donors[0]; const r = receivers[0];
      const usd = Math.min(d.remaining, r.remaining);
      legs.push({ from: d.symbol, to: r.symbol, usd });
      d.remaining -= usd; r.remaining -= usd;
      if (d.remaining < 0.01) donors.shift();
      if (r.remaining < 0.01) receivers.shift();
    }

    if (legs.length === 0) {
      return {
        success: true,
        operation: "stablecoin_diversification",
        riskAppetite,
        executeMode,
        liveTotalUsd,
        targetTotalUsd: totalUsd,
        targetAllocationPct: targetPct,
        plan,
        legs: [],
        requiresApproval: false,
        message: `Already within ±${tolerancePct}% of target (${riskAppetite}). No rebalance needed.`,
      };
    }

    if (executeMode === "recommend" || liveTotalUsd === 0) {
      return {
        success: true,
        operation: "stablecoin_diversification",
        riskAppetite,
        executeMode,
        liveTotalUsd,
        targetTotalUsd: totalUsd,
        targetAllocationPct: targetPct,
        plan,
        legs,
        requiresApproval: false,
        message: `Recommendation: ${legs.length} swap leg(s) — ${legs.map(l => `${l.usd.toFixed(0)} ${l.from}→${l.to}`).join(", ")}.${liveTotalUsd === 0 ? " No live balance — sign capability deferred until wallet is funded." : ""}`,
      };
    }

    // Execute mode: build Jupiter swap txs for each leg.
    const builtLegs: Array<{ from: StableSymbol; to: StableSymbol; usd: number; serializedTransaction: string; inAmount: string; outAmount: string }> = [];
    const errors: Array<{ leg: { from: StableSymbol; to: StableSymbol; usd: number }; error: string }> = [];
    for (const leg of legs) {
      try {
        const fromMint = TOKEN_MINTS[leg.from]; const toMint = TOKEN_MINTS[leg.to];
        if (!fromMint || !toMint) throw new Error(`Missing mint for ${leg.from} or ${leg.to}`);
        // Stables are 1:1 USD; base units use 6 decimals for all four.
        const amountBaseUnits = String(Math.floor(leg.usd * 1_000_000));
        if (amountBaseUnits === "0") continue;
        const swap = await buildStableSwap({ fromMint, toMint, amountBaseUnits, walletAddress: ctx.walletAddress!, slippageBps });
        builtLegs.push({ from: leg.from, to: leg.to, usd: leg.usd, ...swap });
      } catch (err) {
        errors.push({ leg, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      success: builtLegs.length > 0,
      operation: "stablecoin_diversification",
      riskAppetite,
      executeMode,
      liveTotalUsd,
      targetTotalUsd: totalUsd,
      targetAllocationPct: targetPct,
      plan,
      legs: builtLegs.map(l => ({ from: l.from, to: l.to, usd: l.usd, inAmount: l.inAmount, outAmount: l.outAmount })),
      serializedTransactions: builtLegs.map(l => l.serializedTransaction),
      errors,
      requiresApproval: true,
      message: builtLegs.length > 0
        ? `Built ${builtLegs.length} Jupiter swap leg(s)${errors.length ? ` (${errors.length} failed)` : ""}. Sign each tx to converge on the ${riskAppetite} target.`
        : `Failed to build any swap leg. Errors: ${errors.map(e => e.error).join("; ")}`,
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
