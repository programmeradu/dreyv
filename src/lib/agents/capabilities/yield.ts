/**
 * DACS Phase 0 — Yield domain capabilities.
 *
 * Migrated 1:1 from `src/app/api/command/route.ts`. Behavior is byte-for-byte
 * preserved; request-scope state flows through `CapabilityContext`.
 *
 * Capabilities in this module:
 *   - stake:           SOL liquid-staking via Marinade/Jito/BlazeStake/etc.
 *   - yield_deposit:   Deposit into Kamino/Meteora/etc. vault (LP via Jupiter)
 *   - yield_withdraw:  Withdraw from yield vault (Jupiter exact-out swap)
 *   - rebalance:       Rebalance treasury to target allocations
 *   - execute_dca:     Set up Jupiter DCA strategy
 *
 * All five are `sideEffects: "write"`. `rebalance` and `execute_dca` are
 * `sensitivity: "high"` (multi-tx + recurring respectively); the rest are
 * `medium`. Risk-agent uses `protocols` to enforce per-user allowlists.
 */

import { z } from "zod";
import { ExecutionCoordinator } from "@/lib/agents/coordinator";
import { getJupiterQuote } from "@/lib/jupiter-executor";
import { defineCapability, type AnyCapability } from "./types";
import { resolveTokenMint, tokenDecimals, TOKEN_MINTS } from "./tokens";
import { estimateUsdValue } from "./usd-pricing";
import { buildJupiterEarnDepositTx, earnApyPct, findJupiterEarnMarket } from "./jupiter-earn";

// ─────────────────────────────────────────────────────────────────────────────
// stake — delegates to ExecutionCoordinator's stake_sol strategy. Provider
// (marinade/jito/blazestake/msol) is a string passthrough.
// ─────────────────────────────────────────────────────────────────────────────
const stake = defineCapability({
  id: "stake",
  domain: "yield",
  description: "Stake SOL with a validator or liquid staking provider.",
  inputSchema: z.object({
    amount: z.number().describe("Amount of SOL to stake"),
    provider: z
      .string()
      .optional()
      .default("marinade")
      .describe("Staking provider (marinade, jito, blazestake, msol)"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["marinade", "jito", "blazestake"],
  execute: async (input, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("stake");
    if (blocked) return blocked;

    const { amount, provider } = input;
    const resolvedProvider = provider || "marinade";
    console.log(`[capability:stake] ${amount} SOL via ${resolvedProvider}`);

    const coordinator = new ExecutionCoordinator(ctx.rpcEndpoint);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await coordinator.executeStrategy(
      "stake_sol" as any,
      {
        amount: amount * 1e9,
        provider: resolvedProvider,
        wallet: ctx.walletAddress,
      },
      ctx.walletAddress || null,
    );
    const serializedTransactions: string[] =
      result.result?.serializedTransactions || [];
    return {
      success: result.success,
      operation: "stake",
      amount,
      provider: resolvedProvider,
      serializedTransactions:
        serializedTransactions.length > 0 ? serializedTransactions : undefined,
      status: result.status,
      executionId: result.executionId,
      requiresApproval: true,
      estimatedValueUsd: await estimateUsdValue("SOL", amount),
      message: `Stake ${amount} SOL via ${resolvedProvider}.${serializedTransactions.length > 0 ? " Transaction ready for signing." : " Connect wallet to build transaction."}`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// yield_deposit — discovers the highest-APY vault on Kamino/Meteora for the
// requested token, then builds a Jupiter swap into the vault's share mint as
// a single-sided deposit.
// ─────────────────────────────────────────────────────────────────────────────
interface VaultInfo {
  name: string;
  apy: number;
  tvl: number;
  token: string;
  address?: string;
  sharesMint?: string;
  builder?: "jupiter-earn" | "jupiter-swap" | "marinade";
}

const yield_deposit = defineCapability({
  id: "yield_deposit",
  domain: "yield",
  description: "Deposit tokens into a yield-generating vault/protocol.",
  inputSchema: z.preprocess((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    return {
      ...r,
      token: r.token ?? r.asset ?? r.symbol ?? r.inputToken,
      amount: r.amount ?? r.qty ?? r.quantity ?? r.size ?? 0,
      protocol: r.protocol ?? r.provider ?? r.venue ?? r.platform ?? "all",
    };
  }, z.object({
    token: z.string().describe("Token to deposit"),
    amount: z.coerce.number().default(0).describe(
      "Amount to deposit. Use 0 if the amount is 'the rest' or naturally calculated from a previous step.",
    ),
    protocol: z.string().default("all").describe("Protocol (kamino, meteora, marinade, raydium, jupiter, or 'all')"),
  })),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["kamino", "meteora", "marinade", "raydium", "jupiter"],
  execute: async (input, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("yield_deposit");
    if (blocked) return blocked;

    const { token, amount, protocol } = input;
    const splitAmount = ctx.resolveSplitAmount(token, amount);
    const finalAmount = splitAmount.amount;
    console.log(
      `[capability:yield_deposit] ${finalAmount} ${token} → ${protocol}`,
    );
    const proto = protocol.toLowerCase();

    let bestVault: VaultInfo | null = null;

    try {
      if (["jupiter", "jupiter earn", "jup", "earn", "kamino", "marginfi", "drift", "all"].includes(proto)) {
        const market = await findJupiterEarnMarket(token);
        if (market) {
          bestVault = {
            name: `Jupiter Earn ${market.asset?.uiSymbol || market.asset?.symbol || token}`,
            apy: earnApyPct(market),
            tvl: Number(market.totalAssets || 0) / Math.pow(10, market.asset?.decimals ?? tokenDecimals(token)),
            token,
            address: market.address,
            sharesMint: market.address,
            builder: "jupiter-earn",
          };
        }
      }

      if ((proto === "kamino" || proto === "all") && !bestVault) {
        const res = await fetch(
          "https://api.kamino.finance/strategies?status=LIVE",
          { signal: AbortSignal.timeout(8000) },
        );
        if (res.ok) {
          const strategies: Array<{
            address?: string;
            tokenASymbol?: string;
            tokenBSymbol?: string;
            apy?: number;
            tvl?: number;
            shareMintSymbol?: string;
            sharesMint?: string;
          }> = await res.json();
          const candidates = strategies
            .filter(
              (s) =>
                s.tokenASymbol?.toUpperCase() === token.toUpperCase() ||
                s.tokenBSymbol?.toUpperCase() === token.toUpperCase() ||
                s.shareMintSymbol?.toUpperCase() === token.toUpperCase(),
            )
            .sort((a, b) => (b.apy || 0) - (a.apy || 0));
          const match = candidates[0];
          if (match) {
            bestVault = {
              name: `Kamino ${match.shareMintSymbol || match.tokenASymbol}`,
              apy: (match.apy || 0) * 100,
              tvl: match.tvl || 0,
              token,
              address: match.address,
              sharesMint: match.sharesMint || match.address,
              builder: "jupiter-swap",
            };
          }
        }
      }
      if ((proto === "meteora" || proto === "all") && !bestVault) {
        const res = await fetch("https://dlmm-api.meteora.ag/pair/all", {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const pairs: Array<{
            address?: string;
            name?: string;
            mint_x?: string;
            mint_y?: string;
            apr?: number;
            liquidity?: number;
            trade_volume_24h?: number;
            lb_pair?: string;
          }> = await res.json();
          const mintLower = (resolveTokenMint(token) || "").toLowerCase();
          const match = pairs.find(
            (p) =>
              p.name?.toUpperCase().includes(token.toUpperCase()) ||
              p.mint_x?.toLowerCase() === mintLower ||
              p.mint_y?.toLowerCase() === mintLower,
          );
          if (match) {
            bestVault = {
              name: `Meteora ${match.name}`,
              apy: match.apr || 0,
              tvl: match.liquidity || 0,
              token,
              address: match.address,
              sharesMint: match.lb_pair || match.address,
              builder: "jupiter-swap",
            };
          }
        }
      }
    } catch (e) {
      console.error("[capability:yield_deposit] APY fetch error:", e);
    }

    if (bestVault) {
      let serializedTransactions: string[] | undefined = undefined;
      if (ctx.walletAddress && bestVault.sharesMint) {
        try {
          if (bestVault.builder === "jupiter-earn") {
            const built = await buildJupiterEarnDepositTx({ token, amount: finalAmount, signer: ctx.walletAddress });
            serializedTransactions = [built.transaction];
          } else {
          // Acquire vault share token (single-sided deposit) via Jupiter.
          const inputMint = resolveTokenMint(token);
          if (inputMint) {
            const outMint = bestVault.sharesMint;
            const decimals = tokenDecimals(token);
            const amountRaw = Math.floor(finalAmount * Math.pow(10, decimals));

            const quoteRes = await fetch(
              `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outMint}&amount=${amountRaw}&slippageBps=150`,
            );
            if (quoteRes.ok) {
              const quoteResponse = await quoteRes.json();
              if (!quoteResponse.error) {
                const swapRes = await fetch(
                  "https://quote-api.jup.ag/v6/swap",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      quoteResponse,
                      userPublicKey: ctx.walletAddress,
                      wrapAndUnwrapSol: true,
                    }),
                  },
                );
                if (swapRes.ok) {
                  const swapData = await swapRes.json();
                  if (swapData.swapTransaction) {
                    serializedTransactions = [swapData.swapTransaction];
                  }
                }
              }
            }
          }
          }
        } catch (txErr) {
          console.warn(
            "[capability:yield_deposit] Failed to build Jupiter deposit tx:",
            txErr,
          );
        }
      }

      return {
        success: true,
        operation: "yield_deposit",
        token,
        amount: finalAmount,
        protocol: proto,
        requestedAmount: amount,
        amountAdjusted: splitAmount.adjusted,
        amountAdjustmentReason: splitAmount.reason,
        vaultName: bestVault.name,
        vaultAddress: bestVault.address,
        sharesMint: bestVault.sharesMint,
        estimatedAPY: `${bestVault.apy.toFixed(2)}%`,
        tvl: `$${Math.round(bestVault.tvl).toLocaleString()}`,
        ...(serializedTransactions ? { serializedTransactions } : {}),
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        estimatedValueUsd: await estimateUsdValue(token, finalAmount),
        message: `Deposit ${finalAmount} ${token} into ${bestVault.name}. APY: ${bestVault.apy.toFixed(2)}%.${splitAmount.adjusted ? ` ${splitAmount.reason}` : ""}${serializedTransactions ? " Transaction ready for signing." : " Connect wallet."}`,
      };
    }

    return {
      success: false,
      operation: "yield_deposit",
      token,
      amount: finalAmount,
      protocol: proto,
      estimatedAPY: "N/A",
      status: "DISCOVERY_FAILED",
      requiresApproval: false,
      fallbackProtocols: ["jupiter earn", "kamino", "meteora"],
      message: `No live ${proto} yield market found for ${token}. Try Jupiter Earn for stables/SOL, or use a token with a live lending market.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// yield_withdraw — reverse of yield_deposit. Discover share mint for the
// requested token/protocol, then build a Jupiter ExactOut swap from share
// mint → token.
// ─────────────────────────────────────────────────────────────────────────────
const yield_withdraw = defineCapability({
  id: "yield_withdraw",
  domain: "yield",
  description: "Withdraw tokens from a yield vault/protocol.",
  inputSchema: z.object({
    token: z.string().describe("Token to withdraw"),
    amount: z.number().describe("Amount to withdraw"),
    protocol: z.string().describe("Protocol"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["kamino", "meteora", "jupiter"],
  execute: async (input, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("yield_withdraw");
    if (blocked) return blocked;

    const { token, amount, protocol } = input;
    console.log(
      `[capability:yield_withdraw] ${amount} ${token} from ${protocol}`,
    );
    const proto = protocol.toLowerCase();

    let vaultInfo: { name: string; address?: string; sharesMint?: string } | null =
      null;
    try {
      if (proto === "kamino" || proto === "all") {
        const res = await fetch(
          "https://api.kamino.finance/strategies?status=LIVE",
          { signal: AbortSignal.timeout(8000) },
        );
        if (res.ok) {
          const strategies: Array<{
            address?: string;
            tokenASymbol?: string;
            shareMintSymbol?: string;
            sharesMint?: string;
          }> = await res.json();
          const match = strategies.find(
            (s) =>
              s.tokenASymbol?.toUpperCase() === token.toUpperCase() ||
              s.shareMintSymbol?.toUpperCase() === token.toUpperCase(),
          );
          if (match) {
            vaultInfo = {
              name: `Kamino ${match.shareMintSymbol || match.tokenASymbol}`,
              address: match.address,
              sharesMint: match.sharesMint || match.address,
            };
          }
        }
      }
      if ((proto === "meteora" || proto === "all") && !vaultInfo) {
        const res = await fetch("https://dlmm-api.meteora.ag/pair/all", {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const pairs: Array<{
            address?: string;
            name?: string;
            mint_x?: string;
            mint_y?: string;
            lb_pair?: string;
          }> = await res.json();
          const match = pairs.find((p) =>
            p.name?.toUpperCase().includes(token.toUpperCase()),
          );
          if (match) {
            vaultInfo = {
              name: `Meteora ${match.name}`,
              address: match.address,
              sharesMint: match.lb_pair || match.address,
            };
          }
        }
      }
    } catch (e) {
      console.error("[capability:yield_withdraw] vault lookup error:", e);
    }

    let serializedTransactions: string[] | undefined = undefined;
    let withdrawMessage = vaultInfo
      ? `Withdraw ${amount} ${token} from ${vaultInfo.name} prepared. Connect wallet to build transaction.`
      : `Withdraw ${amount} ${token} from ${proto} prepared. Vault address not resolved — provide manually.`;

    if (ctx.walletAddress && vaultInfo?.sharesMint) {
      try {
        const outMint = resolveTokenMint(token);
        const inMint = vaultInfo.sharesMint; // Reverse of deposit.
        if (outMint && inMint) {
          // Use Jupiter ExactOut so we redeem precisely the requested amount.
          const decimals = tokenDecimals(token);
          const amountRaw = Math.floor(amount * Math.pow(10, decimals));

          const quoteRes = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amountRaw}&swapMode=ExactOut&slippageBps=150`,
          );
          if (quoteRes.ok) {
            const quoteResponse = await quoteRes.json();
            if (!quoteResponse.error) {
              const swapRes = await fetch(
                "https://quote-api.jup.ag/v6/swap",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    quoteResponse,
                    userPublicKey: ctx.walletAddress,
                    wrapAndUnwrapSol: true,
                  }),
                },
              );
              if (swapRes.ok) {
                const swapData = await swapRes.json();
                if (swapData.swapTransaction) {
                  serializedTransactions = [swapData.swapTransaction];
                  withdrawMessage = `Withdraw ${amount} ${token} from ${vaultInfo.name}. Transaction ready for signing.`;
                }
              }
            } else {
              console.warn(
                "[capability:yield_withdraw] Quote error:",
                quoteResponse.error,
              );
              withdrawMessage = `Withdraw ${amount} ${token} from ${vaultInfo.name} failed generating tx: ${quoteResponse.error}`;
            }
          }
        }
      } catch (txErr) {
        console.warn(
          "[capability:yield_withdraw] Failed to build Jupiter withdraw tx:",
          txErr,
        );
      }
    }

    return {
      success: true,
      operation: "yield_withdraw",
      token,
      amount,
      protocol: proto,
      vaultName: vaultInfo?.name || `${proto} vault`,
      vaultAddress: vaultInfo?.address || null,
      ...(serializedTransactions ? { serializedTransactions } : {}),
      status: "READY_FOR_SIGNATURE",
      requiresApproval: true,
      estimatedValueUsd: await estimateUsdValue(token, amount),
      message: withdrawMessage,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// rebalance — multi-trade portfolio rebalance via ExecutionCoordinator's
// rebalance_portfolio strategy. High sensitivity (multi-tx, irreversible).
// ─────────────────────────────────────────────────────────────────────────────
const rebalance = defineCapability({
  id: "rebalance",
  domain: "yield",
  description:
    "Rebalance treasury portfolio to target allocations. If targetAllocations is omitted or empty, auto-analyzes portfolio and generates smart diversification targets.",
  inputSchema: z.object({
    targetAllocations: z
      .array(z.object({ token: z.string(), percentage: z.number() }))
      .optional()
      .default([])
      .describe("Target portfolio split. Leave empty for smart auto-rebalance."),
    tolerance: z
      .number()
      .optional()
      .default(5)
      .describe("Tolerance % before rebalance triggers"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["jupiter"],
  execute: async (input, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("rebalance");
    if (blocked) return blocked;

    const { targetAllocations, tolerance } = input;
    console.log(
      `[capability:rebalance] Targets: ${JSON.stringify(targetAllocations)}, tolerance: ${tolerance}%`,
    );

    if (!ctx.walletAddress) {
      return {
        success: false,
        operation: "rebalance",
        targetAllocations,
        tolerance,
        trades: [],
        tradeCount: 0,
        message:
          "Wallet not connected. Connect your wallet to rebalance your portfolio.",
      };
    }

    const holdings = ctx.vaultState?.tokens || ctx.walletState?.balances || [];
    const portfolioValue = Array.isArray(holdings)
      ? holdings.reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sum: number, t: any) =>
            sum + ((t.amount || 0) * (t.price || 0) || t.usdValue || 0),
          0,
        )
      : 0;
    if (portfolioValue === 0) {
      return {
        success: false,
        operation: "rebalance",
        targetAllocations,
        tolerance,
        trades: [],
        tradeCount: 0,
        message:
          "Portfolio balance is $0. Fund your wallet with tokens before rebalancing.",
      };
    }

    const coordinator = new ExecutionCoordinator(ctx.rpcEndpoint);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await coordinator.executeStrategy(
      "rebalance_portfolio" as any,
      {
        targetAllocations,
        tolerance: tolerance || 5,
        currentHoldings: holdings,
        wallet: ctx.walletAddress,
      },
      ctx.walletAddress || null,
    );

    const trades = result.result?.trades || [];
    const rebalancePreview = result.result?.rebalancePreview || null;
    const serializedTransactions: string[] =
      result.result?.serializedTransactions || [];

    if (!result.success) {
      const errMsg = result.errors?.[0]?.message || "Rebalance strategy failed.";
      return {
        success: false,
        operation: "rebalance",
        targetAllocations,
        tolerance,
        trades: [],
        tradeCount: 0,
        status: result.status,
        executionId: result.executionId,
        message: errMsg,
      };
    }

    const isMultiTx = serializedTransactions.length > 1;
    return {
      success: true,
      operation: "rebalance",
      targetAllocations,
      tolerance,
      trades,
      rebalancePreview,
      tradeCount: trades.length,
      serializedTransactions:
        serializedTransactions.length > 0 ? serializedTransactions : undefined,
      // Multi-leg rebalance must be atomic — partial execution leaves the
      // portfolio further from target than the start state.
      bundleStrategy: isMultiTx ? "atomic" : "sequential",
      bundleReason: isMultiTx
        ? "Rebalance is atomic — all legs land in the same slot or none do."
        : undefined,
      status: result.status,
      executionId: result.executionId,
      requiresApproval: true,
      message: `Dry-run rebalance preview: ${trades.length} proposed trade${trades.length === 1 ? "" : "s"}.${
        serializedTransactions.length > 0
          ? isMultiTx
            ? ` One wallet popup signs all ${serializedTransactions.length} txs as an atomic bundle.`
            : ` Review the projected concentration, then sign 1 transaction if approved.`
          : " Connect wallet to build transactions."
      }`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// execute_dca — recurring buy via Jupiter DCA API. Recurring → high sensitivity.
// ─────────────────────────────────────────────────────────────────────────────
const FREQ_SECONDS: Record<string, number> = {
  hourly: 3600,
  daily: 86400,
  weekly: 604800,
  biweekly: 1209600,
  monthly: 2592000,
};

const execute_dca = defineCapability({
  id: "execute_dca",
  domain: "yield",
  description: "Set up a Dollar-Cost Averaging (DCA) strategy.",
  inputSchema: z.object({
    inputToken: z.string().describe("Token to sell"),
    outputToken: z.string().describe("Token to buy"),
    totalAmount: z.number().describe("Total amount to DCA"),
    frequency: z.string().describe("Frequency (hourly, daily, weekly)"),
    iterations: z.number().describe("Number of execution cycles"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["jupiter-dca"],
  execute: async (input, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("execute_dca");
    if (blocked) return blocked;

    const { inputToken, outputToken, totalAmount, frequency, iterations } = input;
    console.log(
      `[capability:execute_dca] ${totalAmount} ${inputToken} → ${outputToken} over ${iterations} ${frequency} cycles`,
    );

    if (iterations <= 0) {
      return {
        success: false,
        operation: "execute_dca",
        error: "iterations must be greater than 0",
      };
    }
    const perCycle = totalAmount / iterations;

    const inMint = resolveTokenMint(inputToken);
    const outMint = resolveTokenMint(outputToken);
    if (!inMint || !outMint) {
      return {
        success: false,
        operation: "execute_dca",
        error: `Unknown token: ${!inMint ? inputToken : outputToken}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`,
      };
    }

    const cycleSeconds = FREQ_SECONDS[frequency.toLowerCase()] || 86400;
    const decimals = ["USDC", "USDT"].includes(inputToken.toUpperCase()) ? 6 : 9;
    const inAmountPerCycle = Math.floor(perCycle * Math.pow(10, decimals));

    let firstQuote: {
      outAmount?: string;
      priceImpactPct?: string;
      slippageBps?: number;
    } | null = null;
    try {
      const quote = await getJupiterQuote(inMint, outMint, inAmountPerCycle, 100);
      if (quote) {
        firstQuote = {
          outAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          slippageBps: quote.slippageBps,
        };
      }
    } catch {
      /* informational only */
    }

    const totalDuration = cycleSeconds * iterations;
    const durationLabel =
      totalDuration >= 2592000
        ? `${Math.round(totalDuration / 2592000)}mo`
        : totalDuration >= 604800
          ? `${Math.round(totalDuration / 604800)}wk`
          : `${Math.round(totalDuration / 86400)}d`;

    let dcaTransaction: string | null = null;
    let dcaError: string | null = null;
    let dcaRequestId: string | null = null;

    if (ctx.walletAddress) {
      try {
        const totalInAmountRaw = Math.floor(totalAmount * Math.pow(10, decimals));
        // Jupiter Recurring API (replaces deprecated dca-api.jup.ag).
        // Time-based: amount/cycle = inAmount / numberOfOrders, run every `interval` seconds.
        const recurringHeaders: Record<string, string> = { "Content-Type": "application/json" };
        const jupKey = process.env.NEXT_PUBLIC_JUPITER_API_KEY || process.env.JUPITER_API_KEY;
        if (jupKey) recurringHeaders["x-api-key"] = jupKey;
        const recurringHost = jupKey
          ? "https://api.jup.ag/recurring/v1/createOrder"
          : "https://lite-api.jup.ag/recurring/v1/createOrder";
        const dcaRes = await fetch(recurringHost, {
          method: "POST",
          headers: recurringHeaders,
          body: JSON.stringify({
            user: ctx.walletAddress,
            inputMint: inMint,
            outputMint: outMint,
            params: {
              time: {
                inAmount: totalInAmountRaw,
                numberOfOrders: iterations,
                interval: cycleSeconds,
                minPrice: null,
                maxPrice: null,
                startAt: null,
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (dcaRes.ok) {
          const dcaData = (await dcaRes.json()) as { transaction?: string; requestId?: string };
          if (dcaData.transaction) {
            dcaTransaction = dcaData.transaction;
            dcaRequestId = dcaData.requestId ?? null;
          }
        } else {
          dcaError = (await dcaRes.text()).slice(0, 300);
          console.warn("[capability:execute_dca] Recurring API error:", dcaError);
        }
      } catch (e: unknown) {
        dcaError = e instanceof Error ? e.message : String(e);
        console.warn("[capability:execute_dca] Recurring API call failed:", dcaError);
      }
    }

    const outDecimals = ["USDC", "USDT"].includes(outputToken.toUpperCase()) ? 6 : 9;
    const estOutput = firstQuote?.outAmount
      ? parseFloat(firstQuote.outAmount) / Math.pow(10, outDecimals)
      : null;

    return {
      success: true,
      operation: "execute_dca",
      inputToken,
      outputToken,
      totalAmount,
      frequency,
      iterations,
      inputMint: inMint,
      outputMint: outMint,
      amountPerCycle: perCycle,
      amountPerCycleRaw: inAmountPerCycle,
      cycleFrequencySeconds: cycleSeconds,
      totalDuration: durationLabel,
      estimatedOutputPerCycle: estOutput,
      priceImpact: firstQuote?.priceImpactPct || null,
      serializedTransaction: dcaTransaction || undefined,
      dcaRequestId: dcaRequestId || undefined,
      dcaApiError: dcaError || undefined,
      status: dcaTransaction ? "READY_FOR_SIGNATURE" : "READY_FOR_ACTIVATION",
      requiresApproval: true,
      message: `DCA Strategy: ${totalAmount} ${inputToken} → ${outputToken} over ${durationLabel} (${iterations} × ${perCycle} ${inputToken} ${frequency}).${estOutput ? ` Est. output/cycle: ~${estOutput.toFixed(4)} ${outputToken}.` : ""}${dcaTransaction ? " Transaction ready for signing." : dcaError ? ` DCA setup deferred: ${dcaError.slice(0, 100)}` : " Connect wallet to create on-chain DCA order."}`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// dca_opportunities — READ-ONLY scanner. Surfaces DCA entry candidates
// based on current 24h drawdown vs the user's holdings. No execution,
// no fabricated burn/runway math — pure market read.
// ─────────────────────────────────────────────────────────────────────
const dca_opportunities = defineCapability({
  id: "dca_opportunities",
  domain: "yield",
  description:
    "Discover DCA (dollar-cost averaging) entry opportunities based on the CURRENT market — today's drawdowns, drift from the user's target allocation, and stables available to deploy. " +
    "Use for prompts like 'show me DCA opportunities', 'where should I DCA today', 'best entry based on SOL drawdown'. " +
    "Read-only: does NOT set up an order (use execute_dca) and does NOT project runway (use foresight_simulation).",
  inputSchema: z.object({
    focusToken: z.string().optional().describe("Optional symbol the user is anchoring on (e.g. 'SOL'). Otherwise scans the whole portfolio."),
    drawdownThresholdPct: z.number().optional().default(3).describe("Minimum 24h drawdown (in %) to qualify as a candidate. Default 3."),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async (input, ctx) => {
    const { focusToken, drawdownThresholdPct = 3 } = input as { focusToken?: string; drawdownThresholdPct?: number };
    const tokenSource = ctx.vaultState?.tokens || ctx.walletState?.balances;
    const tokens: Array<{ symbol?: string; amount?: number; price?: number; change24h?: number; isStable?: boolean }> =
      Array.isArray(tokenSource) ? (tokenSource as any) : [];

    if (tokens.length === 0) {
      return {
        success: false,
        operation: "dca_opportunities",
        message: "No holdings detected. Connect a wallet so I can scan today's drawdowns against your portfolio.",
        clarifyChips: [{ id: "connect", label: "Connect a wallet", suggestPrompt: "Connect my treasury wallet" }],
        needsClarify: true,
      };
    }

    const STABLES = new Set(["USDC", "USDT", "USDS", "PYUSD", "DAI", "USDH"]);
    const stableUsd = tokens
      .filter((t) => STABLES.has(String(t.symbol ?? "").toUpperCase()) || t.isStable)
      .reduce((s, t) => s + (t.amount ?? 0) * (t.price ?? 0), 0);

    const candidates = tokens
      .filter((t) => {
        const sym = String(t.symbol ?? "").toUpperCase();
        if (!sym || STABLES.has(sym) || t.isStable) return false;
        if (focusToken && sym !== focusToken.toUpperCase()) return false;
        const ch = typeof t.change24h === "number" ? t.change24h : 0;
        return ch <= -Math.abs(drawdownThresholdPct);
      })
      .map((t) => ({
        symbol: String(t.symbol).toUpperCase(),
        currentPrice: t.price ?? 0,
        change24hPct: t.change24h ?? 0,
        currentHoldingUsd: (t.amount ?? 0) * (t.price ?? 0),
      }))
      .sort((a, b) => a.change24hPct - b.change24hPct);

    if (candidates.length === 0) {
      return {
        success: true,
        operation: "dca_opportunities",
        dataSource: "live",
        stableUsd,
        candidates: [],
        message: focusToken
          ? `${focusToken.toUpperCase()} is not drawn down ≥${drawdownThresholdPct}% today — no DCA edge right now.`
          : `Nothing in your portfolio is drawn down ≥${drawdownThresholdPct}% in the last 24h.`,
        suggestions: [
          { id: "lower", label: `Scan at ≥1% drawdown`, suggestPrompt: `Show me DCA opportunities at ≥1% drawdown` },
          { id: "focus-sol", label: `Focus on SOL`, suggestPrompt: `DCA opportunities for SOL` },
        ],
      };
    }

    return {
      success: true,
      operation: "dca_opportunities",
      dataSource: "live",
      stableUsd,
      candidates,
      message:
        `Found ${candidates.length} DCA candidate${candidates.length === 1 ? "" : "s"} (≥${drawdownThresholdPct}% 24h drawdown). ` +
        `$${Math.round(stableUsd).toLocaleString()} in stables available. ` +
        `Top: ${candidates.slice(0, 3).map((c) => `${c.symbol} ${c.change24hPct.toFixed(1)}%`).join(", ")}.`,
      suggestions: candidates.slice(0, 3).map((c) => ({
        id: `dca-${c.symbol}`,
        label: `Set up DCA into ${c.symbol}`,
        suggestPrompt: `Set up a DCA from USDC into ${c.symbol}`,
      })),
    };
  },
});

export const yieldCapabilities: AnyCapability[] = [
  stake as AnyCapability,
  yield_deposit as AnyCapability,
  yield_withdraw as AnyCapability,
  rebalance as AnyCapability,
  execute_dca as AnyCapability,
  dca_opportunities as AnyCapability,
];
