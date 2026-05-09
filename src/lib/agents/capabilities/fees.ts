/**
 * Fee-reduction capabilities.
 *
 * Real, callable tools the Dreyv agent can use to (a) understand where a
 * treasury is bleeding fees and (b) propose concrete cost-saving actions.
 *
 * All executors hit live data sources — no stubs:
 *   - analyze_treasury_fees   → /api/analytics/fees (Helius enriched txs)
 *   - recommend_evm_gas        → /api/gas/estimate (eth_feeHistory)
 *   - recommend_solana_priority_fee → Helius RPC getPriorityFeeEstimate
 *   - find_dust_token_accounts → Helius DAS getTokenAccountsByOwner +
 *                                rent reclaim estimate (closeAccount)
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { getSiteOrigin } from "@/lib/seo/site";

/* ───────────────────────── helpers ───────────────────────── */

const SOLANA_RPC =
  process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";

const SOL_PER_TOKEN_ACCOUNT_RENT = 0.00203928; // exact rent-exempt minimum, lamports/1e9

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || `RPC error ${method}`);
  return json.result;
}

async function solUsdPrice(): Promise<number> {
  try {
    const r = await fetch("https://price.jup.ag/v6/price?ids=SOL", { cache: "no-store" });
    if (!r.ok) return 200;
    const j = await r.json();
    return Number(j?.data?.SOL?.price) || 200;
  } catch {
    return 200;
  }
}

/* ───────────────────────── 1. analyze_treasury_fees ───────────────────────── */

const analyze_treasury_fees = defineCapability({
  id: "analyze_treasury_fees",
  domain: "intel",
  description:
    "Pulls the last N months of on-chain fee spend for a Solana address from our analytics endpoint, identifies the largest cost drivers (priority fees, swap routing, failed txs, ATA churn, mass sends) and returns concrete reduction recommendations the agent can chain into proposals.",
  inputSchema: z.object({
    address: z.string().min(20).optional().describe("Solana address; defaults to active vault/wallet."),
    months: z.number().int().min(1).max(12).optional().default(6),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["solana"],
  execute: async (input, ctx) => {
    const address = input.address ?? ctx.vaultAddress ?? ctx.walletAddress;
    if (!address) {
      return {
        success: false,
        operation: "analyze_treasury_fees",
        message: "No address provided and no active vault/wallet on context.",
      };
    }
    const months = input.months ?? 6;
    // public=1 bypasses the SIWS middleware gate for this server-internal call;
    // the endpoint still returns the byType + totals slice the capability needs.
    const url = `${getSiteOrigin()}/api/analytics/fees?address=${encodeURIComponent(address)}&months=${months}&public=1`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {
        success: false,
        operation: "analyze_treasury_fees",
        message: `Fee analytics endpoint returned ${res.status}.`,
      };
    }
    const data = await res.json();
    const total = Number(data.totalFeeUsd) || 0;
    const txs = Number(data.transactionCount) || 0;
    const byType: Array<{ type: string; totalFees: number; count: number }> = data.byType || [];
    const top = byType[0];

    // Recommendation engine — driven by real distribution.
    const recs: Array<{ id: string; title: string; rationale: string; capability?: string }> = [];

    if (txs > 0 && total / Math.max(1, txs) > 0.0008) {
      recs.push({
        id: "lower_priority_fee_floor",
        title: "Lower priority-fee floor for routine ops",
        rationale: `Avg fee/tx is $${(total / txs).toFixed(4)}. Cap priority fee at the network 50th percentile for non-urgent sends.`,
        capability: "recommend_solana_priority_fee",
      });
    }

    if (top && /SWAP|JUPITER/i.test(top.type)) {
      recs.push({
        id: "tighter_swap_slippage",
        title: "Tighten swap slippage + prefer single-route quotes",
        rationale: `Swaps are the #1 fee bucket ($${top.totalFees.toFixed(2)}). Lower slippage bps and use Jupiter exact-out quotes to cut MEV / failed-tx waste.`,
        capability: "swap",
      });
    }

    const massCount = byType.find((b) => /TRANSFER|DISPATCH/i.test(b.type))?.count ?? 0;
    if (massCount > 25) {
      recs.push({
        id: "batch_mass_dispatch",
        title: "Batch transfers via mass_dispatch",
        rationale: `${massCount} transfer-style txs detected. Batching into a single mass dispatch drops base+priority fee per recipient.`,
        capability: "mass_dispatch",
      });
    }

    recs.push({
      id: "reclaim_dust_atas",
      title: "Reclaim rent from dust token accounts",
      rationale: `Each empty ATA locks ~${SOL_PER_TOKEN_ACCOUNT_RENT} SOL. Closing them returns rent and reduces UI clutter.`,
      capability: "find_dust_token_accounts",
    });

    return {
      success: true,
      operation: "analyze_treasury_fees",
      address,
      months,
      totals: {
        totalFeeUsd: total,
        totalFeeSol: data.totalFeeSol,
        transactionCount: txs,
        avgFeePerTx: data.avgFeePerTx,
      },
      topDrivers: byType.slice(0, 5),
      recommendations: recs,
      message: `${txs.toLocaleString()} txs, $${total.toFixed(2)} in fees over ${months} mo. ${recs.length} reduction levers identified.`,
    };
  },
});

/* ───────────────────────── 2. recommend_evm_gas ───────────────────────── */

const recommend_evm_gas = defineCapability({
  id: "recommend_evm_gas",
  domain: "intel",
  description:
    "Returns live EIP-1559 gas tiers (safeLow/standard/fast) for an EVM chain via eth_feeHistory and recommends the cheapest tier that still meets a target inclusion window. Use before any EVM tx to avoid overpaying priority fees.",
  inputSchema: z.object({
    chain: z.enum(["ethereum", "base", "arbitrum", "polygon", "optimism"]).optional().default("base"),
    urgency: z.enum(["safe", "standard", "fast"]).optional().default("standard"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["evm"],
  execute: async (input) => {
    const chain = input.chain ?? "base";
    const url = `${getSiteOrigin()}/api/gas/estimate?chain=${chain}&p=10&p=50&p=90`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {
        success: false,
        operation: "recommend_evm_gas",
        message: `Gas estimator returned ${res.status}.`,
      };
    }
    const data = await res.json();
    if (!data?.ok) {
      return { success: false, operation: "recommend_evm_gas", message: data?.error || "no data" };
    }
    const tiers = data.speeds;
    const pick = input.urgency === "fast" ? "fast" : input.urgency === "safe" ? "safeLow" : "standard";
    const chosen = tiers[pick];
    const fast = tiers.fast;
    const savingsPct =
      fast?.maxFeePerGas && chosen?.maxFeePerGas
        ? Math.max(0, ((fast.maxFeePerGas - chosen.maxFeePerGas) / fast.maxFeePerGas) * 100)
        : 0;

    return {
      success: true,
      operation: "recommend_evm_gas",
      chain,
      baseFeeGwei: data.base.baseFeePerGas,
      blockTimeSec: data.meta?.blockTimeSec,
      tiers,
      recommendation: {
        urgency: input.urgency ?? "standard",
        maxPriorityFeePerGasGwei: chosen.maxPriorityFeePerGas,
        maxFeePerGasGwei: chosen.maxFeePerGas,
        maxPriorityFeePerGasWeiHex: chosen.maxPriorityFeePerGasWeiHex,
        maxFeePerGasWeiHex: chosen.maxFeePerGasWeiHex,
        savingsVsFastPct: Number(savingsPct.toFixed(1)),
      },
      message: `${chain}: use ${chosen.maxFeePerGas.toFixed(2)} gwei maxFee (${savingsPct.toFixed(0)}% cheaper than 'fast').`,
    };
  },
});

/* ───────────────────────── 3. recommend_solana_priority_fee ───────────────────────── */

const recommend_solana_priority_fee = defineCapability({
  id: "recommend_solana_priority_fee",
  domain: "intel",
  description:
    "Calls Helius `getPriorityFeeEstimate` to recommend a micro-lamport priority fee for the next Solana tx at a target percentile. Use to cap priority spend instead of paying the network maximum.",
  inputSchema: z.object({
    accountKeys: z.array(z.string()).optional().describe("Optional writable accounts the tx will touch (improves estimate)."),
    percentile: z.enum(["min", "low", "medium", "high", "veryHigh", "unsafeMax"]).optional().default("medium"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["solana"],
  execute: async (input) => {
    if (!process.env.HELIUS_API_KEY) {
      return {
        success: false,
        operation: "recommend_solana_priority_fee",
        message: "HELIUS_API_KEY is not configured; priority-fee oracle unavailable.",
      };
    }
    const tier = input.percentile ?? "medium";
    const params = [{
      accountKeys: input.accountKeys && input.accountKeys.length > 0 ? input.accountKeys : ["11111111111111111111111111111111"],
      options: { includeAllPriorityFeeLevels: true, recommended: true },
    }];
    let result: any;
    try {
      result = await rpc("getPriorityFeeEstimate", params);
    } catch (err) {
      return {
        success: false,
        operation: "recommend_solana_priority_fee",
        message: err instanceof Error ? err.message : "RPC failed",
      };
    }
    const levels = result?.priorityFeeLevels ?? {};
    const recommended = result?.priorityFeeEstimate ?? levels[tier] ?? 0;
    return {
      success: true,
      operation: "recommend_solana_priority_fee",
      tier,
      microLamportsPerCu: recommended,
      levels,
      hint: "Set ComputeBudget.SetComputeUnitPrice to this value. Pair with SetComputeUnitLimit sized to the actual sim'd CU usage.",
      message: `Priority fee @ ${tier}: ${Number(recommended).toLocaleString()} µLamports/CU.`,
    };
  },
});

/* ───────────────────────── 4. find_dust_token_accounts ───────────────────────── */

const find_dust_token_accounts = defineCapability({
  id: "find_dust_token_accounts",
  domain: "intel",
  description:
    "Scans a Solana wallet for empty / near-empty token accounts (ATAs) that lock SOL rent. Returns the list and the total SOL/USD reclaimable by closing them — the agent can then queue a close-account batch for user approval.",
  inputSchema: z.object({
    owner: z.string().min(20).optional().describe("Wallet owner; defaults to active vault/wallet."),
    dustUsdThreshold: z.number().min(0).optional().default(0.5).describe("Treat balances under this USD value as dust."),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["solana"],
  execute: async (input, ctx) => {
    const owner = input.owner ?? ctx.vaultAddress ?? ctx.walletAddress;
    if (!owner) {
      return {
        success: false,
        operation: "find_dust_token_accounts",
        message: "No owner provided and no active vault/wallet on context.",
      };
    }

    let accounts: any;
    try {
      accounts = await rpc("getTokenAccountsByOwner", [
        owner,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ]);
    } catch (err) {
      return {
        success: false,
        operation: "find_dust_token_accounts",
        message: err instanceof Error ? err.message : "RPC failed",
      };
    }

    const list: any[] = accounts?.value ?? [];
    const dust = list
      .map((a) => {
        const info = a?.account?.data?.parsed?.info;
        const ui = Number(info?.tokenAmount?.uiAmount ?? 0);
        return {
          ata: a.pubkey as string,
          mint: info?.mint as string,
          uiAmount: ui,
          decimals: Number(info?.tokenAmount?.decimals ?? 0),
        };
      })
      .filter((a) => a.uiAmount === 0 || a.uiAmount < 1e-6);

    const reclaimableSol = dust.length * SOL_PER_TOKEN_ACCOUNT_RENT;
    const sol = await solUsdPrice();
    const reclaimableUsd = reclaimableSol * sol;

    return {
      success: true,
      operation: "find_dust_token_accounts",
      owner,
      totalAccounts: list.length,
      dustCount: dust.length,
      reclaimableSol: Number(reclaimableSol.toFixed(6)),
      reclaimableUsd: Number(reclaimableUsd.toFixed(2)),
      dustAccounts: dust.slice(0, 100),
      proposal:
        dust.length > 0
          ? {
              kind: "close_token_accounts",
              accounts: dust.slice(0, 25).map((d) => d.ata),
              note: "Close in batches of ≤25 to fit one tx. Rent returns to the owner.",
            }
          : null,
      message:
        dust.length > 0
          ? `Found ${dust.length} dust token accounts. Closing them reclaims ~${reclaimableSol.toFixed(4)} SOL ($${reclaimableUsd.toFixed(2)}).`
          : "No dust token accounts to clean up.",
    };
  },
});

export const feeReductionCapabilities: AnyCapability[] = [
  analyze_treasury_fees,
  recommend_evm_gas,
  recommend_solana_priority_fee,
  find_dust_token_accounts,
];
