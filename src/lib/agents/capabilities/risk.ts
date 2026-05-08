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
import { eq } from "drizzle-orm";
import { defineCapability, type AnyCapability } from "./types";
import { TOKEN_MINTS } from "./tokens";
import { db } from "@/db";
import { users, userSettings } from "@/db/schema";
import { auditWalletMev } from "@/lib/agents/dacs/mev-audit";

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
      // Multi-leg stable diversification must be atomic — partial execution
      // leaves the portfolio further from the target than where it started.
      bundleStrategy: builtLegs.length > 1 ? "atomic" : "sequential",
      bundleReason:
        builtLegs.length > 1
          ? "Stablecoin diversification is atomic — all legs land or none do."
          : undefined,
      errors,
      requiresApproval: true,
      message: builtLegs.length > 0
        ? `Built ${builtLegs.length} Jupiter swap leg(s)${errors.length ? ` (${errors.length} failed)` : ""}. ${
            builtLegs.length > 1
              ? `One wallet popup signs all ${builtLegs.length} txs as an atomic bundle.`
              : `Sign the tx to converge on the ${riskAppetite} target.`
          }`
        : `Failed to build any swap leg. Errors: ${errors.map(e => e.error).join("; ")}`,
    };
  },
});

const tax_lot_tracker = defineCapability({
  id: "tax_lot_tracker",
  domain: "risk",
  description:
    "Run FIFO/LIFO/HIFO lot accounting on every swap/transfer over a window using real Helius enhanced txs + CoinGecko historical prices. Returns realized gain rows + open lots; supports JSON / TokenTax CSV / Cryptio CSV exports.",
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
    try {
      const { runTaxLots } = await import("@/lib/agents/dacs/tax-lot-engine");
      const report = await runTaxLots({ wallet, method, fromDate, toDate, exportFormat });
      return {
        success: true,
        operation: "tax_lot_tracker",
        method,
        fromDate,
        toDate,
        wallet,
        exportFormat,
        totals: report.totals,
        rows: report.rows,
        openLots: report.openLots,
        warnings: report.warnings,
        csv: report.csv,
        message: `Computed ${report.totals.rowCount} disposal row(s) over ${fromDate}→${toDate} (${method}). Realized gain $${report.totals.realizedGainUsd.toFixed(2)} (LT $${report.totals.longTermGainUsd.toFixed(2)} / ST $${report.totals.shortTermGainUsd.toFixed(2)}). ${report.openLots.length} open lot(s). ${report.warnings.length} warning(s).`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:tax_lot_tracker]", msg);
      return { success: false, operation: "tax_lot_tracker", wallet, message: `Tax-lot run failed: ${msg}` };
    }
  },
});

const hedge_position = defineCapability({
  id: "hedge_position",
  domain: "risk",
  description:
    "Plan a real Drift perp short to hedge spot exposure (delta-neutral). Live Pyth Hermes oracle price, slippage-protected limit, exact base/collateral amounts in protocol base units. Returns a complete order spec the client SDK signs via `driftClient.placePerpOrder`.",
  inputSchema: z.object({
    venue: z.enum(["drift"]).default("drift"),
    asset: z.string().default("SOL"),
    notionalUsd: z.number().positive(),
    leverage: z.number().min(1).max(10).default(2),
    collateralToken: z.string().default("USDC"),
    slippageBps: z.number().int().min(1).max(500).optional().default(30),
    reduceOnly: z.boolean().optional().default(false),
    postOnly: z.boolean().optional().default(false),
    expirySeconds: z.number().int().min(15).max(600).optional().default(60),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["drift"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "hedge_position", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("hedge_position");
    if (blocked) return blocked;

    if (input.collateralToken.toUpperCase() !== "USDC") {
      return { success: false, operation: "hedge_position", message: `Drift hedge currently supports USDC collateral only (received ${input.collateralToken}).` };
    }

    try {
      const { planDriftHedge } = await import("@/lib/agents/dacs/drift-hedge");
      const plan = await planDriftHedge({
        asset: input.asset,
        notionalUsd: input.notionalUsd,
        leverage: input.leverage,
        slippageBps: input.slippageBps,
        reduceOnly: input.reduceOnly,
        postOnly: input.postOnly,
        expirySeconds: input.expirySeconds,
      });
      if (!plan.ok) {
        return { success: false, operation: "hedge_position", asset: plan.asset, message: plan.error };
      }
      return {
        success: true,
        operation: "hedge_position",
        venue: "drift",
        asset: plan.asset,
        spec: plan.spec,
        warnings: plan.warnings,
        requiresApproval: true,
        message: `Drift ${plan.asset}-PERP short planned: ${plan.spec.baseAssetAmountHuman.toFixed(4)} ${plan.asset} @ oracle $${plan.spec.oraclePrice.toFixed(4)}, limit $${plan.spec.limitPrice.toFixed(4)} (${input.slippageBps}bps), collateral $${plan.spec.requiredCollateralUsd.toFixed(2)} USDC at ${input.leverage}×. ${plan.warnings.length} warning(s). Sign in Atlas to open.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:hedge_position]", msg);
      return { success: false, operation: "hedge_position", message: `Hedge planner failed: ${msg}` };
    }
  },
});

const liquidation_watch = defineCapability({
  id: "liquidation_watch",
  domain: "risk",
  description:
    "Persist a real liquidation watch on Kamino/MarginFi/Drift. Inngest cron probes the on-chain position every 2min via Helius RPC + per-protocol layout decode, fires alert webhook + agent_episodes entry when health factor drops below floor. Pass `positionAccount` to enable HF computation; otherwise watch is created in `discovery_pending` state.",
  inputSchema: z.object({
    venues: z.array(z.enum(["kamino", "marginfi", "drift"])).optional().default(["kamino", "marginfi", "drift"]),
    positionAccount: z.string().optional().describe("On-chain position account (Kamino obligation / MarginFi account / Drift user). Required for live HF; without it watch is discovery_pending."),
    healthFactorFloor: z.number().min(1).max(5).default(1.25),
    autoDeleverage: z.boolean().default(false),
    alertWebhook: z.string().url().optional(),
    enabled: z.boolean().optional().default(true),
    watchId: z.string().uuid().optional().describe("Pass to update an existing watch instead of creating new ones."),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["kamino", "marginfi", "drift"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "liquidation_watch", message: "Wallet required." };
    }
    try {
      const { db } = await import("@/db");
      const { liquidationWatches } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      if (!db) {
        return { success: false, operation: "liquidation_watch", message: "Database unavailable." };
      }

      const status = input.positionAccount ? "active" : "discovery_pending";

      // Update path.
      if (input.watchId) {
        const [updated] = await db
          .update(liquidationWatches)
          .set({
            healthFactorFloor: String(input.healthFactorFloor),
            autoDeleverage: input.autoDeleverage,
            alertWebhook: input.alertWebhook ?? null,
            enabled: input.enabled ?? true,
            positionAccount: input.positionAccount ?? null,
            status: input.enabled === false ? "disabled" : status,
            updatedAt: new Date(),
          })
          .where(eq(liquidationWatches.id, input.watchId))
          .returning();
        if (!updated) {
          return { success: false, operation: "liquidation_watch", message: `Watch ${input.watchId} not found.` };
        }
        return {
          success: true,
          operation: "liquidation_watch",
          watch: updated,
          message: `Watch ${input.watchId.slice(0, 8)}… updated. Status: ${updated.status}.`,
        };
      }

      // Create one watch row per venue.
      const inserted = await db
        .insert(liquidationWatches)
        .values(
          input.venues.map(venue => ({
            walletAddress: ctx.walletAddress!,
            venue,
            positionAccount: input.positionAccount ?? null,
            healthFactorFloor: String(input.healthFactorFloor),
            autoDeleverage: input.autoDeleverage,
            alertWebhook: input.alertWebhook ?? null,
            enabled: input.enabled ?? true,
            status,
          })),
        )
        .returning();

      const warnings: string[] = [];
      if (!input.positionAccount) {
        warnings.push("No positionAccount supplied — watches created in discovery_pending state. Patch via watchId once the obligation/marginfi/user account is known.");
      }

      return {
        success: true,
        operation: "liquidation_watch",
        watches: inserted,
        watchIds: inserted.map(w => w.id),
        warnings,
        message: `Created ${inserted.length} liquidation watch(es) across ${input.venues.join(", ")} at HF≥${input.healthFactorFloor}. ${input.autoDeleverage ? "Auto-deleverage flagged (TX drafting not yet wired)." : "Alert-only."} ${status === "discovery_pending" ? "Discovery pending — pass positionAccount to enable HF probes." : "Cron polls every 2min."}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:liquidation_watch]", msg);
      return { success: false, operation: "liquidation_watch", message: `Watch creation failed: ${msg}` };
    }
  },
});

const mev_rebate_claim = defineCapability({
  id: "mev_rebate_claim",
  domain: "risk",
  description:
    "Audit a wallet's Jito MEV exposure: real Helius scan of tip-account payments + live JitoSOL position + optional persistent toggle to route future swaps through Jito bundles. Honest audit — Jito has no user-claimable rebate program; this surfaces real spend and real position, not fabricated 'claims'.",
  inputSchema: z.object({
    windowDays: z.number().int().min(1).max(365).optional().default(12)
      .describe("Look-back window for tip-spend audit (default ≈ 5 epochs)."),
    enableRouting: z.boolean().optional()
      .describe("If set, persist user preference to route future swaps through Jito bundles."),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  protocols: ["jito"],
  execute: async ({ windowDays, enableRouting }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "mev_rebate_claim", message: "Wallet required." };
    }
    try {
      const audit = await auditWalletMev({
        wallet: ctx.walletAddress,
        rpcEndpoint: ctx.rpcEndpoint,
        windowDays,
      });

      // Optionally persist the routing preference (best-effort; doesn't block the audit).
      let routingPersisted: boolean | null = null;
      if (typeof enableRouting === "boolean" && db) {
        try {
          const userRow = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.walletAddress, ctx.walletAddress))
            .limit(1);
          const userId = userRow[0]?.id;
          if (userId) {
            const existing = await db
              .select({ id: userSettings.id, preferences: userSettings.preferences })
              .from(userSettings)
              .where(eq(userSettings.userId, userId))
              .limit(1);
            const prevPrefs = (existing[0]?.preferences as Record<string, unknown> | null) ?? {};
            const nextPrefs = { ...prevPrefs, jitoBundleRouting: enableRouting };
            if (existing[0]) {
              await db
                .update(userSettings)
                .set({ preferences: nextPrefs, updatedAt: new Date() })
                .where(eq(userSettings.id, existing[0].id));
            } else {
              await db.insert(userSettings).values({ userId, preferences: nextPrefs });
            }
            routingPersisted = enableRouting;
          }
        } catch (err) {
          console.warn("[mev_rebate_claim] failed to persist routing pref:", err instanceof Error ? err.message : err);
        }
      }

      return {
        success: true,
        operation: "mev_rebate_claim",
        wallet: audit.wallet,
        windowDays: audit.windowDays,
        tipSummary: {
          totalTipsSol: audit.totalTipsSol,
          totalTipsLamports: audit.totalTipsLamports,
          tipCount: audit.tipCount,
          recent: audit.tipPayments.slice(0, 10).map((t) => ({
            signature: t.signature,
            timestamp: t.timestamp,
            sol: t.sol,
            tipAccount: t.tipAccount,
          })),
        },
        jitosolPosition: audit.jitosolPosition,
        routing: {
          requested: enableRouting ?? null,
          persisted: routingPersisted,
        },
        message: audit.summary,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:mev_rebate_claim]", msg);
      return { success: false, operation: "mev_rebate_claim", message: `MEV audit failed: ${msg}` };
    }
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
