/**
 * Phase 1 capability handlers.
 *
 * Each handler is a thin adapter: it calls an already-shipped internal API
 * route (with proper origin) or a library function, normalizes the response
 * shape, and lets the registry/dispatcher handle auth, scopes, rate limit,
 * metering, and transport.
 *
 * No business logic is re-implemented here — Pillars A/B/C are wrappers on
 * existing endpoints. Pillars D/E/F/G land in Phase 2/3.
 */

import type { CapabilityRunContext } from "./registry";
import { db } from "@/db";
import { agentTreasuryWatchers, monitors, notifications } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

// ─── internal helpers ────────────────────────────────────────────────
async function callInternal<T = unknown>(
  ctx: CapabilityRunContext,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${ctx.origin}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-dreyv-internal": "1",
      "x-dreyv-key-id": ctx.keyId,
      "x-dreyv-user-id": ctx.userId,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : null) ?? `Upstream ${res.status} for ${path}`;
    throw new CapabilityError(message, res.status, body);
  }
  return body as T;
}

export class CapabilityError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ─── Pillar A — Identity ─────────────────────────────────────────────
export async function identityResolve(
  input: { identifier: string },
  ctx: CapabilityRunContext,
) {
  const id = input.identifier.trim();
  if (/\.eth$/i.test(id)) {
    const ens = await callInternal<{ data?: { address?: string; name?: string; avatar?: string } }>(
      ctx,
      `/api/ens/resolve?name=${encodeURIComponent(id)}`,
    );
    const addr = ens?.data?.address;
    if (!addr) {
      throw new CapabilityError(`ENS name '${id}' did not resolve to an address`, 404, ens);
    }
    return {
      resolved: true,
      identifier: id,
      address: addr,
      namespace: "ens",
      name: ens.data?.name ?? id,
      avatar: ens.data?.avatar ?? null,
    };
  }
  return await callInternal<Record<string, unknown>>(
    ctx,
    `/api/public/resolve/${encodeURIComponent(id)}`,
  );
}

export async function walletMeta(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain !== "solana") {
    const evm = await callInternal(ctx, `/api/evm/holdings?address=${input.address}&chain=${input.chain}`);
    return { address: input.address, chain: input.chain, holdings: evm, classification: "eoa", source: "evm.holdings" };
  }
  const activity = await callInternal(ctx, `/api/public/activity/${input.address}?limit=1`);
  return { address: input.address, chain: input.chain, activity, classification: "eoa", source: "public.activity" };
}

export async function identityProfile(
  input: { identifier: string },
  ctx: CapabilityRunContext,
) {
  const resolved = await identityResolve({ identifier: input.identifier }, ctx) as Record<string, unknown>;
  const address = (resolved.address as string | undefined) ?? input.identifier;
  const counterparties = await callInternal(ctx, `/api/public/counterparties/${address}?limit=10`);
  return { identity: resolved, counterparties };
}

// ─── Pillar B — Portfolio & Treasury ─────────────────────────────────
export async function portfolioHoldings(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain === "solana") {
    return await callInternal(ctx, `/api/helius/das/wallet-holdings?address=${input.address}`);
  }
  return await callInternal(ctx, `/api/evm/holdings?address=${input.address}&chain=${input.chain}`);
}

export async function portfolioPnl(
  input: { address: string; method: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/public/pnl/${input.address}?method=${input.method}`);
}

export async function defiPositions(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  const holdings = (await portfolioHoldings(input, ctx)) as {
    tokens?: Array<Record<string, unknown>>;
    holdings?: Array<Record<string, unknown>>;
  };
  const tokens = Array.isArray(holdings.tokens)
    ? holdings.tokens
    : Array.isArray(holdings.holdings)
      ? holdings.holdings
      : [];
  const positions = tokens.filter((t) => {
    const tags = Array.isArray((t as { tags?: unknown[] }).tags) ? (t as { tags: string[] }).tags : [];
    const sym = String((t as { symbol?: string }).symbol ?? "").toUpperCase();
    return tags.includes("defi") || /^(MSOL|JITOSOL|JLP|KMNO|JTO|JUP|MNDE|BSOL|INF)$/.test(sym);
  });
  return { address: input.address, chain: input.chain, count: positions.length, positions };
}

export async function treasuryHealth(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  const holdings = (await portfolioHoldings(input, ctx)) as {
    tokens?: Array<{ symbol?: string; valueUsd?: number; usdValue?: number }>;
    holdings?: Array<{ symbol?: string; valueUsd?: number; usdValue?: number }>;
    totalValueUsd?: number;
  };
  const tokens = holdings.tokens ?? holdings.holdings ?? [];
  const totalUsd =
    holdings.totalValueUsd ??
    tokens.reduce((sum, t) => sum + (Number(t.valueUsd ?? t.usdValue ?? 0) || 0), 0);
  const stableSyms = new Set(["USDC", "USDT", "PYUSD", "DAI", "USDE"]);
  const stableUsd = tokens
    .filter((t) => stableSyms.has(String(t.symbol ?? "").toUpperCase()))
    .reduce((s, t) => s + (Number(t.valueUsd ?? t.usdValue ?? 0) || 0), 0);
  const sorted = [...tokens].sort(
    (a, b) => (Number(b.valueUsd ?? b.usdValue ?? 0) || 0) - (Number(a.valueUsd ?? a.usdValue ?? 0) || 0),
  );
  const topConcentration = sorted[0]
    ? (Number(sorted[0].valueUsd ?? sorted[0].usdValue ?? 0) || 0) / Math.max(totalUsd, 1)
    : 0;
  return {
    address: input.address,
    chain: input.chain,
    totalValueUsd: totalUsd,
    stableRatio: totalUsd > 0 ? stableUsd / totalUsd : 0,
    topHoldingConcentration: topConcentration,
    distinctAssets: tokens.length,
    runwayMonths: null,
    diversificationScore: tokens.length === 0 ? 0 : Math.min(1, tokens.length / 12),
  };
}

export async function multisigPending(
  input: { multisigAddress: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/squads/proposals?multisig=${input.multisigAddress}&status=active`);
}

// ─── Pillar C — Market & Discovery ───────────────────────────────────
// Common Solana symbol → mint map for ergonomics. Mints pass straight through.
const SOLANA_SYMBOL_TO_MINT: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  JLP: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
  KMNO: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
  PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
};

function resolveSolanaToken(token: string): string {
  const t = token.trim();
  if (t.length >= 32) return t;
  const mapped = SOLANA_SYMBOL_TO_MINT[t.toUpperCase()];
  if (!mapped) {
    throw new CapabilityError(
      `Unknown Solana symbol '${token}'. Pass a mint address or one of: ${Object.keys(SOLANA_SYMBOL_TO_MINT).join(", ")}`,
      400,
      { token },
    );
  }
  return mapped;
}

export async function marketPrice(
  input: { token: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain === "solana") {
    const mint = resolveSolanaToken(input.token);
    return await callInternal(ctx, `/api/public/token/${encodeURIComponent(mint)}`);
  }
  return await callInternal(ctx, `/api/token-metadata?symbol=${encodeURIComponent(input.token)}&chain=${input.chain}`);
}

export async function marketOhlcv(
  input: { token: string; chain: string; interval: string; limit: number },
  ctx: CapabilityRunContext,
) {
  const tokenKey = input.chain === "solana" ? resolveSolanaToken(input.token) : input.token;
  return await callInternal(
    ctx,
    `/api/public/performance/${encodeURIComponent(tokenKey)}?interval=${input.interval}&limit=${input.limit}`,
  );
}

export async function tokenForensics(
  input: { mintOrAddress: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain === "solana") {
    const mint = resolveSolanaToken(input.mintOrAddress);
    return await callInternal(ctx, `/api/solana/rug-check?mint=${mint}`);
  }
  return await callInternal(ctx, `/api/public/risk/${input.mintOrAddress}?chain=${input.chain}`);
}

export async function defiYields(
  input: { asset?: string; chain?: string; minTvlUsd: number; limit: number },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams();
  if (input.asset) qs.set("asset", input.asset);
  if (input.chain) qs.set("chain", input.chain);
  const raw = await callInternal<{ pools?: unknown[]; data?: unknown[] }>(ctx, `/api/yields?${qs.toString()}`);
  const pools = (raw.pools ?? raw.data ?? []) as Array<Record<string, unknown>>;
  const filtered = pools
    .filter((p) => Number(p.tvlUsd ?? 0) >= input.minTvlUsd)
    .slice(0, input.limit);
  return { count: filtered.length, pools: filtered };
}


// ═══════════════════════════════════════════════════════════════════════
// PHASE 2 — Execution, Risk, Tax, Forensics, Foresight, Market signals
// All handlers are thin adapters over real, already-shipped internal routes.
// No fallbacks: if upstream fails, the real error propagates.
// ═══════════════════════════════════════════════════════════════════════

// ─── Pillar D — Swap / Bridge / Gas ──────────────────────────────────
export async function swapQuoteSolana(
  input: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
    onlyDirectRoutes?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const inMint = resolveSolanaToken(input.inputMint);
  const outMint = resolveSolanaToken(input.outputMint);
  const qs = new URLSearchParams({
    inputMint: inMint,
    outputMint: outMint,
    amount: String(input.amount),
  });
  if (input.slippageBps != null) qs.set("slippageBps", String(input.slippageBps));
  if (input.onlyDirectRoutes) qs.set("onlyDirectRoutes", "true");
  return await callInternal(ctx, `/api/jupiter/quote?${qs.toString()}`);
}

export async function swapBuildSolana(
  input: { quoteResponse: unknown; userPublicKey: string; wrapAndUnwrapSol?: boolean },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/jupiter/swap`, {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: input.quoteResponse,
      userPublicKey: input.userPublicKey,
      wrapAndUnwrapSol: input.wrapAndUnwrapSol ?? true,
    }),
  });
}

export async function swapQuoteEvm(
  input: { sellToken: string; buyToken: string; sellAmount: string; chainId: number },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams({
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: String(input.sellAmount),
    chainId: String(input.chainId),
  });
  return await callInternal(ctx, `/api/swap/quote?${qs.toString()}`);
}

export async function bridgeQuote(
  input: { fromChain: string; toChain: string; fromToken: string; toToken?: string; fromAmount: string },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams({
    fromChain: input.fromChain,
    toChain: input.toChain,
    fromToken: input.fromToken,
    fromAmount: String(input.fromAmount),
  });
  if (input.toToken) qs.set("toToken", input.toToken);
  return await callInternal(ctx, `/api/bridge/quote?${qs.toString()}`);
}

export async function gasEstimate(
  input: { chain: string; blocks?: number },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams({ chain: input.chain });
  if (input.blocks != null) qs.set("blocks", String(input.blocks));
  return await callInternal(ctx, `/api/gas/estimate?${qs.toString()}`);
}

// ─── Pillar E — Risk & Forensics ─────────────────────────────────────
export async function riskWallet(
  input: { address: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/public/risk/${input.address}`);
}

export async function riskEdgeInsights(
  input: { address: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/public/edge-insights/${input.address}`);
}

export async function walletNarrative(
  input: { address: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/public/narrative/${input.address}`);
}

// ─── Pillar F — Tax & Accounting ─────────────────────────────────────
export async function taxAnalyze(
  input: {
    holdings: unknown[];
    rebalanceTrades?: unknown[];
    userTransactionHistory?: unknown[];
  },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/solana/tax-analysis`, {
    method: "POST",
    body: JSON.stringify({
      holdings: input.holdings,
      rebalanceTrades: input.rebalanceTrades ?? [],
      userTransactionHistory: input.userTransactionHistory ?? [],
    }),
  });
}

// ─── Pillar G — Foresight (Dreyv signature) ──────────────────────────
export async function foresightSimulate(
  input: {
    portfolio: unknown[];
    variables: unknown[];
    timeframeMonths: number;
    granularity?: "weekly" | "monthly";
    paths?: number;
    seed?: number;
    priors?: { driftPctPerDay?: number; volPctPerDay?: number };
  },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/foresight/simulate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Pillar C — Market signals (Atlas) ───────────────────────────────
export async function marketTrending(
  input: { chain: string; limit: number },
  ctx: CapabilityRunContext,
) {
  if (input.chain === "solana") {
    return await callInternal(ctx, `/api/jupiter/trending?limit=${input.limit}`);
  }
  return await callInternal(ctx, `/api/moralis/trending?limit=${input.limit}`);
}

export async function marketPriceHistory(
  input: { token: string; daysAgo: number },
  ctx: CapabilityRunContext,
) {
  const t = input.token.trim();
  const isMint = t.length >= 32;
  const qs = new URLSearchParams({ daysAgo: String(input.daysAgo) });
  if (isMint) qs.set("mint", t);
  else qs.set("symbol", t.toUpperCase());
  return await callInternal(ctx, `/api/jupiter/historical-price?${qs.toString()}`);
}

// ─── Pillar H — Agentic delegation (Phase 3) ─────────────────────────
// Solana SPL Token `Approve` delegation: returns an unsigned approve
// instruction + recent blockhash. The caller signs and submits — Dreyv
// never holds keys. Real upstream: /api/delegation/request.
export async function delegationRequestSolana(
  input: {
    walletAddress: string;
    tokenMint: string;
    amount: number;
    expiryDays: 30 | 60 | 90 | 180;
  },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/delegation/request`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function delegationStatus(
  input: { walletAddress: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(
    ctx,
    `/api/delegation/status?wallet=${encodeURIComponent(input.walletAddress)}`,
  );
}

// ─── Pillar I — x402 Economy primitives (Phase 3) ────────────────────
// Read-only discovery surface so any agent can introspect what Dreyv
// sells over x402 + Agentic Commerce Protocol, without first minting an
// agent payment key. Mutating x402 endpoints (/api/x402/checkout, /pay)
// require a separate dak_… agent payment key per design and are NOT
// proxied through dk_live_… public keys.
export async function economyX402Catalog(
  _input: Record<string, never>,
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/.well-known/x402`);
}

export async function economyAcpCatalog(
  _input: Record<string, never>,
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/.well-known/acp.json`);
}

export async function economySkus(
  _input: Record<string, never>,
  _ctx: CapabilityRunContext,
) {
  const { listSkus } = await import("@/lib/agent/skus");
  const skus = listSkus();
  return {
    settlement: { rail: "solana", asset: "USDC", facilitator: "dreyv-native" },
    auth: {
      header: "Authorization: Bearer dak_…",
      mint_url: "/app/settings/agent-keys",
      note: "Public dk_live_ keys CANNOT execute x402 purchases. Mint a dak_ agent payment key.",
    },
    endpoints: {
      checkout: "/api/x402/checkout",
      pay: "/api/x402/pay",
      fulfil: "/api/x402/fulfil",
    },
    skus,
  };
}
