/**
 * DACS Phase 0 — Trading domain capabilities.
 *
 * Migrated 1:1 from `src/app/api/command/route.ts` to the typed Capability
 * registry. Behavior is byte-for-byte preserved; only request-scope state
 * (walletAddress, rpcEndpoint, executionState, build-intent gate, split-amount
 * resolver) now flows through the unified `CapabilityContext` instead of being
 * closed over.
 *
 * Capabilities in this module:
 *   - swap:              Jupiter swap (legacy alias kept alongside execute_swap)
 *   - execute_swap:      Jupiter swap (preferred surface for execution intents)
 *   - bridge:            Cross-chain bridge via Rango Exchange
 *   - deploy_sniper_bot: Stage an active liquidity-monitoring bot
 *
 * Phase 1 router will read `sideEffects` + `sensitivity` to decide HITL routing
 * for each of these without touching the executor.
 */

import { z } from "zod";
import { ExecutionCoordinator } from "@/lib/agents/coordinator";
import { defineCapability, type AnyCapability } from "./types";
import { resolveTokenMint, tokenDecimals, TOKEN_MINTS } from "./tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Shared swap executor — `swap` and `execute_swap` legacy tools were identical
// implementations with different descriptions. We keep both ids for prompt
// compatibility, but they share one body.
// ─────────────────────────────────────────────────────────────────────────────
const swapInputSchema = z.object({
  inputToken: z.string().describe("Token symbol to swap FROM"),
  outputToken: z.string().describe("Token symbol to swap TO"),
  amount: z.number().describe("Amount of inputToken to swap"),
  slippage: z
    .number()
    .optional()
    .default(0.5)
    .describe("Slippage tolerance %"),
});

async function runSwap(
  toolId: "swap" | "execute_swap",
  input: z.infer<typeof swapInputSchema>,
  ctx: import("./types").CapabilityContext,
) {
  const blocked = ctx.blockExecutionForBuildIntent(toolId);
  if (blocked) return blocked;

  const { inputToken, outputToken, amount, slippage } = input;
  console.log(`[capability:${toolId}] ${amount} ${inputToken} → ${outputToken}`);

  const inMint = resolveTokenMint(inputToken);
  const outMint = resolveTokenMint(outputToken);
  if (!inMint) {
    return {
      success: false,
      error: `Unknown input token: ${inputToken}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`,
    };
  }
  if (!outMint) {
    return {
      success: false,
      error: `Unknown output token: ${outputToken}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`,
    };
  }

  const decimals = tokenDecimals(inputToken);
  const coordinator = new ExecutionCoordinator(ctx.rpcEndpoint);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await coordinator.executeStrategy(
    "swap_token" as any,
    {
      inputMint: inMint,
      outputMint: outMint,
      inMint,
      outMint,
      amount: Math.floor(amount * Math.pow(10, decimals)),
      slippage: slippage ?? 0.5,
    },
    ctx.walletAddress || null,
  );

  if (result.success && result.result?.swap_result) {
    const sr = result.result.swap_result;
    const outDecimals = tokenDecimals(outputToken);
    const rawOut =
      typeof sr.outAmount === "string" ? sr.outAmount : String(sr.outAmount ?? "0");
    const outAmount = Number(rawOut) / Math.pow(10, outDecimals);
    const humanOut = outAmount.toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });

    // Record swap output so a follow-up "deposit/bridge the rest" can chain.
    ctx.executionState.lastSwap = {
      inputToken,
      outputToken,
      inputAmount: amount,
      outputAmount: outAmount,
    };
    ctx.executionState.splitFirstLegApplied = false;
    ctx.executionState.splitRemaining = outAmount;

    const serializedTransactions = result.result?.serializedTransactions;
    return {
      success: true,
      status: result.status,
      inputToken,
      outputToken,
      inputAmount: amount,
      outputAmount: outAmount,
      rawOutputAmount: sr.outAmount,
      outputAmountFormatted: `${humanOut} ${outputToken}`,
      priceImpact: sr.priceImpact,
      riskLevel: sr.riskLevel,
      simulationPassed: sr.simulationPassed,
      firewallChecks: sr.firewallChecks || {},
      requiresApproval: sr.requiresApproval,
      route: sr.instructions?.[0]?.pool || "Jupiter",
      executionId: result.executionId,
      duration: result.duration,
      ...(serializedTransactions?.length ? { serializedTransactions } : {}),
    };
  }

  return {
    success: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: result.errors?.map((e: any) => e.message).join("; ") || "Swap failed",
    executionId: result.executionId,
  };
}

const swap = defineCapability({
  id: "swap",
  domain: "trading",
  description: "Execute a token swap on Solana via Jupiter.",
  inputSchema: swapInputSchema,
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["jupiter"],
  execute: (input, ctx) => runSwap("swap", input, ctx),
});

const execute_swap = defineCapability({
  id: "execute_swap",
  domain: "trading",
  description:
    "Execute a token swap on Solana via Jupiter. Use this tool when the user wants to swap, convert, or trade one token for another (e.g. SOL to USDC, USDC to JUP).",
  inputSchema: swapInputSchema,
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["jupiter"],
  execute: (input, ctx) => runSwap("execute_swap", input, ctx),
});

// ─────────────────────────────────────────────────────────────────────────────
// Bridge — cross-chain via Rango Exchange. Cross-chain + irreversible →
// `sensitivity: "high"`. Risk-agent should always require HITL.
// ─────────────────────────────────────────────────────────────────────────────
const BRIDGE_CHAINS: Record<
  string,
  { rangoSlug: string; nativeSymbol: string; usdcAddress: string }
> = {
  solana: {
    rangoSlug: "SOLANA",
    nativeSymbol: "SOL",
    usdcAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  ethereum: {
    rangoSlug: "ETH",
    nativeSymbol: "ETH",
    usdcAddress: "0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48",
  },
  arbitrum: {
    rangoSlug: "ARBITRUM",
    nativeSymbol: "ETH",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  base: {
    rangoSlug: "BASE",
    nativeSymbol: "ETH",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  polygon: {
    rangoSlug: "POLYGON",
    nativeSymbol: "MATIC",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359",
  },
  bsc: {
    rangoSlug: "BSC",
    nativeSymbol: "BNB",
    usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  },
};
const CHAIN_ALIASES: Record<string, string> = {
  sol: "solana",
  eth: "ethereum",
  arb: "arbitrum",
  matic: "polygon",
  bnb: "bsc",
};

function resolveChain(c: string): string | null {
  const k = c.toLowerCase();
  if (BRIDGE_CHAINS[k]) return k;
  if (CHAIN_ALIASES[k] && BRIDGE_CHAINS[CHAIN_ALIASES[k]]) return CHAIN_ALIASES[k];
  return null;
}

function buildBridgeAsset(chain: string, sym: string): string {
  const cfg = BRIDGE_CHAINS[chain];
  const upper = sym.toUpperCase();
  if (upper === "USDC") return `${cfg.rangoSlug}.USDC--${cfg.usdcAddress}`;
  if (upper === cfg.nativeSymbol) return `${cfg.rangoSlug}.${cfg.nativeSymbol}`;
  const mint = resolveTokenMint(upper);
  return mint ? `${cfg.rangoSlug}.${upper}--${mint}` : `${cfg.rangoSlug}.${upper}`;
}

const bridge = defineCapability({
  id: "bridge",
  domain: "trading",
  description: "Bridge tokens between Solana and another chain.",
  inputSchema: z.object({
    token: z.string().describe("Token to bridge"),
    amount: z.number().describe("Amount to bridge"),
    sourceChain: z.string().optional().default("solana").describe("Source chain"),
    destinationChain: z.string().describe("Destination chain"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["rango"],
  execute: async (input, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("bridge");
    if (blocked) return blocked;

    const { token, amount, sourceChain, destinationChain } = input;
    const splitAmount = ctx.resolveSplitAmount(token, amount);
    const finalAmount = splitAmount.amount;
    console.log(
      `[capability:bridge] ${finalAmount} ${token}: ${sourceChain} → ${destinationChain}`,
    );

    const RANGO_API_KEY =
      process.env.RANGO_API_KEY || process.env.NEXT_PUBLIC_RANGO_API_KEY;
    if (!RANGO_API_KEY) {
      return {
        success: false,
        operation: "bridge",
        token,
        amount,
        sourceChain,
        destinationChain,
        error: "Bridge provider API key not configured.",
        message: "Bridge unavailable — RANGO_API_KEY not set.",
      };
    }

    const src = resolveChain(sourceChain);
    const dst = resolveChain(destinationChain);
    if (!src || !dst) {
      return {
        success: false,
        operation: "bridge",
        error: `Unsupported chain: ${!src ? sourceChain : destinationChain}. Supported: ${Object.keys(BRIDGE_CHAINS).join(", ")}`,
      };
    }

    try {
      const fromAsset = buildBridgeAsset(src, token);
      const toAsset = buildBridgeAsset(dst, token);
      const decimals = tokenDecimals(token);
      const rawAmount = String(Math.floor(finalAmount * Math.pow(10, decimals)));

      const qs = new URLSearchParams({
        apiKey: RANGO_API_KEY,
        from: fromAsset,
        to: toAsset,
        amount: rawAmount,
        slippage: "1.0",
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      let res: Response;
      if (ctx.walletAddress) {
        res = await fetch(`https://api.rango.exchange/basic/swap?${qs}`, {
          method: "POST",
          headers: {
            accept: "*/*",
            "x-api-key": RANGO_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userSettings: { slippage: "1.0" },
            validations: { balance: false, fee: false },
            fromAddress: ctx.walletAddress,
            toAddress: ctx.walletAddress,
          }),
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          // Fallback to quote (handles cross-chain address-format mismatches).
          res = await fetch(`https://api.rango.exchange/basic/quote?${qs}`, {
            headers: { accept: "*/*", "x-api-key": RANGO_API_KEY },
            cache: "no-store",
          });
        }
      } else {
        res = await fetch(`https://api.rango.exchange/basic/quote?${qs}`, {
          headers: { accept: "*/*", "x-api-key": RANGO_API_KEY },
          cache: "no-store",
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          success: false,
          operation: "bridge",
          token,
          amount,
          sourceChain: src,
          destinationChain: dst,
          error: `Rango ${res.status}: ${errText}`,
          message: `Bridge quote failed: ${res.statusText}`,
        };
      }
      const data = await res.json();
      const route =
        data?.route ||
        (Array.isArray(data?.routes) ? data.routes[0] : null) ||
        data?.bestRoute ||
        data;
      const outRaw = route?.outputAmount ?? data?.outputAmount ?? null;
      const outFormatted =
        outRaw != null
          ? `${(Number(outRaw) / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${token}`
          : null;

      const txData = data?.transaction?.data || data?.transaction || null;
      const serializedTransactions = txData
        ? [Buffer.from(txData).toString("base64")]
        : undefined;

      return {
        success: true,
        operation: "bridge",
        token,
        amount: finalAmount,
        sourceChain: src,
        destinationChain: dst,
        requestedAmount: amount,
        amountAdjusted: splitAmount.adjusted,
        amountAdjustmentReason: splitAmount.reason,
        provider: "Rango Exchange",
        bridge: route?.name || data?.path || "Rango",
        estimatedOutput: outRaw,
        estimatedOutputFormatted: outFormatted,
        estimatedTime:
          route?.estimatedTimeInSeconds ?? data?.estimatedTimeInSeconds
            ? `${route?.estimatedTimeInSeconds ?? data?.estimatedTimeInSeconds}s`
            : null,
        fees: route?.fee ?? data?.fee ?? null,
        steps: route?.steps ?? data?.steps ?? [],
        serializedTransactions,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        message: `Bridge ${finalAmount} ${token} from ${src} → ${dst} via Rango. Est. output: ${outFormatted || "N/A"}.${serializedTransactions ? " Transaction ready for signing." : " Connect wallet or check destination chain support."}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        operation: "bridge",
        token,
        amount,
        sourceChain: src,
        destinationChain: dst,
        error: msg,
        message: `Bridge quote failed: ${msg}`,
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Sniper bot — stages an active monitor; treated as `meta` because today the
// executor only allocates a botId. Bumped to `sensitivity: "medium"` because
// once wired up, it can autonomously execute buys.
// ─────────────────────────────────────────────────────────────────────────────
const deploy_sniper_bot = defineCapability({
  id: "deploy_sniper_bot",
  domain: "trading",
  description:
    "Deploy an active on-chain sniper bot to monitor DEXes and execute instant buys.",
  inputSchema: z.object({
    exchange: z.string().describe("DEX to watch (e.g., Raydium, Orca)"),
    liquidityThreshold: z
      .number()
      .optional()
      .describe("Minimum liquidity USD threshold for new pools"),
    maxSlippage: z
      .number()
      .optional()
      .describe("Maximum slippage tolerance %"),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["raydium", "orca"],
  execute: async (input, ctx) => {
    const { exchange, liquidityThreshold, maxSlippage } = input;
    console.log(
      `[capability:deploy_sniper_bot] watching ${exchange} (Liquidity > $${liquidityThreshold}, Slp: ${maxSlippage}%)`,
    );

    if (!ctx.walletAddress) {
      return {
        success: false,
        operation: "deploy_sniper_bot",
        error: "Wallet not connected",
        message:
          "Cannot deploy sniper bot. Please connect your wallet to authorize execution.",
      };
    }

    const botId = "bot_" + Math.random().toString(36).substring(2, 9);
    return {
      success: true,
      operation: "deploy_sniper_bot",
      exchange,
      liquidityThreshold,
      maxSlippage,
      botId,
      status: "ACTIVE",
      requiresApproval: true,
      message: `Sniper Bot [${botId}] successfully deployed to War Room. Monitoring ${exchange} for new liquidity pools > $${liquidityThreshold?.toLocaleString()}. Max Slippage set to ${maxSlippage}%. Ready to execute instant buys on detection.`,
    };
  },
});

export const tradingCapabilities: AnyCapability[] = [
  swap as AnyCapability,
  execute_swap as AnyCapability,
  bridge as AnyCapability,
  deploy_sniper_bot as AnyCapability,
];
