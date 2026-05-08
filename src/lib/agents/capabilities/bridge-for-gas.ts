/**
 * D1 — Detect insufficient native token on EVM for typical txs and surface
 * a read-only Rango bridge quote (existing /api/bridge/quote) so the agent
 * can propose funding gas without native EVM execution.
 */
import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { getSiteOrigin } from "@/lib/seo/site";

type EvmChain = "ethereum" | "base" | "arbitrum" | "polygon" | "bsc";

const EVM_CHAIN_IDS: Record<number, EvmChain> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  137: "polygon",
  56: "bsc",
};

const RPC: Record<EvmChain, string> = {
  ethereum: "https://ethereum.publicnode.com",
  base: "https://base.publicnode.com",
  arbitrum: "https://arbitrum.publicnode.com",
  polygon: "https://polygon-bor.publicnode.com",
  bsc: "https://bsc.publicnode.com",
};

/** Native token symbol expected by /api/bridge/quote */
function nativeSymbol(chain: EvmChain): "ETH" | "MATIC" | "BNB" {
  if (chain === "polygon") return "MATIC";
  if (chain === "bsc") return "BNB";
  return "ETH";
}

/** Prefer deep USDC liquidity on L1 as the funding source. */
function defaultFromChain(target: EvmChain): EvmChain {
  if (target === "ethereum") return "base";
  return "ethereum";
}

async function rpcCall(chain: EvmChain, method: string, params: unknown[]): Promise<unknown | null> {
  try {
    const res = await fetch(RPC[chain], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    if (!j || j.error) return null;
    return j.result;
  } catch {
    return null;
  }
}

function hexToBigInt(hex: string | null | undefined): bigint {
  if (!hex || typeof hex !== "string") return BigInt(0);
  try {
    return BigInt(hex);
  } catch {
    return BigInt(0);
  }
}

const bridge_for_gas = defineCapability({
  id: "bridge_for_gas",
  domain: "trading",
  description:
    "EVM-only helper: if native gas balance is too low for ~1–2 typical contract interactions, returns a Rango bridge quote from a liquid chain (USDC → native) so the user can fund gas. No on-chain execution.",
  inputSchema: z.object({
    evmAddress: z.string().optional().describe("0x-prefixed wallet; defaults to context wallet when on EVM"),
    targetChain: z.enum(["ethereum", "base", "arbitrum", "polygon", "bsc"]).optional(),
    /** Optional override for required native wei (e.g. a specific tx estimate). */
    requiredNativeWei: z.string().optional(),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["evm"],
  protocols: ["rango"],
  execute: async (input, ctx) => {
    const chainFromCtx = ctx.chainId != null ? EVM_CHAIN_IDS[ctx.chainId] : undefined;
    const targetChain = input.targetChain ?? chainFromCtx ?? "ethereum";
    const addrRaw = (input.evmAddress ?? ctx.walletAddress ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/i.test(addrRaw)) {
      return {
        success: false,
        operation: "bridge_for_gas",
        message:
          "Connect or link an EVM wallet, or pass evmAddress, so we can check native gas balances.",
      };
    }
    const evmAddress = addrRaw.toLowerCase();

    const balHex = (await rpcCall(targetChain, "eth_getBalance", [evmAddress, "latest"])) as string | null;
    const balanceWei = hexToBigInt(balHex ?? undefined);

    const gasHex = (await rpcCall(targetChain, "eth_gasPrice", [])) as string | null;
    const gasPriceWei =
      hexToBigInt(gasHex ?? undefined) || BigInt(1_000_000_000);

    const parsedOverride = input.requiredNativeWei ? hexToBigInt(input.requiredNativeWei) : BigInt(0);
    const defaultNeed = gasPriceWei * BigInt(350_000);
    const requiredWei = parsedOverride > BigInt(0) ? parsedOverride : defaultNeed;
    const cushion = (requiredWei * BigInt(12)) / BigInt(10);

    if (balanceWei >= cushion) {
      return {
        success: true,
        operation: "bridge_for_gas",
        sufficient: true,
        targetChain,
        evmAddress,
        balanceWei: balanceWei.toString(),
        requiredWeiApprox: requiredWei.toString(),
        message: `Native balance looks sufficient for typical operations on ${targetChain} (~${requiredWei.toString()} wei buffer vs gas price).`,
      };
    }

    const fromChain = defaultFromChain(targetChain);
    const toTok = nativeSymbol(targetChain);
    const fromAmount = "5000000"; // 5 USDC (6 decimals) — small top-up quote

    const origin = getSiteOrigin();
    const quoteUrl = `${origin}/api/bridge/quote?fromChain=${fromChain}&toChain=${targetChain}&fromToken=USDC&toToken=${toTok}&fromAmount=${fromAmount}`;

    let quote: Record<string, unknown> | null = null;
    try {
      const res = await fetch(quoteUrl, { cache: "no-store" });
      if (res.ok) {
        quote = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      }
    } catch {
      quote = null;
    }

    const data = quote?.data as Record<string, unknown> | undefined;
    return {
      success: true,
      operation: "bridge_for_gas",
      sufficient: false,
      targetChain,
      evmAddress,
      balanceWei: balanceWei.toString(),
      gasPriceWei: gasPriceWei.toString(),
      requiredWeiApprox: requiredWei.toString(),
      proposal: {
        summary: `Low native gas on ${targetChain}. Bridge ~5 USDC from ${fromChain} into ${toTok} via Rango.`,
        quoteUrl,
        fromChain,
        toChain: targetChain,
        fromToken: "USDC",
        toToken: toTok,
        fromAmount,
      },
      quotePreview: data ?? quote?.error ?? null,
      message: `Native balance (${balanceWei.toString()} wei) is below a safe buffer for ${targetChain}. Here's a live Rango quote to top up gas from ${fromChain} USDC.`,
    };
  },
});

export const bridgeForGasCapabilities: AnyCapability[] = [bridge_for_gas];
