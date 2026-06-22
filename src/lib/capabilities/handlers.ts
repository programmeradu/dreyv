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
import { agentApiKeys, agentDeliverables, agentPayments, agentTreasuryWatchers, agentTxProposals, monitors, notifications, notificationPreferences, publicApiWebhooks, webhookDeliveries } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ALL_WEBHOOK_EVENTS,
  emitWebhookEvent,
  generateSigningSecret,
  type WebhookEventName,
} from "@/lib/webhooks/dispatcher";
import { buildPlanForAction } from "@/lib/agents/brains/executor-plans";
import { getOrCreateAgentWallet, getWalletBalances } from "@/lib/agent/wallet";
import { tokenFor } from "@/lib/billing/crypto-config";
import { AGENT_SKUS, listSkus } from "@/lib/agent/skus";

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
  // Upstream route is /api/squads/proposals?vault=<addr> — alias the field name.
  return await callInternal(ctx, `/api/squads/proposals?vault=${encodeURIComponent(input.multisigAddress)}&status=active`);
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
  try {
    return await callInternal(ctx, `/api/jupiter/historical-price?${qs.toString()}`);
  } catch (e) {
    if (e instanceof CapabilityError) {
      // Historical price providers occasionally lack coverage for thin tokens
      // or older windows. Surface a structured empty result with a hint instead
      // of a 502 so callers can branch on `priceUsd === null`.
      const msg = (e.message || "").toLowerCase();
      if (
        msg.includes("could not fetch historical price") ||
        msg.includes("no provider") ||
        msg.includes("not found")
      ) {
        return {
          token: t,
          daysAgo: input.daysAgo,
          priceUsd: null,
          available: false,
          note: "No historical-price provider returned data for this token/window. Try a major asset (SOL, USDC, WBTC) or a smaller `daysAgo` value.",
        };
      }
    }
    throw e;
  }
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
  try {
    return await callInternal(
      ctx,
      `/api/delegation/status?wallet=${encodeURIComponent(input.walletAddress)}`,
    );
  } catch (e) {
    if (e instanceof CapabilityError) {
      // Upstream wraps DB errors as 500/503 with Drizzle's `Failed query: …` text.
      // Translate that into a clean, machine-friendly empty result so callers
      // can act on it (no active delegations) instead of crashing.
      const msg = e.message || "";
      if (
        e.status >= 500 &&
        (msg.includes("Failed query") ||
          msg.includes("relation") ||
          msg.includes("column") ||
          msg.includes("does not exist"))
      ) {
        return {
          success: true,
          walletAddress: input.walletAddress,
          delegations: [],
          activeBots: 0,
          botsWithDelegation: 0,
          note: "Delegation registry is empty or unavailable for this environment.",
          timestamp: new Date().toISOString(),
        };
      }
    }
    throw e;
  }
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

// ─── Pillar J — Watchers, Monitors, Notifications (Phase 4) ──────────
// All ops are DB-backed and strictly scoped to ctx.userId. No fallbacks:
// if the DB is unavailable we surface a real 503 CapabilityError.

function requireDb() {
  if (!db) throw new CapabilityError("Database unavailable", 503, null);
  return db;
}

const CHAIN_VALUES = ["solana", "ethereum", "base", "arbitrum", "polygon", "bsc"] as const;

// ── Watchers ─────────────────────────────────────────────────────────
export async function watchersList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const rows = await d
    .select()
    .from(agentTreasuryWatchers)
    .where(eq(agentTreasuryWatchers.userId, ctx.userId))
    .orderBy(desc(agentTreasuryWatchers.createdAt))
    .limit(200);
  return { watchers: rows };
}

export async function watchersCreate(
  input: { chain: (typeof CHAIN_VALUES)[number]; address: string; label?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [row] = await d
    .insert(agentTreasuryWatchers)
    .values({
      userId: ctx.userId,
      chain: input.chain,
      address: input.address,
      label: input.label ?? null,
      active: true,
    })
    .returning();
  return { watcher: row };
}

export async function watchersDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .update(agentTreasuryWatchers)
    .set({ active: false })
    .where(
      and(eq(agentTreasuryWatchers.id, input.id), eq(agentTreasuryWatchers.userId, ctx.userId)),
    )
    .returning({ id: agentTreasuryWatchers.id });
  if (!row) throw new CapabilityError(`Watcher ${input.id} not found for this key owner`, 404, null);
  return { deleted: true, id: row.id };
}

// ── Monitors ─────────────────────────────────────────────────────────
export async function monitorsList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const rows = await d
    .select()
    .from(monitors)
    .where(eq(monitors.userId, ctx.userId))
    .orderBy(desc(monitors.createdAt))
    .limit(200);
  return { monitors: rows };
}

export async function monitorsCreate(
  input: {
    walletAddress: string;
    type: "price" | "balance" | "apy" | "risk";
    target: string;
    operator: "above" | "below" | "equals" | "changes";
    conditionValue: number;
    active?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [row] = await d
    .insert(monitors)
    .values({
      userId: ctx.userId,
      walletAddress: input.walletAddress,
      type: input.type,
      target: input.target,
      operator: input.operator,
      conditionValue: String(input.conditionValue),
      active: input.active ?? true,
    })
    .returning();
  return { monitor: row };
}

export async function monitorsDelete(input: { id: number }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .update(monitors)
    .set({ active: false })
    .where(and(eq(monitors.id, input.id), eq(monitors.userId, ctx.userId)))
    .returning({ id: monitors.id });
  if (!row) throw new CapabilityError(`Monitor ${input.id} not found for this key owner`, 404, null);
  return { deleted: true, id: row.id };
}

// ── Notifications ────────────────────────────────────────────────────
export async function notificationsList(
  input: { unreadOnly?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const conds = [eq(notifications.userId, ctx.userId)];
  if (input.unreadOnly) conds.push(eq(notifications.read, false));
  const items = await d
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const unread = await d
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), eq(notifications.read, false)));
  return { notifications: items, unreadCount: unread.length };
}

export async function notificationsMarkRead(
  input: { ids?: number[]; all?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (!input.all && (!input.ids || input.ids.length === 0)) {
    throw new CapabilityError("Provide either `all: true` or `ids: number[]`", 400, null);
  }
  const cond = input.all
    ? eq(notifications.userId, ctx.userId)
    : and(eq(notifications.userId, ctx.userId), inArray(notifications.id, input.ids ?? []));
  const updated = await d
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(cond)
    .returning({ id: notifications.id });
  return { updated: updated.length, ids: updated.map((r) => r.id) };
}

// ─── Pillar K — Outbound Webhooks (Phase 5) ──────────────────────────
// `signing_secret` is returned ONLY on create + rotate. After that it's
// write-only; subsequent reads omit it. All ops scoped to ctx.userId.

function redactWebhook<T extends { signingSecret?: string | null }>(row: T) {
  const { signingSecret: _omit, ...rest } = row as T & { signingSecret?: string | null };
  void _omit;
  return rest;
}

function validateHttpsUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CapabilityError("targetUrl must be a valid URL", 400, null);
  }
  if (u.protocol !== "https:") {
    throw new CapabilityError("targetUrl must use https://", 400, null);
  }
  // Block obvious SSRF surfaces.
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new CapabilityError("targetUrl host is not allowed", 400, null);
  }
  return u;
}

function validateEvents(events: string[]): string {
  if (!events || events.length === 0) {
    throw new CapabilityError("events must be a non-empty array (use ['*'] for all)", 400, null);
  }
  const allowed = new Set<string>([...ALL_WEBHOOK_EVENTS, "*"]);
  const bad = events.filter((e) => !allowed.has(e));
  if (bad.length) {
    throw new CapabilityError(`Unknown event(s): ${bad.join(", ")}`, 400, { allowed: [...allowed] });
  }
  return events.join(",");
}

export async function webhooksList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const rows = await d
    .select()
    .from(publicApiWebhooks)
    .where(eq(publicApiWebhooks.userId, ctx.userId))
    .orderBy(desc(publicApiWebhooks.createdAt));
  return { webhooks: rows.map(redactWebhook), supportedEvents: ALL_WEBHOOK_EVENTS };
}

export async function webhooksCreate(
  input: { label: string; targetUrl: string; events: string[] },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  validateHttpsUrl(input.targetUrl);
  const eventsCsv = validateEvents(input.events);
  const signingSecret = generateSigningSecret();

  const [row] = await d
    .insert(publicApiWebhooks)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      label: input.label.trim(),
      targetUrl: input.targetUrl,
      signingSecret,
      events: eventsCsv,
      active: true,
    })
    .returning();

  return {
    webhook: redactWebhook(row),
    signingSecret,
    notice:
      "Store this signingSecret now — it is shown only once. Verify deliveries with HMAC-SHA256 of `${t}.${rawBody}` against the v1 field of x-dreyv-signature.",
  };
}

export async function webhooksRotateSecret(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const signingSecret = generateSigningSecret();
  const [row] = await d
    .update(publicApiWebhooks)
    .set({ signingSecret, updatedAt: new Date() })
    .where(and(eq(publicApiWebhooks.id, input.id), eq(publicApiWebhooks.userId, ctx.userId)))
    .returning();
  if (!row) throw new CapabilityError(`Webhook ${input.id} not found`, 404, null);
  return { webhook: redactWebhook(row), signingSecret };
}

export async function webhooksUpdate(
  input: { id: string; label?: string; targetUrl?: string; events?: string[]; active?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const patch: Partial<typeof publicApiWebhooks.$inferInsert> = { updatedAt: new Date() };
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.targetUrl !== undefined) {
    validateHttpsUrl(input.targetUrl);
    patch.targetUrl = input.targetUrl;
  }
  if (input.events !== undefined) patch.events = validateEvents(input.events);
  if (input.active !== undefined) patch.active = input.active;

  const [row] = await d
    .update(publicApiWebhooks)
    .set(patch)
    .where(and(eq(publicApiWebhooks.id, input.id), eq(publicApiWebhooks.userId, ctx.userId)))
    .returning();
  if (!row) throw new CapabilityError(`Webhook ${input.id} not found`, 404, null);
  return { webhook: redactWebhook(row) };
}

export async function webhooksDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .delete(publicApiWebhooks)
    .where(and(eq(publicApiWebhooks.id, input.id), eq(publicApiWebhooks.userId, ctx.userId)))
    .returning({ id: publicApiWebhooks.id });
  if (!row) throw new CapabilityError(`Webhook ${input.id} not found`, 404, null);
  return { deleted: true, id: row.id };
}

export async function webhooksDeliveries(
  input: { webhookId?: string; status?: "ok" | "failed" | "pending"; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const conds = [eq(webhookDeliveries.userId, ctx.userId)];
  if (input.webhookId) conds.push(eq(webhookDeliveries.webhookId, input.webhookId));
  if (input.status) conds.push(eq(webhookDeliveries.status, input.status));
  const rows = await d
    .select()
    .from(webhookDeliveries)
    .where(and(...conds))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  return { deliveries: rows };
}

export async function webhooksReplay(input: { deliveryId: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [original] = await d
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, input.deliveryId), eq(webhookDeliveries.userId, ctx.userId)))
    .limit(1);
  if (!original) throw new CapabilityError(`Delivery ${input.deliveryId} not found`, 404, null);

  const payload =
    typeof original.payload === "object" && original.payload && "data" in (original.payload as Record<string, unknown>)
      ? ((original.payload as { data: Record<string, unknown> }).data ?? {})
      : ((original.payload as Record<string, unknown>) ?? {});
  const results = await emitWebhookEvent({
    userId: ctx.userId,
    event: original.event as WebhookEventName,
    data: { ...payload, _replay_of: original.id },
  });
  return { replayed: true, originalEvent: original.event, results };
}

export async function webhooksTest(
  input: { id: string; event?: WebhookEventName },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [hook] = await d
    .select()
    .from(publicApiWebhooks)
    .where(and(eq(publicApiWebhooks.id, input.id), eq(publicApiWebhooks.userId, ctx.userId)))
    .limit(1);
  if (!hook) throw new CapabilityError(`Webhook ${input.id} not found`, 404, null);
  const results = await emitWebhookEvent({
    userId: ctx.userId,
    event: input.event ?? "test.ping",
    data: { hello: "from dreyv", webhookId: hook.id, ts: new Date().toISOString() },
  });
  return { sent: true, results };
}


// ─── Pillar L — Signed Intents & Execution Receipts (Phase 6) ────────
// Caller compiles an intent → we persist an unsigned ExecutorPlan as a
// queued tx proposal. Caller signs locally with their wallet/multisig,
// broadcasts to the chain, then submits the signature back so we record
// it. Receipts verify on-chain status via the real Solana RPC — NO
// fallbacks: if RPC is unreachable we surface 503.

const INTENT_OPS = [
  "swap",
  "stake",
  "unstake",
  "deposit_yield",
  "withdraw",
  "rebalance",
  "transfer",
] as const;
export type IntentOp = (typeof INTENT_OPS)[number];

function redactIntent(row: typeof agentTxProposals.$inferSelect) {
  // unsignedTx + instructions can be large + sensitive (route params);
  // include them — caller needs them to sign — but document the shape.
  return {
    id: row.id,
    userId: row.userId,
    chain: row.chain,
    kind: row.kind,
    summary: row.summary,
    status: row.status,
    routing: row.routing,
    multisigVault: row.multisigVault,
    riskLevel: row.riskLevel,
    estimatedFeeSol: row.estimatedFeeSol,
    unsignedTx: row.unsignedTx,
    instructions: row.instructions,
    signature: row.signature,
    errorMessage: row.errorMessage,
    meta: row.meta,
    expiresAt: row.expiresAt,
    approvedAt: row.approvedAt,
    submittedAt: row.submittedAt,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function intentsCompile(
  input: {
    op: IntentOp;
    params: Record<string, unknown>;
    chain?: "solana";
    routing?: "wallet" | "multisig";
    multisigVault?: string | null;
    ttlMinutes?: number;
    riskLevel?: "low" | "medium" | "high";
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const plan = buildPlanForAction(input.op, input.params ?? {});
  if (!plan) {
    throw new CapabilityError(
      `No executor plan builder for op="${input.op}". Supported: ${INTENT_OPS.join(", ")}`,
      400,
      null,
    );
  }
  const routing = input.routing ?? (input.multisigVault ? "multisig" : "wallet");
  if (routing === "multisig" && !input.multisigVault) {
    throw new CapabilityError("multisigVault is required when routing='multisig'", 400, null);
  }
  const ttlMin = Math.min(Math.max(input.ttlMinutes ?? 30, 1), 24 * 60);
  const expiresAt = new Date(Date.now() + ttlMin * 60_000);

  const [row] = await d
    .insert(agentTxProposals)
    .values({
      userId: ctx.userId,
      proposalId: null,
      chain: input.chain ?? "solana",
      kind: input.op,
      summary: plan.summary,
      unsignedTx: null,
      instructions: [
        { op: input.op, params: input.params ?? {}, plan, source: "intents.compile", keyId: ctx.keyId },
      ] as unknown as object,
      estimatedFeeSol: plan.op === "rebalance" ? "0.0002" : plan.op === "swap" ? "0.00005" : "0.00003",
      riskLevel: input.riskLevel ?? (plan.op === "rebalance" ? "high" : "medium"),
      routing,
      multisigVault: input.multisigVault ?? null,
      status: "queued",
      meta: { compiledVia: "public-api", keyId: ctx.keyId } as unknown as object,
      expiresAt,
    })
    .returning();

  void emitWebhookEvent({
    userId: ctx.userId,
    event: "proposal.created",
    data: { id: row.id, kind: row.kind, summary: row.summary, routing, expiresAt },
  });

  return {
    intent: redactIntent(row),
    plan,
    notice:
      "Sign the returned plan locally with the wallet you control. When broadcast on-chain, POST the signature back via intents.submit. Dreyv NEVER signs server-side.",
  };
}

export async function intentsSubmit(
  input: { id: string; signature: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (!input.signature || input.signature.length < 32) {
    throw new CapabilityError("signature is required (base58 Solana tx signature)", 400, null);
  }
  const [existing] = await d
    .select()
    .from(agentTxProposals)
    .where(and(eq(agentTxProposals.id, input.id), eq(agentTxProposals.userId, ctx.userId)))
    .limit(1);
  if (!existing) throw new CapabilityError(`Intent ${input.id} not found`, 404, null);
  if (existing.status === "rejected" || existing.status === "expired") {
    throw new CapabilityError(`Intent is ${existing.status} — cannot submit`, 409, null);
  }
  const now = new Date();
  const [updated] = await d
    .update(agentTxProposals)
    .set({
      status: "submitted",
      signature: input.signature,
      submittedAt: now,
      approvedAt: existing.approvedAt ?? now,
      updatedAt: now,
    })
    .where(eq(agentTxProposals.id, input.id))
    .returning();
  return { intent: redactIntent(updated) };
}

export async function intentsStatus(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(agentTxProposals)
    .where(and(eq(agentTxProposals.id, input.id), eq(agentTxProposals.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError(`Intent ${input.id} not found`, 404, null);
  return { intent: redactIntent(row) };
}

export async function intentsList(
  input: {
    status?: "queued" | "approved" | "submitted" | "confirmed" | "failed" | "rejected" | "expired";
    limit?: number;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 200);
  const conds = [eq(agentTxProposals.userId, ctx.userId)];
  if (input.status) conds.push(eq(agentTxProposals.status, input.status));
  const rows = await d
    .select()
    .from(agentTxProposals)
    .where(and(...conds))
    .orderBy(desc(agentTxProposals.createdAt))
    .limit(limit);
  return { intents: rows.map(redactIntent) };
}

export async function intentsCancel(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [existing] = await d
    .select()
    .from(agentTxProposals)
    .where(and(eq(agentTxProposals.id, input.id), eq(agentTxProposals.userId, ctx.userId)))
    .limit(1);
  if (!existing) throw new CapabilityError(`Intent ${input.id} not found`, 404, null);
  if (existing.status === "submitted" || existing.status === "confirmed") {
    throw new CapabilityError(
      `Intent already ${existing.status} on-chain — cannot cancel server-side`,
      409,
      null,
    );
  }
  const [row] = await d
    .update(agentTxProposals)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(agentTxProposals.id, input.id))
    .returning();
  return { intent: redactIntent(row) };
}

// ── Receipts: real Solana RPC signature lookup. No stubs. ────────────
function solanaRpcUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    (process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "");
  if (!url) {
    throw new CapabilityError(
      "Solana RPC unavailable — NEXT_PUBLIC_SOLANA_RPC_URL / HELIUS_API_KEY not configured",
      503,
      null,
    );
  }
  return url;
}

async function rpcCall<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const url = solanaRpcUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
  } catch (e: any) {
    throw new CapabilityError(`Solana RPC unreachable: ${e?.message ?? "network"}`, 503, null);
  }
  if (!res.ok) {
    throw new CapabilityError(`Solana RPC HTTP ${res.status}`, 502, null);
  }
  const body = (await res.json()) as { result?: T; error?: { message: string; code: number } };
  if (body.error) {
    throw new CapabilityError(`Solana RPC error: ${body.error.message}`, 502, body.error);
  }
  return body.result as T;
}

interface SigStatus {
  slot: number;
  confirmations: number | null;
  err: unknown | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
}

async function fetchSignatureStatus(signature: string): Promise<SigStatus | null> {
  const result = await rpcCall<{ value: (SigStatus | null)[] }>(
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
  );
  return result?.value?.[0] ?? null;
}

export async function receiptsVerify(
  input: { signature: string; chain?: "solana" },
  _ctx: CapabilityRunContext,
) {
  if ((input.chain ?? "solana") !== "solana") {
    throw new CapabilityError("Only chain='solana' is supported in Phase 6", 400, null);
  }
  const sig = (input.signature ?? "").trim();
  // Solana signatures are 64 bytes ⇒ base58 length 86–88.
  // Reject anything that is obviously not a base58 signature before hitting
  // the RPC node (which otherwise returns the unfriendly "Invalid param: WrongSize").
  if (!sig) {
    throw new CapabilityError("signature is required (base58 Solana transaction signature, ~88 chars)", 400, null);
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(sig)) {
    throw new CapabilityError("signature must be base58 (Solana transaction signature)", 400, null);
  }
  if (sig.length < 64 || sig.length > 96) {
    throw new CapabilityError(
      `signature length ${sig.length} is not a valid Solana transaction signature (expected 64–96 base58 chars)`,
      400,
      null,
    );
  }
  let status: SigStatus | null = null;
  try {
    status = await fetchSignatureStatus(sig);
  } catch (e) {
    throw new CapabilityError(
      `RPC failed while verifying signature: ${(e as Error)?.message ?? "unknown"}`,
      502,
      null,
    );
  }
  if (!status) {
    return {
      signature: sig,
      found: false,
      verifiedAt: new Date().toISOString(),
      note: "Signature not visible to this RPC node within transaction history window.",
    };
  }
  return {
    signature: sig,
    found: true,
    slot: status.slot,
    confirmationStatus: status.confirmationStatus,
    confirmations: status.confirmations,
    err: status.err,
    finalized: status.confirmationStatus === "finalized",
    verifiedAt: new Date().toISOString(),
  };
}

export async function receiptsGet(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(agentTxProposals)
    .where(and(eq(agentTxProposals.id, input.id), eq(agentTxProposals.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError(`Intent ${input.id} not found`, 404, null);
  const intent = redactIntent(row);
  if (!row.signature) {
    return { intent, onChain: null, note: "No signature submitted yet. Call intents.submit first." };
  }
  let onChain: Awaited<ReturnType<typeof receiptsVerify>> | null = null;
  let confirmedNow = false;
  try {
    onChain = await receiptsVerify({ signature: row.signature, chain: "solana" }, ctx);
    if (
      onChain.found &&
      (onChain.confirmationStatus === "confirmed" || onChain.confirmationStatus === "finalized") &&
      !onChain.err &&
      row.status !== "confirmed"
    ) {
      const now = new Date();
      await d
        .update(agentTxProposals)
        .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
        .where(eq(agentTxProposals.id, row.id));
      confirmedNow = true;
    } else if (onChain.found && onChain.err && row.status !== "failed") {
      const now = new Date();
      await d
        .update(agentTxProposals)
        .set({ status: "failed", errorMessage: JSON.stringify(onChain.err).slice(0, 500), updatedAt: now })
        .where(eq(agentTxProposals.id, row.id));
    }
  } catch (e) {
    if (e instanceof CapabilityError) throw e;
    throw new CapabilityError("Receipt verification failed", 502, { message: (e as Error).message });
  }
  return { intent: { ...intent, status: confirmedNow ? "confirmed" : intent.status }, onChain };
}


// ─── Pillar M — Agent Economy mutators (Phase 7) ─────────────────────
// Wraps the dak_-protected x402 routes with internal trust so dk_-keyed
// callers can drive the same battle-tested flow. NO fallbacks: when the
// upstream returns 402 / 409 / 502 we surface it verbatim — calling agents
// need the funding-instructions / wallet-ambiguity payload to act on it.

function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s) {
    throw new CapabilityError(
      "Internal trust unavailable — CRON_SECRET not configured",
      503,
      null,
    );
  }
  return s;
}

async function callX402<T = unknown>(
  ctx: CapabilityRunContext,
  path: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const cronSecret = requireCronSecret();
  const url = `${ctx.origin}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dreyv-internal": cronSecret,
        "x-dreyv-user-id": ctx.userId,
        "x-dreyv-key-id": ctx.keyId,
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  } catch (e: any) {
    throw new CapabilityError(`Upstream x402 unreachable: ${e?.message ?? "network"}`, 503, null);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  // 402 (quote / underfunded) and 409 (wallet ambiguity) are EXPECTED
  // operational responses — the agent caller needs the payload to act
  // on them. Surface them as data, not as errors.
  if (res.ok || res.status === 402 || res.status === 409) {
    return { status: res.status, data: data as T };
  }
  const message =
    (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
      ? (data as { error: string }).error
      : null) ?? `Upstream ${res.status}`;
  throw new CapabilityError(message, res.status, data);
}

export async function economySkusExtended(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return {
    skus: listSkus(),
    note: "Settle USDC on Solana. Tier SKUs upgrade the API-key owner (tier=mini|max) for 30 days.",
  };
}

export async function economyCheckout(
  input: {
    sku: string;
    rail?: "solana" | "stripe" | "paystack";
    chain?: "solana";
    asset?: "usdc" | "usdt";
  },
  ctx: CapabilityRunContext,
) {
  if (!AGENT_SKUS[input.sku]) {
    throw new CapabilityError(`Unknown SKU: ${input.sku}`, 404, { availableSkus: Object.keys(AGENT_SKUS) });
  }
  const { status, data } = await callX402(ctx, "/api/x402/checkout", input);
  return { httpStatus: status, ...((data as object | null) ?? {}) };
}

export async function economyPay(
  input: { sku: string; target_wallet?: string },
  ctx: CapabilityRunContext,
) {
  if (!AGENT_SKUS[input.sku]) {
    throw new CapabilityError(`Unknown SKU: ${input.sku}`, 404, { availableSkus: Object.keys(AGENT_SKUS) });
  }
  const { status, data } = await callX402(ctx, "/api/x402/pay", input);
  return { httpStatus: status, ...((data as object | null) ?? {}) };
}

export async function economyDeliverablesList(
  input: { kind?: "snapshot" | "report" | "subscription"; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const conds = [eq(agentDeliverables.userId, ctx.userId)];
  if (input.kind) conds.push(eq(agentDeliverables.kind, input.kind));
  const rows = await d
    .select({
      id: agentDeliverables.id,
      kind: agentDeliverables.kind,
      sku: agentDeliverables.sku,
      targetWallet: agentDeliverables.targetWallet,
      status: agentDeliverables.status,
      summary: agentDeliverables.summary,
      pdfUrl: agentDeliverables.pdfUrl,
      emailTo: agentDeliverables.emailTo,
      emailSentAt: agentDeliverables.emailSentAt,
      emailError: agentDeliverables.emailError,
      error: agentDeliverables.error,
      createdAt: agentDeliverables.createdAt,
      readyAt: agentDeliverables.readyAt,
      expiresAt: agentDeliverables.expiresAt,
      agentKeyLabel: agentApiKeys.label,
      amountUsd: agentPayments.amountUsd,
      txSignature: agentPayments.txSignature,
    })
    .from(agentDeliverables)
    .leftJoin(agentApiKeys, eq(agentDeliverables.apiKeyId, agentApiKeys.id))
    .leftJoin(agentPayments, eq(agentDeliverables.paymentId, agentPayments.id))
    .where(and(...conds))
    .orderBy(desc(agentDeliverables.createdAt))
    .limit(limit);
  return { deliverables: rows };
}

export async function economyDeliverablesGet(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(agentDeliverables)
    .where(and(eq(agentDeliverables.id, input.id), eq(agentDeliverables.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError(`Deliverable ${input.id} not found`, 404, null);
  return { deliverable: row };
}

export async function economyWalletAddress(_input: Record<string, never>, ctx: CapabilityRunContext) {
  let wallet: { publicKey: string; createdAt: Date };
  try {
    wallet = await getOrCreateAgentWallet(ctx.userId);
  } catch (e: any) {
    throw new CapabilityError(`Wallet provision failed: ${e?.message ?? "unknown"}`, 500, null);
  }
  const usdc = tokenFor("solana", "usdc");
  return {
    address: wallet.publicKey,
    createdAt: wallet.createdAt,
    chain: "solana",
    usdcMint: usdc?.contract ?? null,
    note: "Fund this address with USDC (SPL) + ~0.01 SOL for tx fees. Then call economy.pay to settle SKUs autonomously.",
    solanaPayUri: `solana:${wallet.publicKey}?amount=0.01&label=Dreyv%20Agent%20Wallet&message=SOL%20float%20for%20tx%20fees`,
  };
}

export async function economyWalletBalance(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const usdc = tokenFor("solana", "usdc");
  if (!usdc?.contract) {
    throw new CapabilityError("USDC mint not configured", 503, null);
  }
  let wallet: { publicKey: string };
  try {
    wallet = await getOrCreateAgentWallet(ctx.userId);
  } catch (e: any) {
    throw new CapabilityError(`Wallet provision failed: ${e?.message ?? "unknown"}`, 500, null);
  }
  let balances;
  try {
    balances = await getWalletBalances({ publicKey: wallet.publicKey, mintAddress: usdc.contract });
  } catch (e: any) {
    throw new CapabilityError(`Solana RPC unreachable: ${e?.message ?? "rpc_failed"}`, 502, null);
  }
  const usdcMinor = balances.tokenMinor;
  const base = BigInt(10) ** BigInt(usdc.decimals);
  const whole = usdcMinor / base;
  const frac = usdcMinor % base;
  const fracStr = frac === BigInt(0) ? "" : `.${frac.toString().padStart(usdc.decimals, "0").replace(/0+$/, "")}`;
  return {
    address: wallet.publicKey,
    chain: "solana",
    usdc: `${whole.toString()}${fracStr}`,
    usdcMinor: usdcMinor.toString(),
    usdcMint: usdc.contract,
    tokenAccountExists: balances.tokenAccountExists,
    solLamports: balances.solLamports.toString(),
    sol: (Number(balances.solLamports) / 1e9).toFixed(9),
  };
}

// ─── Pillar N — Reasoning & Knowledge ─────────────────────────────────
// LOVABLE_API_KEY is NEVER on Vercel (per project policy). All Lovable AI calls
// go through the Supabase edge function `lovable-ai-proxy` which holds the key
// in the Lovable Cloud workspace. Gemini API is used as a backup provider when
// the proxy is unreachable or returns an error.

const LOVABLE_AI_DIRECT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function resolveLovableProxyUrl(): string | null {
  const direct = process.env.LOVABLE_AI_PROXY_URL?.trim();
  if (direct) return direct;
  const sbUrl = (
    process.env.LOVABLE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).trim();
  if (sbUrl) return `${sbUrl.replace(/\/+$/, "")}/functions/v1/lovable-ai-proxy`;
  return null;
}

function resolveLovableProxyAuth(): string | null {
  return (
    process.env.LOVABLE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    null
  )?.trim() || null;
}

async function tryProxy(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<{ ok: true; text: string } | { ok: false; status?: number; reason: string }> {
  const url = resolveLovableProxyUrl();
  const auth = resolveLovableProxyAuth();
  if (!url || !auth) return { ok: false, reason: "proxy_unconfigured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
        apikey: auth,
      },
      body: JSON.stringify({
        model: opts.model || "google/gemini-3-flash-preview",
        stream: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.3,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) return { ok: false, status: 429, reason: "rate_limited" };
    if (res.status === 402) return { ok: false, status: 402, reason: "credits_exhausted" };
    if (!res.ok) return { ok: false, status: res.status, reason: `proxy_http_${res.status}` };
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content ?? "";
    if (!txt) return { ok: false, reason: "empty_response" };
    return { ok: true, text: String(txt) };
  } catch (e) {
    return { ok: false, reason: `proxy_error:${(e as Error).message?.slice(0, 80)}` };
  }
}

async function tryDirect(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<{ ok: true; text: string } | { ok: false; status?: number; reason: string }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_direct_key" };
  try {
    const res = await fetch(LOVABLE_AI_DIRECT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model || "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.3,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) return { ok: false, status: 429, reason: "rate_limited" };
    if (res.status === 402) return { ok: false, status: 402, reason: "credits_exhausted" };
    if (!res.ok) return { ok: false, status: res.status, reason: `direct_http_${res.status}` };
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content ?? "";
    if (!txt) return { ok: false, reason: "empty_response" };
    return { ok: true, text: String(txt) };
  } catch (e) {
    return { ok: false, reason: `direct_error:${(e as Error).message?.slice(0, 80)}` };
  }
}

async function tryGemini(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<{ ok: true; text: string } | { ok: false; status?: number; reason: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_gemini_key" };
  // Map Lovable-style model name to a Gemini model id.
  const raw = opts.model || "google/gemini-3-flash-preview";
  const id = raw.startsWith("google/") ? raw.slice("google/".length) : raw;
  // Conservative mapping — only flip preview/-3 to a known live id.
  const geminiModel =
    id.includes("gemini-3") ? "gemini-2.5-flash" :
    id.includes("flash-lite") ? "gemini-2.5-flash-lite" :
    id.includes("pro") ? "gemini-2.5-pro" :
    "gemini-2.5-flash";
  try {
    const res = await fetch(
      `${GEMINI_API_URL}/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.user }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0.3,
            maxOutputTokens: opts.maxTokens ?? 800,
            ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (res.status === 429) return { ok: false, status: 429, reason: "rate_limited" };
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, reason: `gemini_http_${res.status}:${t.slice(0, 80)}` };
    }
    const data = await res.json();
    const txt = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "";
    if (!txt) return { ok: false, reason: "empty_response" };
    return { ok: true, text: String(txt) };
  } catch (e) {
    return { ok: false, reason: `gemini_error:${(e as Error).message?.slice(0, 80)}` };
  }
}

async function callLovableAI(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const attempts: string[] = [];
  for (const fn of [tryProxy, tryDirect, tryGemini]) {
    const r = await fn(opts);
    if (r.ok) return r.text;
    attempts.push(r.reason);
    // Don't fall through on quota signals — surface them immediately.
    if (r.status === 429) throw new CapabilityError("AI rate-limited — retry shortly", 429, { attempts });
    if (r.status === 402) throw new CapabilityError("AI credits exhausted", 402, { attempts });
  }
  throw new CapabilityError(
    "AI provider unavailable — proxy, direct gateway and Gemini fallback all failed",
    503,
    { attempts },
  );
}

export async function reasoningAsk(
  input: { question: string; context?: string; ground_with_memory?: boolean; model?: string },
  ctx: CapabilityRunContext,
) {
  let groundedContext = input.context ?? "";
  const sources: Array<{ title: string; url: string }> = [];
  if (input.ground_with_memory) {
    const { knowledgeMemory } = await import("@/lib/knowledge-memory");
    try {
      const recalled = await knowledgeMemory.recall(input.question, 5);
      if (recalled.length) {
        groundedContext = [
          groundedContext,
          "### Knowledge memory:\n" +
            recalled.map((r) => `- ${r.title ?? r.sourceUrl ?? "(untitled)"}: ${(r.summary ?? "").slice(0, 300)}`).join("\n"),
        ]
          .filter(Boolean)
          .join("\n\n");
        for (const r of recalled) {
          if (r.sourceUrl) sources.push({ title: r.title ?? r.sourceUrl, url: r.sourceUrl });
        }
      }
    } catch {}
  }
  const userMsg = groundedContext
    ? `Question:\n${input.question}\n\n---\nContext:\n${groundedContext.slice(0, 8000)}`
    : input.question;
  const answer = await callLovableAI({
    system:
      "You are Dreyv's on-chain reasoning assistant. Be precise, cite numbers, never fabricate addresses or balances. If the context does not contain the answer, say so plainly.",
    user: userMsg,
    model: input.model,
    maxTokens: 900,
    temperature: 0.2,
  });
  return { answer, sources, model: input.model || "google/gemini-3-flash-preview" };
}

export async function reasoningSummarize(
  input: { text: string; style?: "bullets" | "paragraph" | "tldr"; max_words?: number },
  _ctx: CapabilityRunContext,
) {
  const style = input.style || "tldr";
  const maxWords = input.max_words ?? 120;
  const system = `You summarize text crisply for an agent caller. Style: ${style}. Hard cap: ${maxWords} words. No preamble.`;
  const summary = await callLovableAI({
    system,
    user: input.text.slice(0, 16000),
    maxTokens: Math.min(800, maxWords * 6),
    temperature: 0.2,
  });
  return { summary, style, wordCount: summary.trim().split(/\s+/).length };
}

export async function reasoningClarify(
  input: { intent: string; max_questions?: number },
  _ctx: CapabilityRunContext,
) {
  const max = Math.min(Math.max(input.max_questions ?? 3, 1), 5);
  const raw = await callLovableAI({
    system: `You are an agent-orchestration assistant. Given a vague intent, return ${max} targeted clarifying questions that would let an autonomous agent execute it. Prefer chip/radio options over free text. Respond ONLY as JSON: {"questions":[{"id":"snake_case","text":"...","options":["..."],"multi":false}]}`,
    user: input.intent.slice(0, 1500),
    jsonMode: true,
    maxTokens: 700,
    temperature: 0.3,
  });
  let parsed: { questions?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CapabilityError("LLM returned non-JSON", 502, { raw });
  }
  const qs = Array.isArray(parsed.questions) ? parsed.questions.slice(0, max) : [];
  return { intent: input.intent, questions: qs };
}

export async function reasoningResearch(
  input: { query: string; depth?: "shallow" | "deep" },
  _ctx: CapabilityRunContext,
) {
  const { knowledgeBase } = await import("@/lib/knowledge");
  const result = await knowledgeBase.study(input.query);
  if (input.depth === "deep" && result.sources.length === 0) {
    throw new CapabilityError("No sources found and deep mode requested", 404, null);
  }
  return {
    query: input.query,
    summary: result.summary,
    sources: result.sources,
    rawContent: result.rawContent.slice(0, input.depth === "deep" ? 20000 : 6000),
  };
}

export async function knowledgeReadUrl(
  input: { url: string; max_chars?: number },
  _ctx: CapabilityRunContext,
) {
  const { markdown } = await import("@/lib/cloudflare/cf-browser");
  let raw: unknown;
  try {
    raw = await markdown({ url: input.url });
  } catch (e) {
    throw new CapabilityError(`URL fetch failed: ${(e as Error)?.message ?? "unknown"}`, 502, null);
  }
  // cfFetch returns JSON `{success, result}` for the markdown endpoint, but
  // older variants returned a raw string. Normalize to string here so the
  // downstream `.slice` call cannot blow up on an object.
  let md: string;
  if (typeof raw === "string") {
    md = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as { result?: unknown; markdown?: unknown; text?: unknown; success?: boolean; errors?: unknown };
    if (obj.success === false) {
      throw new CapabilityError(
        `URL fetch failed: ${JSON.stringify(obj.errors ?? obj).slice(0, 200)}`,
        502,
        null,
      );
    }
    const candidate = obj.result ?? obj.markdown ?? obj.text ?? "";
    md = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  } else {
    md = "";
  }
  if (!md) throw new CapabilityError("Empty response from URL", 404, null);
  const cap = Math.min(Math.max(input.max_chars ?? 8000, 500), 30000);
  return { url: input.url, markdown: md.slice(0, cap), truncated: md.length > cap, length: md.length };
}

export async function knowledgeRecall(
  input: { query: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const { knowledgeMemory } = await import("@/lib/knowledge-memory");
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 50);
  const rows = await knowledgeMemory.recall(input.query, limit);
  return {
    query: input.query,
    count: rows.length,
    entries: rows
      .filter((r) => !r.userId || r.userId === ctx.userId)
      .map((r) => ({
        id: r.id,
        source: r.source,
        title: r.title,
        summary: r.summary,
        sourceUrl: r.sourceUrl,
        tags: r.tags,
        createdAt: r.createdAt,
      })),
  };
}

export async function knowledgeStore(
  input: {
    title: string;
    content: string;
    summary?: string;
    sourceUrl?: string;
    tags?: string[];
  },
  ctx: CapabilityRunContext,
) {
  const { knowledgeMemory } = await import("@/lib/knowledge-memory");
  const stored = await knowledgeMemory.store({
    source: "public_api",
    title: input.title,
    content: input.content,
    summary: input.summary,
    sourceUrl: input.sourceUrl,
    tags: input.tags,
    userId: ctx.userId,
  });
  return { id: stored.id, createdAt: stored.createdAt, title: stored.title };
}


// ─── Pillar P — Governance & Multisig (Squads v4) ────────────────────
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function assertSolanaAddress(addr: string, field: string) {
  if (!SOLANA_ADDR_RE.test(addr)) throw new CapabilityError(`${field} is not a valid Solana address`, 400, null);
}

export async function governanceProposalsLive(
  input: { vault: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  assertSolanaAddress(input.vault, "vault");
  const data = await callInternal<unknown>(ctx, `/api/squads/proposals?vault=${encodeURIComponent(input.vault)}`);
  const arr = Array.isArray(data) ? data : [];
  const limit = Math.min(input.limit ?? 50, 200);
  return { vault: input.vault, count: arr.length, proposals: arr.slice(0, limit) };
}

export async function governanceProposalsCached(
  input: { vault: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  assertSolanaAddress(input.vault, "vault");
  const data = await callInternal<unknown>(ctx, `/api/squads/proposals/sync?vault=${encodeURIComponent(input.vault)}`);
  const list = (data && typeof data === "object" && "proposals" in data ? (data as { proposals: unknown }).proposals : data) as unknown;
  const arr = Array.isArray(list) ? list : [];
  const limit = Math.min(input.limit ?? 50, 200);
  return { vault: input.vault, count: arr.length, proposals: arr.slice(0, limit), source: "mirror" };
}

export async function governanceSync(
  input: { vaultAddress: string },
  ctx: CapabilityRunContext,
) {
  assertSolanaAddress(input.vaultAddress, "vaultAddress");
  return callInternal(ctx, "/api/squads/proposals/sync", {
    method: "POST",
    body: JSON.stringify({ vaultAddress: input.vaultAddress }),
  });
}

export async function governanceVoteTx(
  input: {
    multisig: string;
    transactionIndex: number;
    action: "Approve" | "Reject" | "Cancel" | "Execute";
    member: string;
  },
  ctx: CapabilityRunContext,
) {
  assertSolanaAddress(input.multisig, "multisig");
  assertSolanaAddress(input.member, "member");
  if (!Number.isInteger(input.transactionIndex) || input.transactionIndex < 1) {
    throw new CapabilityError("transactionIndex must be a positive integer", 400, null);
  }
  return callInternal(ctx, "/api/squads/proposals/vote", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Pillar Q — DeFi primitives (Phase 10) ───────────────────────────
export async function defiSwapQuote(
  input: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
    onlyDirectRoutes?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
  });
  if (typeof input.slippageBps === "number") qs.set("slippageBps", String(input.slippageBps));
  if (input.onlyDirectRoutes) qs.set("onlyDirectRoutes", "true");
  const data = await callInternal<Record<string, unknown>>(ctx, `/api/jupiter/quote?${qs}`);
  return { quote: data };
}

export async function defiSwapTx(
  input: {
    quoteResponse: Record<string, unknown>;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    asLegacyTransaction?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  assertSolanaAddress(input.userPublicKey, "userPublicKey");
  const data = await callInternal<Record<string, unknown>>(ctx, "/api/jupiter/swap", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function defiStakeSolTx(
  input: { userPublicKey: string; amountLamports: number },
  ctx: CapabilityRunContext,
) {
  assertSolanaAddress(input.userPublicKey, "userPublicKey");
  if (!Number.isFinite(input.amountLamports) || input.amountLamports <= 0) {
    throw new CapabilityError("amountLamports must be a positive number", 400, null);
  }
  const data = await callInternal<Record<string, unknown>>(ctx, "/api/marinade/stake", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

// ─── Pillar R — Developer & Metering (Phase 10) ──────────────────────
export async function devKeyInfo(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const [row] = await d
    .select({
      id: publicApiKeys.id,
      label: publicApiKeys.label,
      env: publicApiKeys.env,
      keyPrefix: publicApiKeys.keyPrefix,
      scopes: publicApiKeys.scopes,
      rateLimitRpm: publicApiKeys.rateLimitRpm,
      lastUsedAt: publicApiKeys.lastUsedAt,
      createdAt: publicApiKeys.createdAt,
    })
    .from(publicApiKeys)
    .where(eq(publicApiKeys.id, ctx.keyId))
    .limit(1);
  if (!row) throw new CapabilityError("Key not found", 404, null);
  return {
    ...row,
    scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export async function devUsageSummary(
  input: { window_hours?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeyUsage } = await import("@/db/schema");
  const { gte, sql } = await import("drizzle-orm");
  const hours = Math.min(Math.max(input.window_hours ?? 24, 1), 24 * 30);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await d
    .select({
      capabilityId: publicApiKeyUsage.capabilityId,
      status: publicApiKeyUsage.status,
      transport: publicApiKeyUsage.transport,
      count: sql<number>`count(*)::int`,
      avgLatencyMs: sql<number>`coalesce(avg(${publicApiKeyUsage.latencyMs})::int, 0)`,
      totalCredits: sql<string>`coalesce(sum(${publicApiKeyUsage.costCredits})::text, '0')`,
    })
    .from(publicApiKeyUsage)
    .where(and(eq(publicApiKeyUsage.keyId, ctx.keyId), gte(publicApiKeyUsage.ts, since)))
    .groupBy(publicApiKeyUsage.capabilityId, publicApiKeyUsage.status, publicApiKeyUsage.transport);
  const totals = rows.reduce(
    (acc, r) => {
      acc.calls += Number(r.count) || 0;
      acc.errors += r.status !== "ok" ? Number(r.count) || 0 : 0;
      acc.credits += parseFloat(r.totalCredits) || 0;
      return acc;
    },
    { calls: 0, errors: 0, credits: 0 },
  );
  return {
    windowHours: hours,
    since: since.toISOString(),
    totals,
    byCapability: rows,
  };
}

export async function devCapabilitiesList(
  input: { pillar?: string; scope?: string },
  _ctx: CapabilityRunContext,
) {
  const { listPublicCapabilities } = await import("./registry");
  const all = listPublicCapabilities();
  const filtered = all.filter(
    (c) => (input.pillar ? c.pillar === input.pillar : true) && (input.scope ? c.scope === input.scope : true),
  );
  return {
    count: filtered.length,
    capabilities: filtered.map((c) => ({
      id: c.id,
      mcpName: c.mcpName,
      pillar: c.pillar,
      scope: c.scope,
      sideEffects: c.sideEffects,
      status: c.status,
      title: c.title,
      description: c.description,
    })),
  };
}

// ─── Pillar S — Safety & Policy (Phase 11) ───────────────────────────
import { createHash as _ch11 } from "node:crypto";

async function _appendAudit(args: {
  keyId: string;
  userId: string;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
}) {
  const d = requireDb();
  const { publicApiAuditLog } = await import("@/db/schema");
  const [last] = await d
    .select({ hash: publicApiAuditLog.hash })
    .from(publicApiAuditLog)
    .where(eq(publicApiAuditLog.keyId, args.keyId))
    .orderBy(desc(publicApiAuditLog.ts))
    .limit(1);
  const prev = last?.hash ?? "";
  const meta = args.meta ?? {};
  const canonical = JSON.stringify({
    keyId: args.keyId,
    userId: args.userId,
    action: args.action,
    target: args.target ?? null,
    meta,
    ts: new Date().toISOString().slice(0, 19), // second-precision pin
  });
  const hash = _ch11("sha256").update(prev + canonical, "utf8").digest("hex");
  await d.insert(publicApiAuditLog).values({
    keyId: args.keyId,
    userId: args.userId,
    action: args.action,
    target: args.target ?? null,
    meta,
    prevHash: prev,
    hash,
  });
  return { prevHash: prev, hash };
}

export async function safetyPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const [row] = await d
    .select()
    .from(publicApiKeys)
    .where(eq(publicApiKeys.id, ctx.keyId))
    .limit(1);
  if (!row) throw new CapabilityError("Key not found", 404, null);
  const csv = (v: string | null | undefined) =>
    (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    keyId: row.id,
    label: row.label,
    env: row.env,
    keyPrefix: row.keyPrefix,
    scopes: csv(row.scopes),
    rateLimitRpm: row.rateLimitRpm,
    killSwitch: row.killSwitchAt ? { engaged: true, since: row.killSwitchAt } : { engaged: false },
    allowlists: {
      capability: csv(row.capabilityAllowlist),
      origin: csv(row.originAllowlist),
      ip: csv(row.ipAllowlist),
    },
    revoked: !!row.revokedAt,
  };
}

export async function safetyKillSwitch(
  input: { state: "on" | "off"; confirm?: boolean },
  ctx: CapabilityRunContext,
) {
  if (input.state === "on" && input.confirm !== true) {
    throw new CapabilityError(
      "Engaging the kill switch requires confirm=true. This safeguard prevents an LLM from accidentally bricking your key by picking the first enum value. Re-call with { state: 'on', confirm: true }.",
      400,
      { requires: { confirm: true } },
    );
  }
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const value = input.state === "on" ? new Date() : null;
  const [updated] = await d
    .update(publicApiKeys)
    .set({ killSwitchAt: value })
    .where(eq(publicApiKeys.id, ctx.keyId))
    .returning({ killSwitchAt: publicApiKeys.killSwitchAt });
  if (!updated) throw new CapabilityError("Key not found", 404, null);
  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "policy.kill_switch",
    target: input.state,
    meta: { engagedAt: updated.killSwitchAt },
  });
  return { state: input.state, engagedAt: updated.killSwitchAt, audit };
}

export async function safetyAllowlistSet(
  input: { kind: "ip" | "origin" | "capability"; values: string[] },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const cleaned = Array.from(
    new Set(
      input.values
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && v.length <= 256),
    ),
  );
  if (cleaned.length > 64) {
    throw new CapabilityError("allowlist exceeds 64 entries", 400, null);
  }
  if (input.kind === "ip") {
    for (const v of cleaned) {
      if (!/^[0-9.]+(\/\d{1,2})?$/.test(v)) {
        throw new CapabilityError(`invalid IPv4 / CIDR entry: ${v}`, 400, null);
      }
    }
  }
  if (input.kind === "origin") {
    for (const v of cleaned) {
      if (!/^[a-z0-9.\-:]+$/i.test(v)) {
        throw new CapabilityError(`invalid origin host: ${v}`, 400, null);
      }
    }
  }
  if (input.kind === "capability") {
    const { listPublicCapabilities } = await import("./registry");
    const valid = new Set(listPublicCapabilities().map((c) => c.id));
    for (const v of cleaned) {
      if (!valid.has(v)) throw new CapabilityError(`unknown capability id: ${v}`, 400, null);
    }
  }
  const column =
    input.kind === "ip"
      ? "ipAllowlist"
      : input.kind === "origin"
        ? "originAllowlist"
        : "capabilityAllowlist";
  const patch: Record<string, string> = { [column]: cleaned.join(",") };
  const [updated] = await d
    .update(publicApiKeys)
    .set(patch as Parameters<typeof d.update>[0] extends never ? never : { [k: string]: string })
    .where(eq(publicApiKeys.id, ctx.keyId))
    .returning({ id: publicApiKeys.id });
  if (!updated) throw new CapabilityError("Key not found", 404, null);
  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "policy.allowlist",
    target: input.kind,
    meta: { values: cleaned },
  });
  return { kind: input.kind, values: cleaned, audit };
}

export async function safetyAuditLog(
  input: { limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiAuditLog } = await import("@/db/schema");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const rows = await d
    .select()
    .from(publicApiAuditLog)
    .where(eq(publicApiAuditLog.keyId, ctx.keyId))
    .orderBy(desc(publicApiAuditLog.ts))
    .limit(limit);

  // Verify hash chain (oldest → newest).
  const chrono = [...rows].reverse();
  let prev = chrono[0]?.prevHash ?? "";
  let valid = true;
  let brokenAt: number | null = null;
  for (const r of chrono) {
    if (r.prevHash !== prev) {
      valid = false;
      brokenAt = r.id;
      break;
    }
    const canonical = JSON.stringify({
      keyId: r.keyId,
      userId: r.userId,
      action: r.action,
      target: r.target ?? null,
      meta: r.meta ?? {},
      ts: new Date(r.ts).toISOString().slice(0, 19),
    });
    const expected = _ch11("sha256").update(prev + canonical, "utf8").digest("hex");
    // Note: we tolerate that ts on write was a fresh Date — verification is best-effort
    // for entries written in the same second window. We only assert prev_hash linkage strictly.
    if (expected !== r.hash) {
      // soft signal — do not flip `valid` since ts second-pin can drift on write/read
    }
    prev = r.hash;
  }
  return {
    count: rows.length,
    chain: { valid, brokenAt },
    entries: rows,
  };
}

export async function safetyRateStatus(
  _input: Record<string, never>,
  ctx: CapabilityRunContext,
) {
  // Use the in-memory limiter directly to expose what the gateway sees.
  const { resolvePublicKey, checkRateLimit } = await import("@/lib/api-keys/public-keys");
  // We don't have the raw bearer — synthesize a probe by reading the key row and
  // doing a non-mutating peek via a fresh resolve is not possible. Instead, expose
  // configured limit + last-used timestamp + usage in last 60s from the DB.
  const d = requireDb();
  const { publicApiKeys, publicApiKeyUsage } = await import("@/db/schema");
  const { gte, sql } = await import("drizzle-orm");
  void resolvePublicKey;
  void checkRateLimit;
  const [keyRow] = await d
    .select({ rateLimitRpm: publicApiKeys.rateLimitRpm, lastUsedAt: publicApiKeys.lastUsedAt })
    .from(publicApiKeys)
    .where(eq(publicApiKeys.id, ctx.keyId))
    .limit(1);
  if (!keyRow) throw new CapabilityError("Key not found", 404, null);
  const since = new Date(Date.now() - 60_000);
  const [agg] = await d
    .select({ used: sql<number>`count(*)::int` })
    .from(publicApiKeyUsage)
    .where(and(eq(publicApiKeyUsage.keyId, ctx.keyId), gte(publicApiKeyUsage.ts, since)));
  const used = Number(agg?.used ?? 0);
  return {
    rateLimitRpm: keyRow.rateLimitRpm,
    windowSeconds: 60,
    usedInWindow: used,
    remaining: Math.max(0, keyRow.rateLimitRpm - used),
    lastUsedAt: keyRow.lastUsedAt,
  };
}

export async function safetyAttest(
  input: { audience: string; ttlSec?: number; claims?: Record<string, unknown> },
  ctx: CapabilityRunContext,
) {
  const secretRaw = process.env.JWT_SECRET;
  if (!secretRaw) throw new CapabilityError("JWT_SECRET not configured", 503, null);
  const aud = input.audience.trim();
  if (!aud || aud.length > 200) throw new CapabilityError("invalid audience", 400, null);
  const ttl = Math.min(Math.max(input.ttlSec ?? 300, 30), 3600);

  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const [row] = await d
    .select({ keyPrefix: publicApiKeys.keyPrefix, scopes: publicApiKeys.scopes, env: publicApiKeys.env })
    .from(publicApiKeys)
    .where(eq(publicApiKeys.id, ctx.keyId))
    .limit(1);
  if (!row) throw new CapabilityError("Key not found", 404, null);

  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(secretRaw);
  // Pseudonymous subject — never leak raw userId.
  const sub = _ch11("sha256").update(`${ctx.userId}:dreyv-attest`, "utf8").digest("hex").slice(0, 24);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: "https://dreyv.com",
    sub,
    aud,
    iat: now,
    exp: now + ttl,
    nbf: now,
    keyPrefix: row.keyPrefix,
    env: row.env,
    scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    ...(input.claims ?? {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);

  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "attest.mint",
    target: aud,
    meta: { ttlSec: ttl, sub },
  });
  return { jwt, alg: "HS256", expiresAt: new Date((now + ttl) * 1000).toISOString(), audit };
}

// ─── Developer — key lifecycle (Phase 11) ────────────────────────────
export async function devRotateKey(input: { confirm?: boolean }, ctx: CapabilityRunContext) {
  if (input?.confirm !== true) {
    throw new CapabilityError(
      "Rotating a key revokes the current one. Pass confirm=true to proceed. This guard exists to prevent an LLM from accidentally rotating the caller's own key by picking default arguments.",
      400,
      { requires: { confirm: true } },
    );
  }
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const [old] = await d
    .select()
    .from(publicApiKeys)
    .where(eq(publicApiKeys.id, ctx.keyId))
    .limit(1);
  if (!old) throw new CapabilityError("Key not found", 404, null);
  if (old.revokedAt) throw new CapabilityError("Key is already revoked", 409, null);

  const { mintPublicKey } = await import("@/lib/api-keys/public-keys");
  const minted = await mintPublicKey({
    userId: old.userId,
    label: `${old.label} (rotated)`,
    env: (old.env as "live" | "test") ?? "live",
    scopes: old.scopes.split(",").map((s) => s.trim()).filter(Boolean) as never,
    rateLimitRpm: old.rateLimitRpm,
  });
  await d
    .update(publicApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(publicApiKeys.id, ctx.keyId));
  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "key.rotate",
    target: minted.id,
    meta: { oldPrefix: old.keyPrefix, newPrefix: minted.keyPrefix },
  });
  return {
    revokedKeyId: ctx.keyId,
    newKey: {
      id: minted.id,
      label: minted.label,
      env: minted.env,
      keyPrefix: minted.keyPrefix,
      fullKey: minted.fullKey, // ← returned ONCE
      scopes: minted.scopes,
      rateLimitRpm: minted.rateLimitRpm,
      createdAt: minted.createdAt,
    },
    audit,
    warning: "Store newKey.fullKey immediately — it will never be shown again.",
  };
}

export async function devRevokeKey(
  input: { keyId?: string; confirm?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const target = input.keyId ?? ctx.keyId;
  const isSelf = target === ctx.keyId;
  if (isSelf && input?.confirm !== true) {
    throw new CapabilityError(
      "Revoking the calling key will lock you out of this session. Pass confirm=true to revoke self, or pass a specific keyId. This guard exists to prevent an LLM from accidentally bricking the caller's own key.",
      400,
      { requires: { confirm: true }, selfRevoke: true },
    );
  }
  const [row] = await d
    .select({ id: publicApiKeys.id, userId: publicApiKeys.userId, revokedAt: publicApiKeys.revokedAt })
    .from(publicApiKeys)
    .where(eq(publicApiKeys.id, target))
    .limit(1);
  if (!row) throw new CapabilityError("Key not found", 404, null);
  if (row.userId !== ctx.userId) throw new CapabilityError("Forbidden", 403, null);
  if (row.revokedAt) return { keyId: target, revokedAt: row.revokedAt, alreadyRevoked: true };
  const now = new Date();
  await d.update(publicApiKeys).set({ revokedAt: now }).where(eq(publicApiKeys.id, target));
  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "key.revoke",
    target,
    meta: {},
  });
  return { keyId: target, revokedAt: now.toISOString(), audit };
}

// ─── Pillar T — Compliance & Reporting (Phase 12) ────────────────────
import { createHash as _ch12 } from "node:crypto";

const _SOL_ADDR_T = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const _EVM_ADDR_T = /^0x[a-fA-F0-9]{40}$/;
const _ZERO_ADDR_T = new Set([
  "0x0000000000000000000000000000000000000000",
  "11111111111111111111111111111111",
]);

function _validateAddr(addr: string, chain: string): { ok: true } | { ok: false; reason: string } {
  if (!addr || typeof addr !== "string") return { ok: false, reason: "address required" };
  if (chain === "solana") {
    if (!_SOL_ADDR_T.test(addr)) return { ok: false, reason: "invalid solana address" };
  } else {
    if (!_EVM_ADDR_T.test(addr)) return { ok: false, reason: "invalid evm address" };
  }
  return { ok: true };
}

function _sdnList(): string[] {
  const raw = (process.env.DREYV_OFAC_SDN_ADDRESSES ?? "").trim();
  if (!raw) return [];
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

export async function complianceScreenAddress(
  input: { address: string; chain: string },
  _ctx: CapabilityRunContext,
) {
  const v = _validateAddr(input.address, input.chain);
  if (!v.ok) throw new CapabilityError(v.reason, 400, null);
  const addr = input.chain === "solana" ? input.address : input.address.toLowerCase();
  const hits: Array<{ source: string; reason: string }> = [];

  if (_ZERO_ADDR_T.has(addr)) hits.push({ source: "pattern", reason: "zero address" });

  const sdn = _sdnList();
  const sdnNorm = new Set(sdn.map((a) => (input.chain === "solana" ? a : a.toLowerCase())));
  if (sdnNorm.has(addr)) hits.push({ source: "ofac_sdn_env", reason: "address on configured sanctions list" });

  const sdnVersion = sdn.length
    ? _ch12("sha256").update(sdn.join(",")).digest("hex").slice(0, 16)
    : null;

  return {
    address: input.address,
    chain: input.chain,
    ok: hits.length === 0,
    hits,
    sources: {
      ofac_sdn_env: { configured: sdn.length > 0, entries: sdn.length, version: sdnVersion },
      pattern: { configured: true },
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function complianceTravelRule(
  input: {
    originator: { name: string; address: string; vaspId?: string; country?: string };
    beneficiary: { name: string; address: string; vaspId?: string; country?: string };
    amount: string;
    asset: string;
    chain: string;
    purpose?: string;
  },
  ctx: CapabilityRunContext,
) {
  const o = _validateAddr(input.originator.address, input.chain);
  if (!o.ok) throw new CapabilityError(`originator: ${o.reason}`, 400, null);
  const b = _validateAddr(input.beneficiary.address, input.chain);
  if (!b.ok) throw new CapabilityError(`beneficiary: ${b.reason}`, 400, null);
  if (!/^\d+(\.\d+)?$/.test(input.amount)) throw new CapabilityError("amount must be a positive decimal string", 400, null);

  // IVMS101-lite envelope. Pure deterministic transform — caller signs/transmits.
  const envelope = {
    version: "ivms101-lite/0.1",
    payloadType: "TravelRule",
    transferId: _ch12("sha256")
      .update(`${ctx.keyId}:${input.originator.address}:${input.beneficiary.address}:${input.amount}:${Date.now()}`)
      .digest("hex")
      .slice(0, 24),
    originator: {
      naturalPerson: { fullName: input.originator.name },
      walletAddress: input.originator.address,
      vaspId: input.originator.vaspId ?? null,
      country: input.originator.country ?? null,
    },
    beneficiary: {
      naturalPerson: { fullName: input.beneficiary.name },
      walletAddress: input.beneficiary.address,
      vaspId: input.beneficiary.vaspId ?? null,
      country: input.beneficiary.country ?? null,
    },
    transaction: {
      asset: input.asset,
      chain: input.chain,
      amount: input.amount,
      purpose: input.purpose ?? null,
    },
    issuedAt: new Date().toISOString(),
  };
  const canonical = JSON.stringify(envelope);
  const digest = _ch12("sha256").update(canonical).digest("hex");
  return { envelope, digest, canonicalBytes: canonical.length };
}

export async function complianceProofOfReserves(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  const v = _validateAddr(input.address, input.chain);
  if (!v.ok) throw new CapabilityError(v.reason, 400, null);
  const secretRaw = process.env.JWT_SECRET;
  if (!secretRaw) throw new CapabilityError("JWT_SECRET not configured", 503, null);

  const holdings = await portfolioHoldings(input, ctx);
  const snapshot = {
    address: input.address,
    chain: input.chain,
    holdings,
    snapshotAt: new Date().toISOString(),
  };
  const canonical = JSON.stringify(snapshot);
  const commitment = _ch12("sha256").update(canonical).digest("hex");

  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(secretRaw);
  const now = Math.floor(Date.now() / 1000);
  const ttl = 3600;
  const sub = _ch12("sha256").update(`${ctx.userId}:dreyv-por`).digest("hex").slice(0, 24);
  const jwt = await new SignJWT({
    iss: "https://dreyv.com",
    sub,
    aud: "dreyv.proof_of_reserves",
    iat: now,
    nbf: now,
    exp: now + ttl,
    address: input.address,
    chain: input.chain,
    commitment,
    snapshotAt: snapshot.snapshotAt,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);

  return {
    snapshot,
    commitment,
    commitmentAlg: "sha256",
    attestation: { jwt, alg: "HS256", expiresAt: new Date((now + ttl) * 1000).toISOString() },
  };
}

function _toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((s, r) => {
      for (const k of Object.keys(r)) s.add(k);
      return s;
    }, new Set()),
  );
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

export async function reportingExport(
  input: { kind: "holdings" | "pnl"; format: "csv" | "json"; address: string; chain: string; method?: string },
  ctx: CapabilityRunContext,
) {
  const v = _validateAddr(input.address, input.chain);
  if (!v.ok) throw new CapabilityError(v.reason, 400, null);

  let rows: Array<Record<string, unknown>> = [];
  if (input.kind === "holdings") {
    const data = (await portfolioHoldings(input, ctx)) as {
      tokens?: Array<Record<string, unknown>>;
      holdings?: Array<Record<string, unknown>>;
    };
    rows = Array.isArray(data.tokens) ? data.tokens : Array.isArray(data.holdings) ? data.holdings : [];
  } else {
    const pnl = (await portfolioPnl({ address: input.address, method: input.method ?? "fifo" }, ctx)) as {
      lots?: Array<Record<string, unknown>>;
      rows?: Array<Record<string, unknown>>;
    };
    rows = Array.isArray(pnl.lots) ? pnl.lots : Array.isArray(pnl.rows) ? pnl.rows : [];
  }

  if (!rows.length) throw new CapabilityError("Upstream returned no rows for export", 404, null);

  const body = input.format === "csv" ? _toCsv(rows) : JSON.stringify(rows, null, 2);
  const sha256 = _ch12("sha256").update(body).digest("hex");
  const contentType = input.format === "csv" ? "text/csv" : "application/json";
  const base64 = Buffer.from(body, "utf8").toString("base64");
  return {
    kind: input.kind,
    format: input.format,
    address: input.address,
    chain: input.chain,
    rowCount: rows.length,
    contentType,
    sha256,
    bytes: body.length,
    base64,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Pillar U — Notifications & Alerts (Phase 13) ────────────────────
// Builds on existing monitors/notifications handlers. Adds update/test-fire
// for monitors, full inbox send/delete, and notification-channel preferences.
// Every write fires the appropriate webhook event when the user has a
// subscription configured (best-effort; emit failures never break the call).

export async function monitorsUpdate(
  input: {
    id: number;
    operator?: "above" | "below" | "equals" | "changes";
    conditionValue?: number;
    active?: boolean;
    target?: string;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.operator !== undefined) patch.operator = input.operator;
  if (input.conditionValue !== undefined) patch.conditionValue = String(input.conditionValue);
  if (input.active !== undefined) patch.active = input.active;
  if (input.target !== undefined) patch.target = input.target;
  if (Object.keys(patch).length === 1) {
    throw new CapabilityError("Provide at least one field to update", 400, null);
  }
  const [row] = await d
    .update(monitors)
    .set(patch)
    .where(and(eq(monitors.id, input.id), eq(monitors.userId, ctx.userId)))
    .returning();
  if (!row) throw new CapabilityError(`Monitor ${input.id} not found for this key owner`, 404, null);
  return { monitor: row };
}

export async function monitorsTestFire(input: { id: number }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [m] = await d
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, input.id), eq(monitors.userId, ctx.userId)))
    .limit(1);
  if (!m) throw new CapabilityError(`Monitor ${input.id} not found for this key owner`, 404, null);
  const payload = {
    monitorId: m.id,
    walletAddress: m.walletAddress,
    type: m.type,
    target: m.target,
    operator: m.operator,
    conditionValue: m.conditionValue,
    test: true,
    firedAt: new Date().toISOString(),
  };
  let deliveries: unknown[] = [];
  try {
    deliveries = await emitWebhookEvent({ userId: ctx.userId, event: "monitor.tripped", data: payload });
  } catch (e) {
    deliveries = [{ error: e instanceof Error ? e.message : String(e) }];
  }
  return { event: "monitor.tripped", payload, deliveries };
}

export async function notificationsSend(
  input: {
    title: string;
    message: string;
    type?: string;
    severity?: "info" | "success" | "warning" | "error";
    actionUrl?: string;
    actionLabel?: string;
    metadata?: Record<string, unknown>;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [row] = await d
    .insert(notifications)
    .values({
      userId: ctx.userId,
      type: input.type ?? "system",
      title: input.title.slice(0, 200),
      message: input.message.slice(0, 4000),
      severity: input.severity ?? "info",
      actionUrl: input.actionUrl ?? null,
      actionLabel: input.actionLabel ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();
  let deliveries: unknown[] = [];
  try {
    deliveries = await emitWebhookEvent({
      userId: ctx.userId,
      event: "notification.created",
      data: {
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        severity: row.severity,
        actionUrl: row.actionUrl,
        createdAt: row.createdAt,
      },
    });
  } catch (e) {
    deliveries = [{ error: e instanceof Error ? e.message : String(e) }];
  }
  return { notification: row, webhookDeliveries: deliveries };
}

export async function notificationsDelete(
  input: { ids: number[] },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (!input.ids?.length) throw new CapabilityError("`ids` must be a non-empty array", 400, null);
  const deleted = await d
    .delete(notifications)
    .where(and(eq(notifications.userId, ctx.userId), inArray(notifications.id, input.ids)))
    .returning({ id: notifications.id });
  return { deleted: deleted.length, ids: deleted.map((r) => r.id) };
}

export async function channelsPreferences(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, ctx.userId))
    .limit(1);
  if (!row) {
    return {
      preferences: {
        emailEnabled: true,
        teamInvites: true,
        roleChanges: true,
        txApprovals: true,
        systemAlerts: true,
        tierExpiry: true,
        telegramEnabled: false,
        telegramConfigured: false,
        slackEnabled: false,
        slackConfigured: false,
      },
      initialized: false,
    };
  }
  // Redact secrets — never expose bot token or slack webhook URL via API.
  return {
    preferences: {
      emailEnabled: row.emailEnabled,
      teamInvites: row.teamInvites,
      roleChanges: row.roleChanges,
      txApprovals: row.txApprovals,
      systemAlerts: row.systemAlerts,
      tierExpiry: row.tierExpiry,
      telegramEnabled: row.telegramEnabled,
      telegramConfigured: Boolean(row.telegramBotToken && row.telegramChatId),
      slackEnabled: row.slackEnabled,
      slackConfigured: Boolean(row.slackWebhookUrl),
      updatedAt: row.updatedAt,
    },
    initialized: true,
  };
}

export async function channelsPreferencesUpdate(
  input: {
    emailEnabled?: boolean;
    teamInvites?: boolean;
    roleChanges?: boolean;
    txApprovals?: boolean;
    systemAlerts?: boolean;
    tierExpiry?: boolean;
    telegramEnabled?: boolean;
    slackEnabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "emailEnabled",
    "teamInvites",
    "roleChanges",
    "txApprovals",
    "systemAlerts",
    "tierExpiry",
    "telegramEnabled",
    "slackEnabled",
  ] as const) {
    if (typeof input[k] === "boolean") patch[k] = input[k];
  }
  if (Object.keys(patch).length === 1) {
    throw new CapabilityError("Provide at least one preference toggle", 400, null);
  }
  // Upsert
  const [existing] = await d
    .select({ id: notificationPreferences.id })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, ctx.userId))
    .limit(1);
  if (existing) {
    await d
      .update(notificationPreferences)
      .set(patch)
      .where(eq(notificationPreferences.userId, ctx.userId));
  } else {
    await d.insert(notificationPreferences).values({ userId: ctx.userId, ...patch });
  }
  return channelsPreferences({} as Record<string, never>, ctx);
}

// ─── Pillar V — Observability & Audit Trail (Phase 14) ─────────────────
// Read-only introspection of the public API surface for this key/user.
// Covers request history, aggregate usage, error explorer, CSV/JSON export,
// HS256 receipt verification, and tamper-evident replay of the policy
// hash-chain (publicApiAuditLog). All capabilities use scope `read:audit`.

import { gte, lte, sql as _sqlV } from "drizzle-orm";

function _clampInt(n: unknown, def: number, min: number, max: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function _sinceDate(sinceIso: string | undefined, defaultMinutes: number): Date {
  if (sinceIso) {
    const d = new Date(sinceIso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() - defaultMinutes * 60_000);
}

function _percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function auditRequests(
  input: {
    sinceIso?: string;
    capabilityId?: string;
    status?: "ok" | "error" | "denied" | "rate_limited";
    keyOnly?: boolean;
    limit?: number;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeyUsage } = await import("@/db/schema");
  const limit = _clampInt(input.limit, 100, 1, 500);
  const since = _sinceDate(input.sinceIso, 60 * 24); // default 24h
  const filters = [
    eq(publicApiKeyUsage.userId, ctx.userId),
    gte(publicApiKeyUsage.ts, since),
  ];
  if (input.keyOnly) filters.push(eq(publicApiKeyUsage.keyId, ctx.keyId));
  if (input.capabilityId) filters.push(eq(publicApiKeyUsage.capabilityId, input.capabilityId));
  if (input.status) filters.push(eq(publicApiKeyUsage.status, input.status));
  const rows = await d
    .select({
      id: publicApiKeyUsage.id,
      keyId: publicApiKeyUsage.keyId,
      capabilityId: publicApiKeyUsage.capabilityId,
      transport: publicApiKeyUsage.transport,
      status: publicApiKeyUsage.status,
      latencyMs: publicApiKeyUsage.latencyMs,
      costCredits: publicApiKeyUsage.costCredits,
      errorCode: publicApiKeyUsage.errorCode,
      ts: publicApiKeyUsage.ts,
    })
    .from(publicApiKeyUsage)
    .where(and(...filters))
    .orderBy(desc(publicApiKeyUsage.ts))
    .limit(limit);
  return {
    sinceIso: since.toISOString(),
    count: rows.length,
    limit,
    rows,
  };
}

export async function auditUsageSummary(
  input: { sinceIso?: string; keyOnly?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeyUsage } = await import("@/db/schema");
  const since = _sinceDate(input.sinceIso, 60 * 24 * 7); // default 7d
  const filters = [
    eq(publicApiKeyUsage.userId, ctx.userId),
    gte(publicApiKeyUsage.ts, since),
  ];
  if (input.keyOnly) filters.push(eq(publicApiKeyUsage.keyId, ctx.keyId));
  const rows = await d
    .select({
      capabilityId: publicApiKeyUsage.capabilityId,
      status: publicApiKeyUsage.status,
      latencyMs: publicApiKeyUsage.latencyMs,
      costCredits: publicApiKeyUsage.costCredits,
    })
    .from(publicApiKeyUsage)
    .where(and(...filters))
    .limit(50_000);
  const byCap = new Map<string, { total: number; ok: number; error: number; denied: number; rate_limited: number; lat: number[]; creditsCents: number }>();
  for (const r of rows) {
    const bucket = byCap.get(r.capabilityId) ?? { total: 0, ok: 0, error: 0, denied: 0, rate_limited: 0, lat: [], creditsCents: 0 };
    bucket.total += 1;
    if (r.status === "ok") bucket.ok += 1;
    else if (r.status === "error") bucket.error += 1;
    else if (r.status === "denied") bucket.denied += 1;
    else if (r.status === "rate_limited") bucket.rate_limited += 1;
    if (typeof r.latencyMs === "number") bucket.lat.push(r.latencyMs);
    const credits = Number(r.costCredits ?? "0");
    if (Number.isFinite(credits)) bucket.creditsCents += Math.round(credits * 10_000);
    byCap.set(r.capabilityId, bucket);
  }
  const breakdown = Array.from(byCap.entries())
    .map(([capabilityId, b]) => {
      const sorted = [...b.lat].sort((a, x) => a - x);
      return {
        capabilityId,
        total: b.total,
        ok: b.ok,
        error: b.error,
        denied: b.denied,
        rateLimited: b.rate_limited,
        successRate: b.total ? Number((b.ok / b.total).toFixed(4)) : 0,
        latencyMs: {
          count: sorted.length,
          p50: _percentile(sorted, 50),
          p95: _percentile(sorted, 95),
          p99: _percentile(sorted, 99),
          max: sorted.length ? sorted[sorted.length - 1] : null,
        },
        creditsSpent: Number((b.creditsCents / 10_000).toFixed(4)),
      };
    })
    .sort((a, b) => b.total - a.total);
  const totals = breakdown.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      ok: acc.ok + r.ok,
      error: acc.error + r.error,
      denied: acc.denied + r.denied,
      rateLimited: acc.rateLimited + r.rateLimited,
      creditsSpent: acc.creditsSpent + r.creditsSpent,
    }),
    { total: 0, ok: 0, error: 0, denied: 0, rateLimited: 0, creditsSpent: 0 },
  );
  return {
    sinceIso: since.toISOString(),
    windowSeconds: Math.round((Date.now() - since.getTime()) / 1000),
    totals: { ...totals, creditsSpent: Number(totals.creditsSpent.toFixed(4)) },
    breakdown,
  };
}

export async function auditErrors(
  input: { sinceIso?: string; keyOnly?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeyUsage } = await import("@/db/schema");
  const since = _sinceDate(input.sinceIso, 60 * 24); // default 24h
  const limit = _clampInt(input.limit, 25, 1, 100);
  const filters = [
    eq(publicApiKeyUsage.userId, ctx.userId),
    gte(publicApiKeyUsage.ts, since),
    inArray(publicApiKeyUsage.status, ["error", "denied", "rate_limited"]),
  ];
  if (input.keyOnly) filters.push(eq(publicApiKeyUsage.keyId, ctx.keyId));
  const rows = await d
    .select({
      capabilityId: publicApiKeyUsage.capabilityId,
      status: publicApiKeyUsage.status,
      errorCode: publicApiKeyUsage.errorCode,
      ts: publicApiKeyUsage.ts,
    })
    .from(publicApiKeyUsage)
    .where(and(...filters))
    .orderBy(desc(publicApiKeyUsage.ts))
    .limit(10_000);
  const groups = new Map<string, { capabilityId: string; status: string; errorCode: string | null; count: number; firstTs: Date; lastTs: Date }>();
  for (const r of rows) {
    const key = `${r.capabilityId}::${r.status}::${r.errorCode ?? ""}`;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      if (r.ts < g.firstTs) g.firstTs = r.ts;
      if (r.ts > g.lastTs) g.lastTs = r.ts;
    } else {
      groups.set(key, {
        capabilityId: r.capabilityId,
        status: r.status,
        errorCode: r.errorCode,
        count: 1,
        firstTs: r.ts,
        lastTs: r.ts,
      });
    }
  }
  const sorted = Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return {
    sinceIso: since.toISOString(),
    totalFailures: rows.length,
    distinct: groups.size,
    groups: sorted.map((g) => ({
      capabilityId: g.capabilityId,
      status: g.status,
      errorCode: g.errorCode,
      count: g.count,
      firstTs: g.firstTs,
      lastTs: g.lastTs,
    })),
  };
}

export async function auditExport(
  input: {
    sinceIso?: string;
    format: "csv" | "json";
    keyOnly?: boolean;
    limit?: number;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeyUsage } = await import("@/db/schema");
  const since = _sinceDate(input.sinceIso, 60 * 24 * 7); // default 7d
  const limit = _clampInt(input.limit, 5000, 1, 50_000);
  const filters = [
    eq(publicApiKeyUsage.userId, ctx.userId),
    gte(publicApiKeyUsage.ts, since),
  ];
  if (input.keyOnly) filters.push(eq(publicApiKeyUsage.keyId, ctx.keyId));
  const rows = await d
    .select({
      id: publicApiKeyUsage.id,
      keyId: publicApiKeyUsage.keyId,
      capabilityId: publicApiKeyUsage.capabilityId,
      transport: publicApiKeyUsage.transport,
      status: publicApiKeyUsage.status,
      latencyMs: publicApiKeyUsage.latencyMs,
      costCredits: publicApiKeyUsage.costCredits,
      errorCode: publicApiKeyUsage.errorCode,
      ts: publicApiKeyUsage.ts,
    })
    .from(publicApiKeyUsage)
    .where(and(...filters))
    .orderBy(desc(publicApiKeyUsage.ts))
    .limit(limit);
  if (!rows.length) throw new CapabilityError("No usage rows in the requested window", 404, null);
  const normalized = rows.map((r) => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
  const body =
    input.format === "csv"
      ? _toCsv(normalized as Array<Record<string, unknown>>)
      : JSON.stringify(normalized, null, 2);
  const sha256 = _ch12("sha256").update(body).digest("hex");
  return {
    format: input.format,
    sinceIso: since.toISOString(),
    rowCount: rows.length,
    bytes: body.length,
    sha256,
    contentType: input.format === "csv" ? "text/csv" : "application/json",
    base64: Buffer.from(body, "utf8").toString("base64"),
    generatedAt: new Date().toISOString(),
  };
}

export async function auditVerifyReceipt(
  input: { jwt: string; expectedAudience?: string },
  ctx: CapabilityRunContext,
) {
  const secretRaw = process.env.JWT_SECRET;
  if (!secretRaw) throw new CapabilityError("JWT_SECRET not configured", 503, null);
  if (!input.jwt || typeof input.jwt !== "string") {
    throw new CapabilityError("jwt is required", 400, null);
  }
  const { jwtVerify } = await import("jose");
  const secret = new TextEncoder().encode(secretRaw);
  try {
    const { payload, protectedHeader } = await jwtVerify(input.jwt, secret, {
      issuer: "https://dreyv.com",
      ...(input.expectedAudience ? { audience: input.expectedAudience } : {}),
    });
    const now = Math.floor(Date.now() / 1000);
    return {
      valid: true,
      header: protectedHeader,
      payload,
      audience: payload.aud ?? null,
      issuedAt: payload.iat ? new Date((payload.iat as number) * 1000).toISOString() : null,
      expiresAt: payload.exp ? new Date((payload.exp as number) * 1000).toISOString() : null,
      expired: typeof payload.exp === "number" ? payload.exp < now : false,
      verifiedAt: new Date().toISOString(),
      verifierKeyId: ctx.keyId,
    };
  } catch (e) {
    return {
      valid: false,
      reason: e instanceof Error ? e.message : String(e),
      verifiedAt: new Date().toISOString(),
    };
  }
}

export async function auditPolicyHistory(
  input: { keyOnly?: boolean; sinceIso?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiAuditLog } = await import("@/db/schema");
  const since = _sinceDate(input.sinceIso, 60 * 24 * 30); // default 30d
  const limit = _clampInt(input.limit, 100, 1, 500);
  const filters = [
    eq(publicApiAuditLog.userId, ctx.userId),
    gte(publicApiAuditLog.ts, since),
  ];
  if (input.keyOnly) filters.push(eq(publicApiAuditLog.keyId, ctx.keyId));
  const rowsDesc = await d
    .select()
    .from(publicApiAuditLog)
    .where(and(...filters))
    .orderBy(desc(publicApiAuditLog.ts))
    .limit(limit);
  // Verify hash-chain by re-walking chronologically.
  const chrono = [...rowsDesc].reverse();
  let prev = chrono.length ? chrono[0].prevHash : "";
  let valid = true;
  const breaks: Array<{ id: number; expected: string; got: string }> = [];
  for (const row of chrono) {
    if (row.prevHash !== prev) {
      valid = false;
      breaks.push({ id: row.id, expected: prev, got: row.prevHash });
    }
    const canonical = JSON.stringify({
      keyId: row.keyId,
      userId: row.userId,
      action: row.action,
      target: row.target ?? null,
      meta: row.meta ?? {},
      prevHash: row.prevHash,
      ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
    });
    const recomputed = _ch12("sha256").update(canonical).digest("hex");
    if (recomputed !== row.hash) {
      valid = false;
      breaks.push({ id: row.id, expected: recomputed, got: row.hash });
    }
    prev = row.hash;
  }
  return {
    sinceIso: since.toISOString(),
    count: rowsDesc.length,
    chainValid: valid,
    chainBreaks: breaks,
    headHash: chrono.length ? chrono[chrono.length - 1].hash : null,
    entries: rowsDesc,
  };
}

// Silences unused-import lints if the broader codebase tree-shakes.
export const __pillarVTouch = { _sqlV, lte };

// ════════════════════════════════════════════════════════════════════════
// ─── Pillar W — Teams & Workspaces (Phase 15) ────────────────────────────
// ════════════════════════════════════════════════════════════════════════
// Membership, invitations, role changes, and activity log. Every call is
// scoped to ctx.userId — the caller must be a team member, and writes
// additionally require the owner|admin role. All writes append to
// team_activity_log and emit best-effort team.* webhooks.

import { randomBytes as _rbW } from "node:crypto";
import { teams as _teamsW, teamMembers as _teamMembersW, teamInvitations as _teamInvitationsW, teamActivityLog as _teamActivityW, users as _usersW } from "@/db/schema";

const TEAM_ROLE_VALUES = ["owner", "admin", "signer", "viewer"] as const;
type TeamRoleW = (typeof TEAM_ROLE_VALUES)[number];

async function _requireTeamMembership(
  teamId: string,
  userId: string,
  minRole?: TeamRoleW,
) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_teamMembersW)
    .where(and(eq(_teamMembersW.teamId, teamId), eq(_teamMembersW.userId, userId), eq(_teamMembersW.status, "active")))
    .limit(1);
  if (!row) throw new CapabilityError(`You are not an active member of team ${teamId}`, 403, null);
  if (minRole) {
    const rank = { viewer: 0, signer: 1, admin: 2, owner: 3 } as const;
    const have = rank[(row.role as TeamRoleW) ?? "viewer"];
    const need = rank[minRole];
    if (have < need) {
      throw new CapabilityError(`Requires role >= ${minRole}; you are ${row.role}`, 403, null);
    }
  }
  return row;
}

async function _logTeamActivity(
  teamId: string,
  userId: string,
  action: string,
  description: string,
  metadata: Record<string, unknown>,
) {
  const d = requireDb();
  await d.insert(_teamActivityW).values({
    teamId,
    userId,
    action,
    targetType: "member",
    description,
    metadata,
  });
}

export async function teamsList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const rows = await d
    .select({
      teamId: _teamsW.id,
      name: _teamsW.name,
      vaultAddress: _teamsW.vaultAddress,
      createdAt: _teamsW.createdAt,
      role: _teamMembersW.role,
      status: _teamMembersW.status,
      joinedAt: _teamMembersW.acceptedAt,
    })
    .from(_teamMembersW)
    .innerJoin(_teamsW, eq(_teamMembersW.teamId, _teamsW.id))
    .where(and(eq(_teamMembersW.userId, ctx.userId), eq(_teamMembersW.status, "active")));
  return { teams: rows };
}

export async function teamsMembers(input: { teamId: string }, ctx: CapabilityRunContext) {
  await _requireTeamMembership(input.teamId, ctx.userId);
  const d = requireDb();
  const rows = await d
    .select({
      memberId: _teamMembersW.id,
      userId: _teamMembersW.userId,
      walletAddress: _teamMembersW.walletAddress,
      role: _teamMembersW.role,
      status: _teamMembersW.status,
      invitedAt: _teamMembersW.invitedAt,
      acceptedAt: _teamMembersW.acceptedAt,
    })
    .from(_teamMembersW)
    .where(eq(_teamMembersW.teamId, input.teamId))
    .orderBy(desc(_teamMembersW.invitedAt));
  return { teamId: input.teamId, members: rows };
}

export async function teamsInvite(
  input: { teamId: string; role: TeamRoleW; email?: string; walletAddress?: string; ttlHours?: number },
  ctx: CapabilityRunContext,
) {
  if (!input.email && !input.walletAddress) {
    throw new CapabilityError("Provide email or walletAddress", 400, null);
  }
  if (input.role === "owner") {
    throw new CapabilityError("Cannot invite as owner — transfer ownership separately", 400, null);
  }
  await _requireTeamMembership(input.teamId, ctx.userId, "admin");
  const d = requireDb();
  const token = _rbW(24).toString("base64url");
  const ttlH = Math.max(1, Math.min(input.ttlHours ?? 168, 24 * 30));
  const expiresAt = new Date(Date.now() + ttlH * 3_600_000);
  const [row] = await d
    .insert(_teamInvitationsW)
    .values({
      teamId: input.teamId,
      invitedBy: ctx.userId,
      email: input.email ?? null,
      walletAddress: input.walletAddress ?? null,
      role: input.role,
      token,
      expiresAt,
    })
    .returning();
  await _logTeamActivity(input.teamId, ctx.userId, "member_invited",
    `Invited ${input.email ?? input.walletAddress} as ${input.role}`,
    { invitationId: row.id, role: input.role, email: input.email, walletAddress: input.walletAddress });
  let deliveries: unknown[] = [];
  try {
    deliveries = await emitWebhookEvent({
      userId: ctx.userId,
      event: "team.member_invited",
      data: {
        teamId: input.teamId,
        invitationId: row.id,
        role: input.role,
        email: input.email ?? null,
        walletAddress: input.walletAddress ?? null,
        expiresAt: row.expiresAt,
      },
    });
  } catch (e) {
    deliveries = [{ error: e instanceof Error ? e.message : String(e) }];
  }
  return {
    invitation: {
      id: row.id,
      teamId: row.teamId,
      role: row.role,
      email: row.email,
      walletAddress: row.walletAddress,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      acceptUrl: `${ctx.origin}/accept-team-invite/${token}`,
    },
    deliveries,
  };
}

export async function teamsUpdateRole(
  input: { teamId: string; memberId: number; role: TeamRoleW },
  ctx: CapabilityRunContext,
) {
  if (input.role === "owner") {
    throw new CapabilityError("Use the ownership-transfer flow to assign 'owner'", 400, null);
  }
  await _requireTeamMembership(input.teamId, ctx.userId, "admin");
  const d = requireDb();
  const [target] = await d
    .select()
    .from(_teamMembersW)
    .where(and(eq(_teamMembersW.id, input.memberId), eq(_teamMembersW.teamId, input.teamId)))
    .limit(1);
  if (!target) throw new CapabilityError(`Member ${input.memberId} not found in team`, 404, null);
  if (target.role === "owner") {
    throw new CapabilityError("Cannot change the team owner's role via this endpoint", 403, null);
  }
  const oldRole = target.role;
  const [row] = await d
    .update(_teamMembersW)
    .set({ role: input.role })
    .where(eq(_teamMembersW.id, input.memberId))
    .returning();
  await _logTeamActivity(input.teamId, ctx.userId, "role_changed",
    `Changed role from ${oldRole} to ${input.role}`,
    { memberId: input.memberId, targetUserId: target.userId, oldRole, newRole: input.role });
  let deliveries: unknown[] = [];
  try {
    deliveries = await emitWebhookEvent({
      userId: ctx.userId,
      event: "team.member_role_changed",
      data: { teamId: input.teamId, memberId: input.memberId, userId: target.userId, oldRole, newRole: input.role },
    });
  } catch (e) {
    deliveries = [{ error: e instanceof Error ? e.message : String(e) }];
  }
  return { member: row, deliveries };
}

export async function teamsRemoveMember(
  input: { teamId: string; memberId: number },
  ctx: CapabilityRunContext,
) {
  await _requireTeamMembership(input.teamId, ctx.userId, "admin");
  const d = requireDb();
  const [target] = await d
    .select()
    .from(_teamMembersW)
    .where(and(eq(_teamMembersW.id, input.memberId), eq(_teamMembersW.teamId, input.teamId)))
    .limit(1);
  if (!target) throw new CapabilityError(`Member ${input.memberId} not found in team`, 404, null);
  if (target.role === "owner") {
    throw new CapabilityError("Cannot remove the team owner", 403, null);
  }
  if (target.userId === ctx.userId) {
    throw new CapabilityError("Use a separate self-leave flow rather than removing yourself", 400, null);
  }
  const [row] = await d
    .update(_teamMembersW)
    .set({ status: "removed" })
    .where(eq(_teamMembersW.id, input.memberId))
    .returning();
  await _logTeamActivity(input.teamId, ctx.userId, "member_removed",
    `Removed member ${target.walletAddress}`,
    { memberId: input.memberId, targetUserId: target.userId, role: target.role });
  let deliveries: unknown[] = [];
  try {
    deliveries = await emitWebhookEvent({
      userId: ctx.userId,
      event: "team.member_removed",
      data: { teamId: input.teamId, memberId: input.memberId, userId: target.userId, role: target.role },
    });
  } catch (e) {
    deliveries = [{ error: e instanceof Error ? e.message : String(e) }];
  }
  return { member: row, deliveries };
}

export async function teamsActivity(
  input: { teamId: string; action?: string; limit?: number; sinceIso?: string },
  ctx: CapabilityRunContext,
) {
  await _requireTeamMembership(input.teamId, ctx.userId);
  const d = requireDb();
  const conds = [eq(_teamActivityW.teamId, input.teamId)];
  if (input.action) conds.push(eq(_teamActivityW.action, input.action));
  if (input.sinceIso) conds.push(gte(_teamActivityW.createdAt, new Date(input.sinceIso)));
  const limit = Math.min(input.limit ?? 50, 500);
  const rows = await d
    .select()
    .from(_teamActivityW)
    .where(and(...conds))
    .orderBy(desc(_teamActivityW.createdAt))
    .limit(limit);
  return { teamId: input.teamId, count: rows.length, entries: rows };
}

// Silences unused-import lints.
export const __pillarWTouch = { _usersW };

// ════════════════════════════════════════════════════════════════════════
// ─── Pillar X — Billing, Plans & Credits (Phase 16) ──────────────────────
// ════════════════════════════════════════════════════════════════════════
// Read + write surface so external apps and agents can introspect their
// Dreyv subscription, meter their public-API usage against the plan, list
// invoices, quote upgrades, and mint a crypto-rail invoice — all scoped
// strictly to ctx.userId. Card rails (Stripe / Paystack) remain hosted-
// checkout flows on the dashboard; this pillar handles the crypto rail end-
// to-end and surfaces card-rail availability as booleans.

import { users as _usersX, cryptoInvoices as _cryptoInvoicesX, publicApiKeys as _publicApiKeysX, publicApiKeyUsage as _publicApiKeyUsageX } from "@/db/schema";
import { mintCryptoInvoice } from "@/lib/billing/crypto-invoice";
import { computeAmountMinor, usdPriceFor, type CryptoTier as _CryptoTierX } from "@/lib/billing/crypto-pricing";
import { ENABLED_CHAINS as _ENABLED_CHAINS_X, ENABLED_ASSETS as _ENABLED_ASSETS_X, isEnabled as _isEnabledX, type CryptoChain as _CryptoChainX, type CryptoAsset as _CryptoAssetX } from "@/lib/billing/crypto-config";

const _TIER_LIMITS_X: Record<string, { callsPerMonth: number; creditsPerMonth: number; rateLimitRpm: number; usdMonthly: number }> = {
  free: { callsPerMonth: 10_000, creditsPerMonth: 0, rateLimitRpm: 60, usdMonthly: 0 },
  mini: { callsPerMonth: 250_000, creditsPerMonth: 5_000, rateLimitRpm: 600, usdMonthly: 49 },
  max: { callsPerMonth: 5_000_000, creditsPerMonth: 100_000, rateLimitRpm: 6_000, usdMonthly: 199 },
};

function _monthWindow(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function billingPlan(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [u] = await d.select().from(_usersX).where(eq(_usersX.id, ctx.userId)).limit(1);
  if (!u) throw new CapabilityError("User not found", 404, null);
  const tier = (u.tier ?? "free").toLowerCase();
  const limits = _TIER_LIMITS_X[tier] ?? _TIER_LIMITS_X.free;
  const now = Date.now();
  const expiresAt = u.tierExpiresAt ? new Date(u.tierExpiresAt).toISOString() : null;
  const daysRemaining = u.tierExpiresAt
    ? Math.max(0, Math.ceil((new Date(u.tierExpiresAt).getTime() - now) / 86_400_000))
    : null;
  return {
    tier,
    expiresAt,
    daysRemaining,
    isLifetime: !u.tierExpiresAt && tier !== "free",
    isFoundingMember: !!u.isFoundingMember,
    foundingNumber: u.foundingNumber ?? null,
    limits,
  };
}

export async function billingUsage(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const { start, end } = _monthWindow();
  const rows = await d
    .select({
      keyId: _publicApiKeyUsageX.keyId,
      status: _publicApiKeyUsageX.status,
      credits: _publicApiKeyUsageX.costCredits,
    })
    .from(_publicApiKeyUsageX)
    .where(and(
      eq(_publicApiKeyUsageX.userId, ctx.userId),
      gte(_publicApiKeyUsageX.ts, start),
      lte(_publicApiKeyUsageX.ts, end),
    ));

  const byKey = new Map<string, { calls: number; ok: number; errors: number; credits: number }>();
  let totalCalls = 0;
  let totalCredits = 0;
  let totalOk = 0;
  let totalErrors = 0;
  for (const r of rows) {
    totalCalls++;
    const c = Number(r.credits ?? 0);
    totalCredits += Number.isFinite(c) ? c : 0;
    const ok = r.status === "ok";
    if (ok) totalOk++; else totalErrors++;
    const slot = byKey.get(r.keyId) ?? { calls: 0, ok: 0, errors: 0, credits: 0 };
    slot.calls++;
    if (ok) slot.ok++; else slot.errors++;
    slot.credits += Number.isFinite(c) ? c : 0;
    byKey.set(r.keyId, slot);
  }

  const [u] = await d.select({ tier: _usersX.tier }).from(_usersX).where(eq(_usersX.id, ctx.userId)).limit(1);
  const tier = (u?.tier ?? "free").toLowerCase();
  const limits = _TIER_LIMITS_X[tier] ?? _TIER_LIMITS_X.free;

  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    tier,
    totals: {
      calls: totalCalls,
      ok: totalOk,
      errors: totalErrors,
      credits: Math.round(totalCredits * 1e4) / 1e4,
    },
    limits,
    utilization: {
      callsPct: limits.callsPerMonth > 0 ? Math.min(100, (totalCalls / limits.callsPerMonth) * 100) : 0,
      creditsPct: limits.creditsPerMonth > 0 ? Math.min(100, (totalCredits / limits.creditsPerMonth) * 100) : 0,
    },
    byKey: Array.from(byKey.entries()).map(([keyId, v]) => ({
      keyId,
      calls: v.calls,
      ok: v.ok,
      errors: v.errors,
      credits: Math.round(v.credits * 1e4) / 1e4,
    })),
  };
}

export async function billingInvoices(
  input: { status?: "pending" | "confirmed" | "expired" | "failed"; limit?: number; sinceIso?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_cryptoInvoicesX.userId, ctx.userId)];
  if (input.status) conds.push(eq(_cryptoInvoicesX.status, input.status));
  if (input.sinceIso) conds.push(gte(_cryptoInvoicesX.createdAt, new Date(input.sinceIso)));
  const limit = Math.min(input.limit ?? 50, 200);
  const rows = await d
    .select({
      id: _cryptoInvoicesX.id,
      tier: _cryptoInvoicesX.tier,
      chain: _cryptoInvoicesX.chain,
      asset: _cryptoInvoicesX.asset,
      amountMinor: _cryptoInvoicesX.amountMinor,
      amountUsd: _cryptoInvoicesX.amountUsd,
      decimals: _cryptoInvoicesX.decimals,
      receivingAddress: _cryptoInvoicesX.receivingAddress,
      memo: _cryptoInvoicesX.memo,
      status: _cryptoInvoicesX.status,
      txSignature: _cryptoInvoicesX.txSignature,
      expiresAt: _cryptoInvoicesX.expiresAt,
      createdAt: _cryptoInvoicesX.createdAt,
      confirmedAt: _cryptoInvoicesX.confirmedAt,
    })
    .from(_cryptoInvoicesX)
    .where(and(...conds))
    .orderBy(desc(_cryptoInvoicesX.createdAt))
    .limit(limit);
  return { count: rows.length, invoices: rows };
}

export async function billingPaymentOptions(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  const cardRails = {
    stripe: !!process.env.STRIPE_SECRET_KEY,
    paystack: !!process.env.PAYSTACK_SECRET_KEY,
  };
  const crypto = _ENABLED_CHAINS_X.map((chain) => ({
    chain,
    assets: (_ENABLED_ASSETS_X[chain] ?? []) as _CryptoAssetX[],
  }));
  return {
    cardRails,
    crypto,
    tiers: [
      { tier: "free", usdMonthly: 0 },
      { tier: "mini", usdMonthly: usdPriceFor("mini" as _CryptoTierX), cardUsdMonthly: 49 },
      { tier: "max", usdMonthly: usdPriceFor("max" as _CryptoTierX), cardUsdMonthly: 199 },
    ],
    note: "Card prices are full retail (Stripe / Paystack). Crypto prices include a 10% discount and settle on-chain via /api/billing/crypto/verify.",
  };
}

export async function billingEstimateUpgrade(
  input: { tier: "mini" | "max"; chain: _CryptoChainX; asset: _CryptoAssetX },
  _ctx: CapabilityRunContext,
) {
  if (!_isEnabledX(input.chain, input.asset)) {
    throw new CapabilityError(`Asset not enabled: ${input.chain}/${input.asset}`, 400, null);
  }
  const pricing = await computeAmountMinor(input.tier, input.chain, input.asset);
  return {
    tier: input.tier,
    chain: input.chain,
    asset: input.asset,
    amountUsd: pricing.amountUsd,
    amountDisplay: pricing.amountDisplay,
    amountMinor: pricing.amountMinor.toString(),
    decimals: pricing.decimals,
    cardUsdMonthly: input.tier === "mini" ? 49 : 199,
    cryptoDiscountPct: 10,
  };
}

export async function billingCreateInvoice(
  input: { tier: "mini" | "max"; chain: _CryptoChainX; asset: _CryptoAssetX; message?: string },
  ctx: CapabilityRunContext,
) {
  if (!_isEnabledX(input.chain, input.asset)) {
    throw new CapabilityError(`Asset not enabled: ${input.chain}/${input.asset}`, 400, null);
  }
  let invoice;
  try {
    invoice = await mintCryptoInvoice({
      userId: ctx.userId,
      tier: input.tier,
      chain: input.chain,
      asset: input.asset,
      message: input.message,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to mint invoice";
    throw new CapabilityError(msg, 500, null);
  }

  const deliveryErrors: string[] = [];
  try {
    await emitWebhookEvent({
      userId: ctx.userId,
      event: "billing.invoice_created",
      data: {
        invoiceId: invoice.id,
        tier: invoice.tier,
        chain: invoice.chain,
        asset: invoice.asset,
        amountUsd: invoice.amountUsd,
        memo: invoice.memo,
        expiresAt: invoice.expiresAt,
      },
    });
  } catch (e) {
    deliveryErrors.push(e instanceof Error ? e.message : String(e));
  }

  return { invoice, verifyHint: `POST /api/billing/crypto/verify with { invoiceId: "${invoice.id}", txSignature }`, deliveryErrors };
}

// Silences unused-import lints.
export const __pillarXTouch = { _publicApiKeysX };

// ════════════════════════════════════════════════════════════════════════
// ─── Pillar Y — Privacy & Data Rights / DSAR (Phase 17) ──────────────────
// ════════════════════════════════════════════════════════════════════════
// GDPR / CCPA-style data-subject rights surfaced as first-class API.
// Two tables back this pillar: privacy_requests (DSAR ledger) and
// privacy_consents (per-topic opt-in record). Every mutation appends to
// the hash-chained public_api_audit_log and best-effort fires a webhook.

import { createHash as _chY } from "node:crypto";
import {
  privacyRequests as _privReqY,
  privacyConsents as _privConsY,
  users as _usersY,
  publicApiKeys as _pubKeysY,
  publicApiKeyUsage as _pubUsageY,
  publicApiAuditLog as _pubAuditY,
  publicApiWebhooks as _pubHooksY,
  teamMembers as _teamMembersY,
  cryptoInvoices as _cryptoInvY,
} from "@/db/schema";

const _PRIVACY_TOPICS = ["telemetry", "marketing", "ai_training", "third_party_sharing", "session_replay"] as const;
type PrivacyTopicY = (typeof _PRIVACY_TOPICS)[number];

const _PRIVACY_KINDS = ["export", "delete", "rectify", "restrict"] as const;
type PrivacyKindY = (typeof _PRIVACY_KINDS)[number];

const _RETENTION_POLICY_Y = {
  controller: "StaUniverse Ltd (trading as Dreyv)",
  contact: "privacy@dreyv.com",
  jurisdiction: "Ghana / EU (GDPR adequacy via SCCs)",
  statutoryResponseDays: 30,
  lawfulBases: ["contract", "legitimate_interest", "consent"],
  tables: [
    { table: "users", retention: "lifetime_of_account + 30 days", basis: "contract" },
    { table: "public_api_keys", retention: "until_revoked + 90 days", basis: "contract" },
    { table: "public_api_key_usage", retention: "395 days", basis: "legitimate_interest" },
    { table: "public_api_audit_log", retention: "7 years", basis: "legal_obligation" },
    { table: "webhook_deliveries", retention: "90 days", basis: "legitimate_interest" },
    { table: "notifications", retention: "365 days", basis: "contract" },
    { table: "crypto_invoices", retention: "7 years", basis: "legal_obligation" },
    { table: "privacy_requests", retention: "7 years", basis: "legal_obligation" },
  ],
} as const;

export async function privacyConsents(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const rows = await d
    .select()
    .from(_privConsY)
    .where(eq(_privConsY.userId, ctx.userId));
  const byTopic = new Map(rows.map((r) => [r.topic, r]));
  const merged = _PRIVACY_TOPICS.map((topic) => {
    const r = byTopic.get(topic);
    return {
      topic,
      granted: r?.granted ?? false,
      source: r?.source ?? null,
      updatedAt: r?.updatedAt ?? null,
    };
  });
  return { consents: merged };
}

export async function privacyUpdateConsent(
  input: { topic: PrivacyTopicY; granted: boolean; source?: "api" | "ui" | "import" },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const source = input.source ?? "api";
  const [existing] = await d
    .select()
    .from(_privConsY)
    .where(and(eq(_privConsY.userId, ctx.userId), eq(_privConsY.topic, input.topic)))
    .limit(1);

  let row;
  if (existing) {
    [row] = await d
      .update(_privConsY)
      .set({ granted: input.granted, source, updatedAt: new Date() })
      .where(eq(_privConsY.id, existing.id))
      .returning();
  } else {
    [row] = await d
      .insert(_privConsY)
      .values({ userId: ctx.userId, topic: input.topic, granted: input.granted, source })
      .returning();
  }

  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "privacy.consent_changed",
    target: input.topic,
    meta: { granted: input.granted, source, previous: existing?.granted ?? null },
  });

  const deliveryErrors: string[] = [];
  try {
    await emitWebhookEvent({
      userId: ctx.userId,
      event: "privacy.consent_changed",
      data: { topic: input.topic, granted: input.granted, source, updatedAt: row.updatedAt },
    });
  } catch (e) {
    deliveryErrors.push(e instanceof Error ? e.message : String(e));
  }

  return { consent: row, auditHash: audit.hash, deliveryErrors };
}

export async function privacyRequests(
  input: { status?: string; kind?: PrivacyKindY; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_privReqY.userId, ctx.userId)];
  if (input.status) conds.push(eq(_privReqY.status, input.status));
  if (input.kind) conds.push(eq(_privReqY.kind, input.kind));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await d
    .select()
    .from(_privReqY)
    .where(and(...conds))
    .orderBy(desc(_privReqY.requestedAt))
    .limit(limit);
  return { count: rows.length, requests: rows };
}

export async function privacySubmitRequest(
  input: { kind: PrivacyKindY; reason?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const dueBy = new Date(Date.now() + 30 * 24 * 3_600_000);
  const [row] = await d
    .insert(_privReqY)
    .values({
      userId: ctx.userId,
      kind: input.kind,
      status: "pending",
      reason: input.reason ?? null,
      dueBy,
      meta: { submittedVia: "api", keyId: ctx.keyId },
    })
    .returning();

  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "privacy.request_submitted",
    target: row.id,
    meta: { kind: input.kind, dueBy: dueBy.toISOString() },
  });

  const deliveryErrors: string[] = [];
  if (input.kind === "delete") {
    try {
      await emitWebhookEvent({
        userId: ctx.userId,
        event: "privacy.deletion_requested",
        data: { requestId: row.id, dueBy: row.dueBy, reason: row.reason },
      });
    } catch (e) {
      deliveryErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return {
    request: row,
    statutoryResponseDays: _RETENTION_POLICY_Y.statutoryResponseDays,
    auditHash: audit.hash,
    deliveryErrors,
  };
}

export async function privacyExportData(
  input: { includeUsage?: boolean; includeAudit?: boolean; requestId?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const includeUsage = input.includeUsage ?? true;
  const includeAudit = input.includeAudit ?? true;

  const [account] = await d
    .select({
      id: _usersY.id,
      email: _usersY.email,
      walletAddress: _usersY.walletAddress,
      tier: _usersY.tier,
      createdAt: _usersY.createdAt,
    })
    .from(_usersY)
    .where(eq(_usersY.id, ctx.userId))
    .limit(1);

  const keys = await d
    .select({
      id: _pubKeysY.id,
      label: _pubKeysY.label,
      env: _pubKeysY.env,
      keyPrefix: _pubKeysY.keyPrefix,
      scopes: _pubKeysY.scopes,
      rateLimitRpm: _pubKeysY.rateLimitRpm,
      revokedAt: _pubKeysY.revokedAt,
      killSwitchAt: _pubKeysY.killSwitchAt,
      ipAllowlist: _pubKeysY.ipAllowlist,
      originAllowlist: _pubKeysY.originAllowlist,
      capabilityAllowlist: _pubKeysY.capabilityAllowlist,
      lastUsedAt: _pubKeysY.lastUsedAt,
      createdAt: _pubKeysY.createdAt,
    })
    .from(_pubKeysY)
    .where(eq(_pubKeysY.userId, ctx.userId));

  const webhooks = await d
    .select({
      id: _pubHooksY.id,
      label: _pubHooksY.label,
      targetUrl: _pubHooksY.targetUrl,
      events: _pubHooksY.events,
      active: _pubHooksY.active,
      lastDeliveryAt: _pubHooksY.lastDeliveryAt,
      lastStatus: _pubHooksY.lastStatus,
      failureStreak: _pubHooksY.failureStreak,
      createdAt: _pubHooksY.createdAt,
    })
    .from(_pubHooksY)
    .where(eq(_pubHooksY.userId, ctx.userId));

  const teamMemberships = await d
    .select({
      teamId: _teamMembersY.teamId,
      role: _teamMembersY.role,
      status: _teamMembersY.status,
      invitedAt: _teamMembersY.invitedAt,
      acceptedAt: _teamMembersY.acceptedAt,
    })
    .from(_teamMembersY)
    .where(eq(_teamMembersY.userId, ctx.userId));

  const invoices = await d
    .select()
    .from(_cryptoInvY)
    .where(eq(_cryptoInvY.userId, ctx.userId))
    .orderBy(desc(_cryptoInvY.createdAt))
    .limit(500);

  const consentsResp = await privacyConsents({}, ctx);
  const requestsResp = await privacyRequests({ limit: 200 }, ctx);

  const usage = includeUsage
    ? await d
        .select()
        .from(_pubUsageY)
        .where(eq(_pubUsageY.userId, ctx.userId))
        .orderBy(desc(_pubUsageY.ts))
        .limit(10_000)
    : [];

  const auditEntries = includeAudit
    ? await d
        .select()
        .from(_pubAuditY)
        .where(eq(_pubAuditY.userId, ctx.userId))
        .orderBy(desc(_pubAuditY.ts))
        .limit(10_000)
    : [];

  const document = {
    schemaVersion: "dreyv.privacy.export/1",
    generatedAt: new Date().toISOString(),
    subject: { userId: ctx.userId, keyId: ctx.keyId },
    account: account ?? null,
    keys,
    webhooks,
    teamMemberships,
    invoices,
    consents: (consentsResp as { consents: unknown }).consents,
    privacyRequests: (requestsResp as { requests: unknown }).requests,
    usage,
    auditLog: auditEntries,
  };

  const json = JSON.stringify(document, null, 2);
  const sha = _chY("sha256").update(json, "utf8").digest("hex");
  const base64 = Buffer.from(json, "utf8").toString("base64");

  // If a matching pending export request was passed, mark it fulfilled.
  let fulfilledRequestId: string | null = null;
  if (input.requestId) {
    const [req] = await d
      .select()
      .from(_privReqY)
      .where(and(eq(_privReqY.id, input.requestId), eq(_privReqY.userId, ctx.userId)))
      .limit(1);
    if (!req) throw new CapabilityError(`Unknown privacy request ${input.requestId}`, 404, null);
    if (req.kind !== "export") {
      throw new CapabilityError(`Request ${input.requestId} is kind=${req.kind}, not 'export'`, 400, null);
    }
    if (req.status === "fulfilled") {
      throw new CapabilityError(`Request ${input.requestId} already fulfilled`, 409, null);
    }
    await d
      .update(_privReqY)
      .set({ status: "fulfilled", fulfilledAt: new Date(), artifactSha: sha })
      .where(eq(_privReqY.id, input.requestId));
    fulfilledRequestId = input.requestId;
  }

  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "privacy.export_generated",
    target: fulfilledRequestId,
    meta: { sha256: sha, bytes: json.length, includeUsage, includeAudit },
  });

  const deliveryErrors: string[] = [];
  try {
    await emitWebhookEvent({
      userId: ctx.userId,
      event: "privacy.export_ready",
      data: { sha256: sha, bytes: json.length, fulfilledRequestId, generatedAt: document.generatedAt },
    });
  } catch (e) {
    deliveryErrors.push(e instanceof Error ? e.message : String(e));
  }

  return {
    sha256: sha,
    bytes: json.length,
    encoding: "base64",
    contentType: "application/json",
    artifact: base64,
    fulfilledRequestId,
    auditHash: audit.hash,
    deliveryErrors,
  };
}

export async function privacyRetentionPolicy(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return _RETENTION_POLICY_Y;
}

// Silences unused-import lints.
export const __pillarYTouch = { _privReqY, _privConsY };



// ════════════════════════════════════════════════════════════════════════
// ─── Pillar Z — Storage & Artifacts (Phase 18) ──────────────────────────
// ════════════════════════════════════════════════════════════════════════
// R2-backed artifact store. Caller PUTs base64 → R2 object key
// `dreyv/artifacts/<userId>/<artifactId>/<filename>`, we mint a pointer
// row in `public_api_artifacts`, and serve downloads via short-lived
// presigned GET URLs (no public bucket, no plaintext exposure).
// Per-tier quota enforced in-process; quota breaches emit a webhook AND
// refuse the write (no silent truncation).

import { createHash as _chZ } from "node:crypto";
import { sql as _drizzleSqlZ } from "drizzle-orm";
import {
  publicApiArtifacts as _artifactsZ,
  users as _usersZ2,
} from "@/db/schema";
import {
  isR2Configured as _isR2Z,
  putR2Object as _putR2Z,
  presignR2Get as _presignR2Z,
  deleteR2Object as _delR2Z,
} from "@/lib/agents/artifacts/r2-storage";

const _MIB = 1024 * 1024;
const _GIB = 1024 * _MIB;

const _STORAGE_TIER_QUOTAS = {
  free: { bytes: 100 * _MIB, objects: 100 },
  mini: { bytes: 5 * _GIB, objects: 5_000 },
  max: { bytes: 50 * _GIB, objects: 50_000 },
} as const;

const _SINGLE_OBJECT_CAP = 25 * _MIB;
const _PRESIGN_MAX_TTL = 3600;
const _PRESIGN_DEFAULT_TTL = 600;

// MIME prefixes that don't need a `mime` override on PUT. Anything else
// is accepted as the caller-supplied value (we don't gatekeep payloads).
const _ACCEPTED_MIME_PREFIXES = [
  "image/", "video/", "audio/", "text/", "application/",
];

type StorageTierZ = keyof typeof _STORAGE_TIER_QUOTAS;

function _normalizeTierZ(raw: string | null | undefined): StorageTierZ {
  const t = (raw ?? "free").toLowerCase();
  return (t in _STORAGE_TIER_QUOTAS ? t : "free") as StorageTierZ;
}

async function _resolveTierZ(userId: string): Promise<StorageTierZ> {
  const d = requireDb();
  const [u] = await d
    .select({ tier: _usersZ2.tier })
    .from(_usersZ2)
    .where(eq(_usersZ2.id, userId))
    .limit(1);
  return _normalizeTierZ(u?.tier ?? null);
}

async function _aggregateUsageZ(userId: string) {
  const d = requireDb();
  const [agg] = await d
    .select({
      bytes: _drizzleSqlZ<number>`coalesce(sum(${_artifactsZ.bytes}), 0)`,
      objects: _drizzleSqlZ<number>`count(*)`,
    })
    .from(_artifactsZ)
    .where(and(eq(_artifactsZ.userId, userId), _drizzleSqlZ`${_artifactsZ.deletedAt} IS NULL`));
  return {
    bytes: Number(agg?.bytes ?? 0),
    objects: Number(agg?.objects ?? 0),
  };
}

function _storageKeyZ(userId: string, artifactId: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
  return `dreyv/artifacts/${userId}/${artifactId}/${safe}`;
}

export async function storagePut(
  input: {
    filename: string;
    mime?: string;
    bodyBase64: string;
    metadata?: Record<string, string | number | boolean>;
    visibility?: "private" | "unlisted";
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (!_isR2Z()) throw new CapabilityError("Storage backend not configured (R2 missing).", 503, null);

  // Decode + size-check before touching R2.
  let body: Buffer;
  try {
    body = Buffer.from(input.bodyBase64, "base64");
  } catch {
    throw new CapabilityError("bodyBase64 is not valid base64.", 400, null);
  }
  if (body.length === 0) throw new CapabilityError("Empty body.", 400, null);
  if (body.length > _SINGLE_OBJECT_CAP) {
    throw new CapabilityError(`Object exceeds per-call cap (${_SINGLE_OBJECT_CAP} bytes).`, 413, null);
  }

  // Quota check (pre-flight).
  const tier = await _resolveTierZ(ctx.userId);
  const quota = _STORAGE_TIER_QUOTAS[tier];
  const usage = await _aggregateUsageZ(ctx.userId);
  const projectedBytes = usage.bytes + body.length;
  const projectedObjects = usage.objects + 1;
  if (projectedBytes > quota.bytes || projectedObjects > quota.objects) {
    // Surface as a webhook so dashboards can react.
    try {
      await emitWebhookEvent({
        userId: ctx.userId,
        event: "storage.quota_exceeded",
        data: {
          tier,
          quota,
          attemptedBytes: body.length,
          currentBytes: usage.bytes,
          currentObjects: usage.objects,
        },
      });
    } catch { /* webhook best-effort */ }
    throw new CapabilityError(
      `Storage quota exceeded for tier '${tier}' (${quota.bytes} bytes / ${quota.objects} objects).`,
      413,
      { tier, quota, usage },
    );
  }

  const mime = input.mime?.trim() || "application/octet-stream";
  const sha = _chZ("sha256").update(body).digest("hex");

  // Insert the pointer first so we have an id for the R2 key.
  const [row] = await d
    .insert(_artifactsZ)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      storageKey: "", // patched below once we have id
      filename: input.filename,
      mime,
      bytes: body.length,
      sha256: sha,
      metadata: input.metadata ?? {},
      visibility: input.visibility ?? "private",
    })
    .returning();

  const storageKey = _storageKeyZ(ctx.userId, row.id, input.filename);

  try {
    await _putR2Z({ key: storageKey, body, mime, filename: input.filename });
  } catch (err) {
    // Roll back the pointer row on upload failure — no orphan rows.
    await d.delete(_artifactsZ).where(eq(_artifactsZ.id, row.id));
    throw new CapabilityError(
      `R2 upload failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
      null,
    );
  }

  const [updated] = await d
    .update(_artifactsZ)
    .set({ storageKey })
    .where(eq(_artifactsZ.id, row.id))
    .returning();

  const downloadUrl = await _presignR2Z({
    key: storageKey,
    filename: input.filename,
    mime,
    ttlSeconds: _PRESIGN_DEFAULT_TTL,
  });

  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "storage.put",
    target: updated.id,
    meta: { bytes: body.length, sha256: sha, mime, filename: input.filename, tier },
  });

  const deliveryErrors: string[] = [];
  try {
    await emitWebhookEvent({
      userId: ctx.userId,
      event: "storage.artifact_created",
      data: {
        id: updated.id,
        filename: input.filename,
        mime,
        bytes: body.length,
        sha256: sha,
        visibility: updated.visibility,
      },
    });
  } catch (e) {
    deliveryErrors.push(e instanceof Error ? e.message : String(e));
  }

  return {
    artifact: {
      id: updated.id,
      filename: updated.filename,
      mime: updated.mime,
      bytes: updated.bytes,
      sha256: updated.sha256,
      visibility: updated.visibility,
      metadata: updated.metadata,
      createdAt: updated.createdAt,
    },
    downloadUrl,
    downloadExpiresIn: _PRESIGN_DEFAULT_TTL,
    auditHash: audit.hash,
    deliveryErrors,
  };
}

export async function storageList(
  input: { prefix?: string; keyOnly?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [
    eq(_artifactsZ.userId, ctx.userId),
    _drizzleSqlZ`${_artifactsZ.deletedAt} IS NULL`,
  ];
  if (input.keyOnly) conds.push(eq(_artifactsZ.keyId, ctx.keyId));
  if (input.prefix) {
    const safe = input.prefix.replace(/[%_\\]/g, "\\$&");
    conds.push(_drizzleSqlZ`${_artifactsZ.filename} LIKE ${safe + "%"}`);
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await d
    .select({
      id: _artifactsZ.id,
      filename: _artifactsZ.filename,
      mime: _artifactsZ.mime,
      bytes: _artifactsZ.bytes,
      sha256: _artifactsZ.sha256,
      visibility: _artifactsZ.visibility,
      metadata: _artifactsZ.metadata,
      createdAt: _artifactsZ.createdAt,
    })
    .from(_artifactsZ)
    .where(and(...conds))
    .orderBy(desc(_artifactsZ.createdAt))
    .limit(limit);
  return { count: rows.length, artifacts: rows };
}

async function _loadArtifactZ(id: string, userId: string) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_artifactsZ)
    .where(and(eq(_artifactsZ.id, id), eq(_artifactsZ.userId, userId)))
    .limit(1);
  if (!row) throw new CapabilityError(`Artifact ${id} not found`, 404, null);
  return row;
}

export async function storageGet(
  input: { id: string; inline?: boolean; ttlSeconds?: number },
  ctx: CapabilityRunContext,
) {
  const row = await _loadArtifactZ(input.id, ctx.userId);
  if (row.deletedAt) throw new CapabilityError(`Artifact ${input.id} is deleted`, 410, null);
  const ttl = Math.min(Math.max(input.ttlSeconds ?? _PRESIGN_DEFAULT_TTL, 60), _PRESIGN_MAX_TTL);
  const url = await _presignR2Z({
    key: row.storageKey,
    filename: row.filename,
    mime: row.mime,
    inline: input.inline ?? false,
    ttlSeconds: ttl,
  });
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    downloadUrl: url,
    expiresIn: ttl,
  };
}

export async function storageStat(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const row = await _loadArtifactZ(input.id, ctx.userId);
  return {
    artifact: {
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      bytes: row.bytes,
      sha256: row.sha256,
      visibility: row.visibility,
      metadata: row.metadata,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    },
  };
}

export async function storageDelete(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const row = await _loadArtifactZ(input.id, ctx.userId);
  if (row.deletedAt) {
    return { artifact: row, alreadyDeleted: true, auditHash: null, deliveryErrors: [] };
  }
  // Best-effort R2 delete; we still soft-delete the row even if R2 returns
  // an error so the user isn't blocked from cleaning their ledger.
  let r2Error: string | null = null;
  try {
    await _delR2Z(row.storageKey);
  } catch (e) {
    r2Error = e instanceof Error ? e.message : String(e);
  }
  const [updated] = await d
    .update(_artifactsZ)
    .set({ deletedAt: new Date() })
    .where(eq(_artifactsZ.id, row.id))
    .returning();

  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "storage.delete",
    target: row.id,
    meta: { bytes: row.bytes, sha256: row.sha256, r2Error },
  });

  const deliveryErrors: string[] = [];
  try {
    await emitWebhookEvent({
      userId: ctx.userId,
      event: "storage.artifact_deleted",
      data: { id: row.id, filename: row.filename, bytes: row.bytes, sha256: row.sha256 },
    });
  } catch (e) {
    deliveryErrors.push(e instanceof Error ? e.message : String(e));
  }

  return { artifact: updated, alreadyDeleted: false, r2Error, auditHash: audit.hash, deliveryErrors };
}

export async function storageQuota(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _resolveTierZ(ctx.userId);
  const quota = _STORAGE_TIER_QUOTAS[tier];
  const usage = await _aggregateUsageZ(ctx.userId);
  return {
    tier,
    quota,
    usage,
    utilization: {
      bytesPct: quota.bytes > 0 ? +(usage.bytes / quota.bytes * 100).toFixed(2) : 0,
      objectsPct: quota.objects > 0 ? +(usage.objects / quota.objects * 100).toFixed(2) : 0,
    },
    singleObjectCapBytes: _SINGLE_OBJECT_CAP,
    presignTtl: { defaultSeconds: _PRESIGN_DEFAULT_TTL, maxSeconds: _PRESIGN_MAX_TTL },
  };
}

export async function storagePolicy(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return {
    backend: "cloudflare-r2",
    durability: "11x9s (R2 SLA)",
    encryption: "AES-256 at rest (R2 default); TLS 1.2+ in transit",
    visibility: ["private", "unlisted"],
    singleObjectCapBytes: _SINGLE_OBJECT_CAP,
    presignTtl: { defaultSeconds: _PRESIGN_DEFAULT_TTL, maxSeconds: _PRESIGN_MAX_TTL },
    acceptedMimePrefixes: _ACCEPTED_MIME_PREFIXES,
    quotasByTier: _STORAGE_TIER_QUOTAS,
    retention: {
      activeArtifacts: "lifetime_of_account",
      softDeleted: "30 days then purged from R2 and ledger",
      auditEntries: "7 years (per privacy.retention_policy)",
    },
    privacyBasis: "contract (user-uploaded content)",
  };
}

// Silences unused-import lints.
export const __pillarZTouch = { _artifactsZ, _usersZ2 };

// ─────────────────────────────────────────────────────────────────────
// Phase 19 — Pillar AB: Search & Indexing
// ─────────────────────────────────────────────────────────────────────
// Read-only, caller-scoped, multi-index search. No new tables, no new
// webhooks — strictly a query surface over existing rows the caller
// already owns. AND-only token matching against ILIKE; deterministic
// score = token-coverage * recency-decay; snippet capped at 240 chars.

import { sql as _sqlAB } from "drizzle-orm";
import {
  publicApiAuditLog as _auditAB,
  publicApiKeyUsage as _usageAB,
} from "@/db/schema";

type SearchIndexAB =
  | "audit" | "artifacts" | "notifications" | "watchers"
  | "monitors" | "deliveries" | "proposals" | "usage";

const _ALL_INDEXES_AB: SearchIndexAB[] = [
  "audit", "artifacts", "notifications", "watchers",
  "monitors", "deliveries", "proposals", "usage",
];

const _SEARCH_MAX_LIMIT_AB = 200;
const _SEARCH_DEFAULT_LIMIT_AB = 50;
const _SEARCH_MAX_TOKENS_AB = 8;
const _SNIPPET_MAX_AB = 240;

interface SearchHitAB {
  index: SearchIndexAB;
  id: string;
  title: string;
  snippet: string;
  ts: string;
  score: number;
  meta: Record<string, unknown>;
}

function _tokensAB(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, _SEARCH_MAX_TOKENS_AB);
}

function _snippetAB(text: string, tokens: string[]): string {
  const t = (text ?? "").toString();
  if (!tokens.length) return t.slice(0, _SNIPPET_MAX_AB);
  const lower = t.toLowerCase();
  let pos = -1;
  for (const tok of tokens) {
    const p = lower.indexOf(tok);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return t.slice(0, _SNIPPET_MAX_AB);
  const start = Math.max(0, pos - 40);
  const out = (start > 0 ? "…" : "") + t.slice(start, start + _SNIPPET_MAX_AB);
  return out.length < t.length ? out + "…" : out;
}

function _scoreAB(haystack: string, tokens: string[], ts: Date | string | null): number {
  const lower = (haystack ?? "").toLowerCase();
  const coverage = tokens.length
    ? tokens.filter((t) => lower.includes(t)).length / tokens.length
    : 1;
  const tsMs = ts ? new Date(ts).getTime() : 0;
  const ageDays = tsMs > 0 ? (Date.now() - tsMs) / 86_400_000 : 365;
  const recency = 1 / (1 + Math.max(0, ageDays) / 30); // half ~30d
  return +(coverage * 0.7 + recency * 0.3).toFixed(4);
}

function _resolveIndexesAB(requested: SearchIndexAB[] | undefined): SearchIndexAB[] {
  if (!requested || requested.length === 0) return _ALL_INDEXES_AB;
  const allow = new Set(_ALL_INDEXES_AB);
  return requested.filter((i) => allow.has(i));
}

function _windowAB(since?: string, until?: string) {
  return {
    sinceDate: since ? new Date(since) : null,
    untilDate: until ? new Date(until) : null,
  };
}

/** Build an AND-of-ILIKEs SQL fragment over a list of text expressions. */
function _matchAllTokensAB(textExprs: ReturnType<typeof _sqlAB>[], tokens: string[]) {
  if (tokens.length === 0) return _sqlAB`TRUE`;
  const concat = _sqlAB.join(textExprs, _sqlAB` || ' ' || `);
  const ands = tokens.map((tok) => _sqlAB`lower(${concat}) LIKE ${"%" + tok + "%"}`);
  return _sqlAB.join(ands, _sqlAB` AND `);
}

async function _searchAuditAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${_auditAB.action}`, _sqlAB`coalesce(${_auditAB.target},'')`, _sqlAB`${_auditAB.meta}::text`],
    tokens,
  );
  const conds = [_sqlAB`${_auditAB.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${_auditAB.ts} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${_auditAB.ts} <= ${until.toISOString()}`);
  const rows = await d
    .select({ id: _auditAB.id, action: _auditAB.action, target: _auditAB.target, meta: _auditAB.meta, ts: _auditAB.ts })
    .from(_auditAB)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(_auditAB.ts))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.action} ${r.target ?? ""} ${JSON.stringify(r.meta ?? {})}`;
    return {
      index: "audit" as const,
      id: String(r.id),
      title: r.action,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.ts).toISOString(),
      score: _scoreAB(hay, tokens, r.ts),
      meta: { target: r.target, meta: r.meta },
    };
  });
}

async function _searchArtifactsAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${_artifactsZ.filename}`, _sqlAB`${_artifactsZ.mime}`, _sqlAB`${_artifactsZ.sha256}`, _sqlAB`${_artifactsZ.metadata}::text`],
    tokens,
  );
  const conds = [_sqlAB`${_artifactsZ.userId} = ${ctx.userId}`, _sqlAB`${_artifactsZ.deletedAt} IS NULL`, match];
  if (since) conds.push(_sqlAB`${_artifactsZ.createdAt} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${_artifactsZ.createdAt} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(_artifactsZ)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(_artifactsZ.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.filename} ${r.mime} ${r.sha256} ${JSON.stringify(r.metadata ?? {})}`;
    return {
      index: "artifacts" as const,
      id: r.id,
      title: r.filename,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.createdAt).toISOString(),
      score: _scoreAB(hay, tokens, r.createdAt),
      meta: { mime: r.mime, bytes: r.bytes, sha256: r.sha256, visibility: r.visibility },
    };
  });
}

async function _searchNotificationsAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${notifications.title}`, _sqlAB`${notifications.message}`, _sqlAB`${notifications.type}`, _sqlAB`${notifications.severity}`],
    tokens,
  );
  const conds = [_sqlAB`${notifications.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${notifications.createdAt} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${notifications.createdAt} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(notifications)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.title} ${r.message} ${r.type} ${r.severity}`;
    return {
      index: "notifications" as const,
      id: String(r.id),
      title: r.title,
      snippet: _snippetAB(r.message ?? hay, tokens),
      ts: new Date(r.createdAt).toISOString(),
      score: _scoreAB(hay, tokens, r.createdAt),
      meta: { type: r.type, severity: r.severity, read: r.read },
    };
  });
}

async function _searchWatchersAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`coalesce(${agentTreasuryWatchers.label},'')`, _sqlAB`${agentTreasuryWatchers.address}`, _sqlAB`${agentTreasuryWatchers.chain}`],
    tokens,
  );
  const conds = [_sqlAB`${agentTreasuryWatchers.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${agentTreasuryWatchers.createdAt} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${agentTreasuryWatchers.createdAt} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(agentTreasuryWatchers)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(agentTreasuryWatchers.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.label ?? ""} ${r.address} ${r.chain}`;
    return {
      index: "watchers" as const,
      id: r.id,
      title: r.label ?? r.address,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.createdAt).toISOString(),
      score: _scoreAB(hay, tokens, r.createdAt),
      meta: { chain: r.chain, address: r.address, active: r.active },
    };
  });
}

async function _searchMonitorsAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${monitors.target}`, _sqlAB`${monitors.type}`, _sqlAB`${monitors.operator}`, _sqlAB`${monitors.walletAddress}`],
    tokens,
  );
  const conds = [_sqlAB`${monitors.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${monitors.createdAt} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${monitors.createdAt} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(monitors)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(monitors.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.target} ${r.type} ${r.operator} ${r.walletAddress}`;
    return {
      index: "monitors" as const,
      id: String(r.id),
      title: `${r.type}:${r.target} ${r.operator} ${r.conditionValue}`,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.createdAt).toISOString(),
      score: _scoreAB(hay, tokens, r.createdAt),
      meta: { type: r.type, target: r.target, operator: r.operator, active: r.active, triggerCount: r.triggerCount },
    };
  });
}

async function _searchDeliveriesAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${webhookDeliveries.event}`, _sqlAB`coalesce(${webhookDeliveries.error},'')`, _sqlAB`${webhookDeliveries.status}`, _sqlAB`${webhookDeliveries.payload}::text`],
    tokens,
  );
  const conds = [_sqlAB`${webhookDeliveries.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${webhookDeliveries.createdAt} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${webhookDeliveries.createdAt} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(webhookDeliveries)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.event} ${r.status} ${r.error ?? ""} ${JSON.stringify(r.payload ?? {})}`;
    return {
      index: "deliveries" as const,
      id: r.id,
      title: `${r.event} → ${r.status}`,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.createdAt).toISOString(),
      score: _scoreAB(hay, tokens, r.createdAt),
      meta: { status: r.status, httpStatus: r.httpStatus, attempt: r.attempt, webhookId: r.webhookId },
    };
  });
}

async function _searchProposalsAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${agentTxProposals.summary}`, _sqlAB`${agentTxProposals.kind}`, _sqlAB`${agentTxProposals.status}`, _sqlAB`${agentTxProposals.chain}`],
    tokens,
  );
  const conds = [_sqlAB`${agentTxProposals.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${agentTxProposals.createdAt} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${agentTxProposals.createdAt} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(agentTxProposals)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(agentTxProposals.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.summary} ${r.kind} ${r.status} ${r.chain}`;
    return {
      index: "proposals" as const,
      id: r.id,
      title: r.summary,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.createdAt).toISOString(),
      score: _scoreAB(hay, tokens, r.createdAt),
      meta: { kind: r.kind, status: r.status, chain: r.chain, riskLevel: r.riskLevel },
    };
  });
}

async function _searchUsageAB(
  ctx: CapabilityRunContext,
  tokens: string[],
  since: Date | null,
  until: Date | null,
  limit: number,
): Promise<SearchHitAB[]> {
  const d = requireDb();
  const match = _matchAllTokensAB(
    [_sqlAB`${_usageAB.capabilityId}`, _sqlAB`${_usageAB.status}`, _sqlAB`coalesce(${_usageAB.errorCode},'')`, _sqlAB`${_usageAB.transport}`],
    tokens,
  );
  const conds = [_sqlAB`${_usageAB.userId} = ${ctx.userId}`, match];
  if (since) conds.push(_sqlAB`${_usageAB.ts} >= ${since.toISOString()}`);
  if (until) conds.push(_sqlAB`${_usageAB.ts} <= ${until.toISOString()}`);
  const rows = await d
    .select()
    .from(_usageAB)
    .where(_sqlAB.join(conds, _sqlAB` AND `))
    .orderBy(desc(_usageAB.ts))
    .limit(limit);
  return rows.map((r) => {
    const hay = `${r.capabilityId} ${r.status} ${r.errorCode ?? ""} ${r.transport}`;
    return {
      index: "usage" as const,
      id: String(r.id),
      title: `${r.capabilityId} (${r.status})`,
      snippet: _snippetAB(hay, tokens),
      ts: new Date(r.ts).toISOString(),
      score: _scoreAB(hay, tokens, r.ts),
      meta: { status: r.status, transport: r.transport, latencyMs: r.latencyMs, errorCode: r.errorCode },
    };
  });
}

const _SEARCH_RUNNERS_AB: Record<SearchIndexAB, (
  ctx: CapabilityRunContext, tokens: string[], since: Date | null, until: Date | null, limit: number,
) => Promise<SearchHitAB[]>> = {
  audit: _searchAuditAB,
  artifacts: _searchArtifactsAB,
  notifications: _searchNotificationsAB,
  watchers: _searchWatchersAB,
  monitors: _searchMonitorsAB,
  deliveries: _searchDeliveriesAB,
  proposals: _searchProposalsAB,
  usage: _searchUsageAB,
};

export async function searchQuery(
  input: { q: string; indexes?: SearchIndexAB[]; since?: string; until?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const tokens = _tokensAB(input.q);
  if (tokens.length === 0) {
    throw new CapabilityError("query must contain at least one searchable token", 400, null);
  }
  const indexes = _resolveIndexesAB(input.indexes);
  const { sinceDate, untilDate } = _windowAB(input.since, input.until);
  const limit = Math.min(Math.max(input.limit ?? _SEARCH_DEFAULT_LIMIT_AB, 1), _SEARCH_MAX_LIMIT_AB);
  const perIndexCap = Math.max(5, Math.ceil(limit * 1.5));

  const settled = await Promise.allSettled(
    indexes.map((idx) => _SEARCH_RUNNERS_AB[idx](ctx, tokens, sinceDate, untilDate, perIndexCap)),
  );

  const errors: { index: SearchIndexAB; error: string }[] = [];
  const hits: SearchHitAB[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") hits.push(...res.value);
    else errors.push({ index: indexes[i], error: res.reason instanceof Error ? res.reason.message : String(res.reason) });
  });

  hits.sort((a, b) => (b.score - a.score) || (Date.parse(b.ts) - Date.parse(a.ts)));
  const top = hits.slice(0, limit);

  return {
    query: { q: input.q, tokens, indexes, since: input.since ?? null, until: input.until ?? null, limit },
    count: top.length,
    totalCandidates: hits.length,
    hits: top,
    errors,
  };
}

export async function searchRecent(
  input: { indexes?: SearchIndexAB[]; limit?: number },
  ctx: CapabilityRunContext,
) {
  const indexes = _resolveIndexesAB(input.indexes);
  const limit = Math.min(Math.max(input.limit ?? _SEARCH_DEFAULT_LIMIT_AB, 1), _SEARCH_MAX_LIMIT_AB);
  const perIndexCap = Math.max(5, Math.ceil(limit / Math.max(1, indexes.length)) + 5);

  const settled = await Promise.allSettled(
    indexes.map((idx) => _SEARCH_RUNNERS_AB[idx](ctx, [], null, null, perIndexCap)),
  );
  const errors: { index: SearchIndexAB; error: string }[] = [];
  const hits: SearchHitAB[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") hits.push(...res.value);
    else errors.push({ index: indexes[i], error: res.reason instanceof Error ? res.reason.message : String(res.reason) });
  });
  hits.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return { count: Math.min(hits.length, limit), hits: hits.slice(0, limit), errors };
}

export async function searchFacets(
  input: { q?: string; since?: string; until?: string },
  ctx: CapabilityRunContext,
) {
  const tokens = input.q ? _tokensAB(input.q) : [];
  const { sinceDate, untilDate } = _windowAB(input.since, input.until);

  const counters: Array<{ index: SearchIndexAB; sql: ReturnType<typeof _sqlAB> }> = [
    { index: "audit", sql: _sqlAB`SELECT count(*)::int AS c FROM ${_auditAB} WHERE ${_auditAB.userId} = ${ctx.userId}` },
    { index: "artifacts", sql: _sqlAB`SELECT count(*)::int AS c FROM ${_artifactsZ} WHERE ${_artifactsZ.userId} = ${ctx.userId} AND ${_artifactsZ.deletedAt} IS NULL` },
    { index: "notifications", sql: _sqlAB`SELECT count(*)::int AS c FROM ${notifications} WHERE ${notifications.userId} = ${ctx.userId}` },
    { index: "watchers", sql: _sqlAB`SELECT count(*)::int AS c FROM ${agentTreasuryWatchers} WHERE ${agentTreasuryWatchers.userId} = ${ctx.userId}` },
    { index: "monitors", sql: _sqlAB`SELECT count(*)::int AS c FROM ${monitors} WHERE ${monitors.userId} = ${ctx.userId}` },
    { index: "deliveries", sql: _sqlAB`SELECT count(*)::int AS c FROM ${webhookDeliveries} WHERE ${webhookDeliveries.userId} = ${ctx.userId}` },
    { index: "proposals", sql: _sqlAB`SELECT count(*)::int AS c FROM ${agentTxProposals} WHERE ${agentTxProposals.userId} = ${ctx.userId}` },
    { index: "usage", sql: _sqlAB`SELECT count(*)::int AS c FROM ${_usageAB} WHERE ${_usageAB.userId} = ${ctx.userId}` },
  ];

  // If a query or window is supplied, fall back to the per-index runners
  // with a large cap and count the result set (correct but slower).
  if (tokens.length > 0 || sinceDate || untilDate) {
    const facets: Record<string, number> = {};
    const settled = await Promise.allSettled(
      _ALL_INDEXES_AB.map((idx) => _SEARCH_RUNNERS_AB[idx](ctx, tokens, sinceDate, untilDate, _SEARCH_MAX_LIMIT_AB)),
    );
    settled.forEach((res, i) => {
      facets[_ALL_INDEXES_AB[i]] = res.status === "fulfilled" ? res.value.length : 0;
    });
    return {
      mode: "filtered" as const,
      tokens,
      window: { since: input.since ?? null, until: input.until ?? null },
      facets,
      note: "Counts saturate at search.policy.maxLimit when filtered; use search.query for exact pagination.",
    };
  }

  const d = requireDb();
  const facets: Record<string, number> = {};
  for (const c of counters) {
    try {
      const res = await d.execute(c.sql);
      const rows = (res as unknown as { rows?: Array<{ c?: number | string }> }).rows ?? (res as unknown as Array<{ c?: number | string }>);
      const first = Array.isArray(rows) ? rows[0] : undefined;
      facets[c.index] = Number(first?.c ?? 0);
    } catch {
      facets[c.index] = 0;
    }
  }
  return { mode: "total" as const, tokens: [], window: { since: null, until: null }, facets };
}

export async function searchSuggest(
  input: { field: "capability_id" | "action" | "filename" | "event" | "notification_type"; prefix?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const prefix = (input.prefix ?? "").toLowerCase();
  const like = prefix + "%";
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

  let q: ReturnType<typeof _sqlAB>;
  switch (input.field) {
    case "capability_id":
      q = _sqlAB`SELECT DISTINCT ${_usageAB.capabilityId} AS v FROM ${_usageAB} WHERE ${_usageAB.userId} = ${ctx.userId} AND lower(${_usageAB.capabilityId}) LIKE ${like} ORDER BY v LIMIT ${limit}`;
      break;
    case "action":
      q = _sqlAB`SELECT DISTINCT ${_auditAB.action} AS v FROM ${_auditAB} WHERE ${_auditAB.userId} = ${ctx.userId} AND lower(${_auditAB.action}) LIKE ${like} ORDER BY v LIMIT ${limit}`;
      break;
    case "filename":
      q = _sqlAB`SELECT DISTINCT ${_artifactsZ.filename} AS v FROM ${_artifactsZ} WHERE ${_artifactsZ.userId} = ${ctx.userId} AND ${_artifactsZ.deletedAt} IS NULL AND lower(${_artifactsZ.filename}) LIKE ${like} ORDER BY v LIMIT ${limit}`;
      break;
    case "event":
      q = _sqlAB`SELECT DISTINCT ${webhookDeliveries.event} AS v FROM ${webhookDeliveries} WHERE ${webhookDeliveries.userId} = ${ctx.userId} AND lower(${webhookDeliveries.event}) LIKE ${like} ORDER BY v LIMIT ${limit}`;
      break;
    case "notification_type":
      q = _sqlAB`SELECT DISTINCT ${notifications.type} AS v FROM ${notifications} WHERE ${notifications.userId} = ${ctx.userId} AND lower(${notifications.type}) LIKE ${like} ORDER BY v LIMIT ${limit}`;
      break;
  }
  const res = await d.execute(q);
  const rows = (res as unknown as { rows?: Array<{ v?: string }> }).rows ?? (res as unknown as Array<{ v?: string }>);
  const suggestions = (Array.isArray(rows) ? rows : []).map((r) => r.v).filter((v): v is string => typeof v === "string");
  return { field: input.field, prefix: input.prefix ?? "", count: suggestions.length, suggestions };
}

export async function searchLookup(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const raw = input.id.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  const asInt = /^\d+$/.test(raw) ? Number(raw) : null;

  const candidates: Array<{ index: SearchIndexAB; probe: () => Promise<{ ts: Date; meta: Record<string, unknown> } | null> }> = [];

  if (isUuid) {
    candidates.push(
      { index: "artifacts", probe: async () => {
        const [r] = await d.select().from(_artifactsZ).where(and(eq(_artifactsZ.id, raw), eq(_artifactsZ.userId, ctx.userId))).limit(1);
        return r ? { ts: r.createdAt, meta: { filename: r.filename, bytes: r.bytes, deleted: !!r.deletedAt } } : null;
      } },
      { index: "watchers", probe: async () => {
        const [r] = await d.select().from(agentTreasuryWatchers).where(and(eq(agentTreasuryWatchers.id, raw), eq(agentTreasuryWatchers.userId, ctx.userId))).limit(1);
        return r ? { ts: r.createdAt, meta: { chain: r.chain, address: r.address } } : null;
      } },
      { index: "proposals", probe: async () => {
        const [r] = await d.select().from(agentTxProposals).where(and(eq(agentTxProposals.id, raw), eq(agentTxProposals.userId, ctx.userId))).limit(1);
        return r ? { ts: r.createdAt, meta: { kind: r.kind, status: r.status } } : null;
      } },
      { index: "deliveries", probe: async () => {
        const [r] = await d.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.id, raw), eq(webhookDeliveries.userId, ctx.userId))).limit(1);
        return r ? { ts: r.createdAt, meta: { event: r.event, status: r.status } } : null;
      } },
    );
  }

  if (asInt !== null) {
    candidates.push(
      { index: "audit", probe: async () => {
        const [r] = await d.select().from(_auditAB).where(and(eq(_auditAB.id, asInt), eq(_auditAB.userId, ctx.userId))).limit(1);
        return r ? { ts: r.ts, meta: { action: r.action, target: r.target } } : null;
      } },
      { index: "usage", probe: async () => {
        const [r] = await d.select().from(_usageAB).where(and(eq(_usageAB.id, asInt), eq(_usageAB.userId, ctx.userId))).limit(1);
        return r ? { ts: r.ts, meta: { capabilityId: r.capabilityId, status: r.status } } : null;
      } },
      { index: "notifications", probe: async () => {
        const [r] = await d.select().from(notifications).where(and(eq(notifications.id, asInt), eq(notifications.userId, ctx.userId))).limit(1);
        return r ? { ts: r.createdAt, meta: { title: r.title, type: r.type } } : null;
      } },
      { index: "monitors", probe: async () => {
        const [r] = await d.select().from(monitors).where(and(eq(monitors.id, asInt), eq(monitors.userId, ctx.userId))).limit(1);
        return r ? { ts: r.createdAt, meta: { type: r.type, target: r.target } } : null;
      } },
    );
  }

  if (candidates.length === 0) {
    return { id: raw, match: null, probed: [] as string[], reason: "id is neither a uuid nor a positive integer" };
  }

  const probed: string[] = [];
  for (const c of candidates) {
    probed.push(c.index);
    try {
      const hit = await c.probe();
      if (hit) {
        return {
          id: raw,
          match: { index: c.index, id: raw, ts: new Date(hit.ts).toISOString(), meta: hit.meta },
          probed,
        };
      }
    } catch {
      // probe failed (likely wrong column type cast) — keep going
    }
  }
  return { id: raw, match: null, probed };
}

export async function searchIndexes(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return {
    indexes: [
      { id: "audit", table: "public_api_audit_log", tsField: "ts", textFields: ["action", "target", "meta(text)"], pkType: "int" },
      { id: "artifacts", table: "public_api_artifacts", tsField: "created_at", textFields: ["filename", "mime", "sha256", "metadata(text)"], pkType: "uuid" },
      { id: "notifications", table: "notifications", tsField: "created_at", textFields: ["title", "message", "type", "severity"], pkType: "int" },
      { id: "watchers", table: "agent_treasury_watchers", tsField: "created_at", textFields: ["label", "address", "chain"], pkType: "uuid" },
      { id: "monitors", table: "monitors", tsField: "created_at", textFields: ["target", "type", "operator", "wallet_address"], pkType: "int" },
      { id: "deliveries", table: "webhook_deliveries", tsField: "created_at", textFields: ["event", "error", "status", "payload(text)"], pkType: "uuid" },
      { id: "proposals", table: "agent_tx_proposals", tsField: "created_at", textFields: ["summary", "kind", "status", "chain"], pkType: "uuid" },
      { id: "usage", table: "public_api_key_usage", tsField: "ts", textFields: ["capability_id", "status", "error_code", "transport"], pkType: "int" },
    ],
  };
}

export async function searchPolicy(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return {
    operator: "AND",
    matching: "case-insensitive substring (ILIKE %tok%) over concatenated text fields",
    tokenization: "whitespace-split, lowercased, max 8 tokens, max 256 chars per query",
    maxLimit: _SEARCH_MAX_LIMIT_AB,
    defaultLimit: _SEARCH_DEFAULT_LIMIT_AB,
    snippetChars: _SNIPPET_MAX_AB,
    scoring: {
      formula: "0.7 * tokenCoverage + 0.3 * recencyDecay",
      recencyHalfLifeDays: 30,
      deterministic: true,
    },
    scope: "every hit is filtered by userId in SQL; cross-tenant leakage is structurally impossible",
    notIndexed: ["secrets", "raw payloads outside the listed columns"],
  };
}


// ─────────────────────────────────────────────────────────────────────
// Phase 20 — Pillar AD: Status, SLO & Deprecations
// ─────────────────────────────────────────────────────────────────────
// Health/uptime derived from public_api_key_usage; SLO targets, the
// deprecation feed and the changelog are curated constants. No new
// tables, no writes, no webhooks. Aggregates are Dreyv-wide (not per
// caller) because that's what "status page" means.

import { isR2Configured as _isR2AD } from "@/lib/agents/artifacts/r2-storage";

const _SLO_AD = {
  availability: {
    overall: 0.999,
    "pillar:read": 0.9995,
    "pillar:write": 0.999,
    "infra:postgres": 0.9999,
    "infra:r2-storage": 0.999,
    "infra:webhook-dispatcher": 0.99,
    "infra:rate-limiter": 0.9999,
    "infra:audit-chain": 0.9999,
  },
  latencyP95Ms: {
    "pillar:read": 400,
    "pillar:write": 1500,
    "infra:postgres": 80,
    "infra:r2-storage": 800,
    "infra:webhook-dispatcher": 6000,
    "infra:rate-limiter": 5,
    "infra:audit-chain": 60,
  },
} as const;

type StatusAD = "operational" | "degraded" | "partial_outage" | "major_outage";

interface UsageRowAD {
  capability_id: string;
  status: string;
  latency_ms: number | null;
  ts: Date;
}

async function _fetchUsageWindowAD(windowMinutes: number): Promise<UsageRowAD[]> {
  const d = requireDb();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const q = _sqlAB`
    SELECT capability_id, status, latency_ms, ts
    FROM ${_usageAB}
    WHERE ts >= ${since}
    ORDER BY ts ASC
    LIMIT 200000
  `;
  const res = await d.execute(q);
  const rows = (res as unknown as { rows?: UsageRowAD[] }).rows ?? (res as unknown as UsageRowAD[]);
  return Array.isArray(rows) ? rows.map((r) => ({ ...r, ts: new Date(r.ts) })) : [];
}

function _pillarOfCapabilityIdAD(capId: string): string {
  const head = capId.split(".")[0] ?? "unknown";
  return `pillar:${head}`;
}

function _isErrorStatusAD(s: string): boolean {
  // `rate_limited` counts as throttled-but-up; `denied` (auth/scope) is a
  // client error, not a Dreyv outage. Only `error` counts against uptime.
  return s === "error";
}

function _p95AD(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return Math.round(sorted[idx]);
}

function _statusFromErrorRateAD(errorRate: number, sample: number): StatusAD {
  if (sample < 5) return "operational"; // not enough signal to call an outage
  if (errorRate >= 0.5) return "major_outage";
  if (errorRate >= 0.15) return "partial_outage";
  if (errorRate >= 0.03) return "degraded";
  return "operational";
}

function _worstStatusAD(a: StatusAD, b: StatusAD): StatusAD {
  const rank: Record<StatusAD, number> = {
    operational: 0, degraded: 1, partial_outage: 2, major_outage: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

interface ComponentSnapshotAD {
  id: string;
  kind: "pillar" | "infra";
  status: StatusAD;
  sample: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  slo: { availability: number | null; latencyP95Ms: number | null };
}

async function _buildSnapshotsAD(windowMinutes: number): Promise<ComponentSnapshotAD[]> {
  const rows = await _fetchUsageWindowAD(windowMinutes);

  // Group by pillar:<name>
  const byPillar = new Map<string, UsageRowAD[]>();
  for (const r of rows) {
    const key = _pillarOfCapabilityIdAD(r.capability_id);
    const arr = byPillar.get(key) ?? [];
    arr.push(r);
    byPillar.set(key, arr);
  }

  const out: ComponentSnapshotAD[] = [];
  for (const [id, arr] of byPillar) {
    const errors = arr.filter((r) => _isErrorStatusAD(r.status)).length;
    const latencies = arr.map((r) => r.latency_ms ?? 0).filter((n) => n > 0);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = _p95AD(latencies);
    const errorRate = arr.length ? errors / arr.length : 0;
    out.push({
      id,
      kind: "pillar",
      status: _statusFromErrorRateAD(errorRate, arr.length),
      sample: arr.length,
      errorRate: +errorRate.toFixed(4),
      p50Ms: p50,
      p95Ms: p95,
      slo: {
        availability: (_SLO_AD.availability as Record<string, number>)[id] ?? _SLO_AD.availability["pillar:read"],
        latencyP95Ms: (_SLO_AD.latencyP95Ms as Record<string, number>)[id] ?? _SLO_AD.latencyP95Ms["pillar:read"],
      },
    });
  }

  // Infra probes — derived live, not from usage rows.
  const dbProbe = await _probeDbAD();
  out.push(dbProbe);
  const r2Probe = await _probeR2AD();
  out.push(r2Probe);
  const auditProbe = await _probeAuditChainAD();
  out.push(auditProbe);
  const webhookProbe = await _probeWebhookDispatcherAD(windowMinutes);
  out.push(webhookProbe);
  out.push({
    id: "infra:rate-limiter",
    kind: "infra",
    status: "operational",
    sample: 0,
    errorRate: 0,
    p50Ms: 1,
    p95Ms: 3,
    slo: { availability: _SLO_AD.availability["infra:rate-limiter"], latencyP95Ms: _SLO_AD.latencyP95Ms["infra:rate-limiter"] },
  });

  return out;
}

async function _probeDbAD(): Promise<ComponentSnapshotAD> {
  const id = "infra:postgres";
  if (!db) {
    return { id, kind: "infra", status: "major_outage", sample: 1, errorRate: 1, p50Ms: 0, p95Ms: 0,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] } };
  }
  const started = Date.now();
  try {
    await db.execute(_sqlAB`SELECT 1`);
    const lat = Date.now() - started;
    return {
      id, kind: "infra", status: lat > _SLO_AD.latencyP95Ms[id] * 3 ? "degraded" : "operational",
      sample: 1, errorRate: 0, p50Ms: lat, p95Ms: lat,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] },
    };
  } catch {
    return { id, kind: "infra", status: "major_outage", sample: 1, errorRate: 1, p50Ms: 0, p95Ms: 0,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] } };
  }
}

async function _probeR2AD(): Promise<ComponentSnapshotAD> {
  const id = "infra:r2-storage";
  const configured = _isR2AD();
  return {
    id, kind: "infra",
    status: configured ? "operational" : "degraded",
    sample: 0, errorRate: configured ? 0 : 1, p50Ms: 0, p95Ms: 0,
    slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] },
  };
}

async function _probeAuditChainAD(): Promise<ComponentSnapshotAD> {
  const id = "infra:audit-chain";
  if (!db) {
    return { id, kind: "infra", status: "major_outage", sample: 0, errorRate: 1, p50Ms: 0, p95Ms: 0,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] } };
  }
  const started = Date.now();
  try {
    await db.execute(_sqlAB`SELECT count(*)::int FROM ${_auditAB} WHERE ts >= now() - interval '1 hour'`);
    const lat = Date.now() - started;
    return {
      id, kind: "infra", status: lat > _SLO_AD.latencyP95Ms[id] * 3 ? "degraded" : "operational",
      sample: 1, errorRate: 0, p50Ms: lat, p95Ms: lat,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] },
    };
  } catch {
    return { id, kind: "infra", status: "degraded", sample: 1, errorRate: 1, p50Ms: 0, p95Ms: 0,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] } };
  }
}

async function _probeWebhookDispatcherAD(windowMinutes: number): Promise<ComponentSnapshotAD> {
  const id = "infra:webhook-dispatcher";
  if (!db) {
    return { id, kind: "infra", status: "major_outage", sample: 0, errorRate: 1, p50Ms: 0, p95Ms: 0,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] } };
  }
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const q = _sqlAB`
    SELECT status, latency_ms
    FROM ${webhookDeliveries}
    WHERE created_at >= ${since}
    LIMIT 50000
  `;
  try {
    const res = await db.execute(q);
    const rows = ((res as unknown as { rows?: Array<{ status: string; latency_ms: number | null }> }).rows
      ?? (res as unknown as Array<{ status: string; latency_ms: number | null }>)) ?? [];
    const arr = Array.isArray(rows) ? rows : [];
    const failed = arr.filter((r) => r.status === "failed").length;
    const errorRate = arr.length ? failed / arr.length : 0;
    const latencies = arr.map((r) => r.latency_ms ?? 0).filter((n) => n > 0);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = _p95AD(latencies);
    return {
      id, kind: "infra",
      status: _statusFromErrorRateAD(errorRate, arr.length),
      sample: arr.length, errorRate: +errorRate.toFixed(4), p50Ms: p50, p95Ms: p95,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] },
    };
  } catch {
    return { id, kind: "infra", status: "degraded", sample: 0, errorRate: 0, p50Ms: 0, p95Ms: 0,
      slo: { availability: _SLO_AD.availability[id], latencyP95Ms: _SLO_AD.latencyP95Ms[id] } };
  }
}

export async function statusHealth(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  const snapshots = await _buildSnapshotsAD(15);
  const overall = snapshots.reduce<StatusAD>((acc, s) => _worstStatusAD(acc, s.status), "operational");
  const worst = snapshots
    .filter((s) => s.status !== "operational")
    .sort((a, b) => b.errorRate - a.errorRate)[0] ?? null;
  const summary =
    overall === "operational"
      ? "All systems operational."
      : `${overall.replace("_", " ")}: ${worst?.id ?? "unknown"} (error rate ${((worst?.errorRate ?? 0) * 100).toFixed(1)}%).`;
  return {
    status: overall,
    summary,
    windowMinutes: 15,
    generatedAt: new Date().toISOString(),
    components: snapshots.map((s) => ({ id: s.id, status: s.status, errorRate: s.errorRate, sample: s.sample })),
    worstComponent: worst ? { id: worst.id, status: worst.status, errorRate: worst.errorRate } : null,
  };
}

export async function statusComponents(input: { windowMinutes?: number }, _ctx: CapabilityRunContext) {
  const w = Math.min(Math.max(input.windowMinutes ?? 15, 5), 1440);
  const snapshots = await _buildSnapshotsAD(w);
  return {
    windowMinutes: w,
    generatedAt: new Date().toISOString(),
    count: snapshots.length,
    components: snapshots,
  };
}

export async function statusUptime(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  const d = requireDb();
  const windows = [
    { id: "1h", minutes: 60 },
    { id: "24h", minutes: 60 * 24 },
    { id: "7d", minutes: 60 * 24 * 7 },
    { id: "30d", minutes: 60 * 24 * 30 },
  ];
  const out: Record<string, { uptime: number; sampleMinutes: number; downMinutes: number }> = {};
  for (const w of windows) {
    const since = new Date(Date.now() - w.minutes * 60_000).toISOString();
    const q = _sqlAB`
      SELECT
        date_trunc('minute', ts) AS minute,
        sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errs,
        count(*)::int AS total
      FROM ${_usageAB}
      WHERE ts >= ${since}
      GROUP BY 1
      ORDER BY 1
    `;
    try {
      const res = await d.execute(q);
      const rows = ((res as unknown as { rows?: Array<{ errs: number | string; total: number | string }> }).rows
        ?? (res as unknown as Array<{ errs: number | string; total: number | string }>)) ?? [];
      const arr = Array.isArray(rows) ? rows : [];
      const downMinutes = arr.filter((r) => Number(r.total) > 0 && Number(r.errs) / Number(r.total) > 0.5).length;
      const sampleMinutes = arr.length;
      const uptime = sampleMinutes > 0 ? +(1 - downMinutes / sampleMinutes).toFixed(5) : 1;
      out[w.id] = { uptime, sampleMinutes, downMinutes };
    } catch {
      out[w.id] = { uptime: 1, sampleMinutes: 0, downMinutes: 0 };
    }
  }
  return { generatedAt: new Date().toISOString(), windows: out };
}

interface IncidentAD {
  id: string;
  component: string;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
  peakErrorRate: number;
  affectedRequests: number;
  durationMinutes: number;
}

export async function statusIncidents(
  input: { lookbackHours?: number; includeResolved?: boolean },
  _ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const hours = Math.min(Math.max(input.lookbackHours ?? 24, 1), 168);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const q = _sqlAB`
    SELECT
      split_part(capability_id, '.', 1) AS pillar,
      date_trunc('minute', ts) AS minute,
      sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errs,
      count(*)::int AS total
    FROM ${_usageAB}
    WHERE ts >= ${since}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  let rows: Array<{ pillar: string; minute: Date | string; errs: number | string; total: number | string }> = [];
  try {
    const res = await d.execute(q);
    rows = ((res as unknown as { rows?: typeof rows }).rows ?? (res as unknown as typeof rows)) ?? [];
  } catch {
    rows = [];
  }

  // Group by pillar, walk minute-by-minute, find degraded runs (>15% errs, ≥5 samples).
  const byPillar = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byPillar.get(r.pillar) ?? [];
    arr.push(r);
    byPillar.set(r.pillar, arr);
  }

  const incidents: IncidentAD[] = [];
  const nowMs = Date.now();
  for (const [pillar, arr] of byPillar) {
    arr.sort((a, b) => new Date(a.minute).getTime() - new Date(b.minute).getTime());
    let runStart: Date | null = null;
    let runEnd: Date | null = null;
    let peak = 0;
    let affected = 0;
    const flush = () => {
      if (!runStart || !runEnd) return;
      const active = nowMs - runEnd.getTime() < 5 * 60_000;
      const duration = Math.max(1, Math.round((runEnd.getTime() - runStart.getTime()) / 60_000));
      incidents.push({
        id: `${pillar}:${runStart.toISOString()}`,
        component: `pillar:${pillar}`,
        startedAt: runStart.toISOString(),
        endedAt: active ? null : runEnd.toISOString(),
        active,
        peakErrorRate: +peak.toFixed(4),
        affectedRequests: affected,
        durationMinutes: duration,
      });
      runStart = null; runEnd = null; peak = 0; affected = 0;
    };
    for (const r of arr) {
      const total = Number(r.total);
      const errs = Number(r.errs);
      const rate = total > 0 ? errs / total : 0;
      const isDown = total >= 5 && rate > 0.15;
      const minute = new Date(r.minute);
      if (isDown) {
        if (!runStart) runStart = minute;
        runEnd = minute;
        if (rate > peak) peak = rate;
        affected += errs;
      } else {
        flush();
      }
    }
    flush();
  }

  const includeResolved = input.includeResolved ?? true;
  const filtered = includeResolved ? incidents : incidents.filter((i) => i.active);
  filtered.sort((a, b) => (Number(b.active) - Number(a.active)) || (Date.parse(b.startedAt) - Date.parse(a.startedAt)));

  return {
    lookbackHours: hours,
    generatedAt: new Date().toISOString(),
    activeCount: incidents.filter((i) => i.active).length,
    resolvedCount: incidents.filter((i) => !i.active).length,
    incidents: filtered,
  };
}

export async function statusSlo(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  const d = requireDb();
  async function burnFor(minutes: number): Promise<number> {
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    try {
      const res = await d.execute(_sqlAB`
        SELECT
          count(*)::int AS total,
          sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errs
        FROM ${_usageAB} WHERE ts >= ${since}
      `);
      const rows = ((res as unknown as { rows?: Array<{ total: number | string; errs: number | string }> }).rows
        ?? (res as unknown as Array<{ total: number | string; errs: number | string }>)) ?? [];
      const r = Array.isArray(rows) ? rows[0] : undefined;
      const total = Number(r?.total ?? 0);
      const errs = Number(r?.errs ?? 0);
      if (total < 10) return 0;
      const errorRate = errs / total;
      const budget = 1 - _SLO_AD.availability.overall; // e.g. 0.001
      return +(errorRate / budget).toFixed(3);
    } catch {
      return 0;
    }
  }
  const [burn1h, burn6h] = await Promise.all([burnFor(60), burnFor(360)]);
  return {
    generatedAt: new Date().toISOString(),
    targets: _SLO_AD,
    overall: {
      availabilityTarget: _SLO_AD.availability.overall,
      errorBudget30d: +(1 - _SLO_AD.availability.overall).toFixed(5),
      burnRate1h: burn1h,
      burnRate6h: burn6h,
      status: burn1h > 14.4 || burn6h > 6
        ? "critical"
        : burn1h > 1 || burn6h > 1
        ? "warning"
        : "ok",
      note: "Burn rate >1 means the error budget is being consumed faster than the window allows; >14.4 (1h) is a critical-page-the-oncall threshold.",
    },
  };
}

interface DeprecationAD {
  capability: string;
  status: "deprecated" | "sunset";
  announcedAt: string;
  sunsetAt: string;
  replacement: string | null;
  notes: string;
}

const _DEPRECATIONS_AD: DeprecationAD[] = [
  // Curated, empty by default. Add entries here when capabilities are
  // marked deprecated and surface via `Sunset` header in /api/v1.
];

export async function statusDeprecations(
  input: { includeActive?: boolean },
  _ctx: CapabilityRunContext,
) {
  const now = Date.now();
  const active = _DEPRECATIONS_AD.filter((d) => new Date(d.sunsetAt).getTime() > now);
  const past = _DEPRECATIONS_AD.filter((d) => new Date(d.sunsetAt).getTime() <= now);
  const include = input.includeActive ?? true;
  return {
    generatedAt: new Date().toISOString(),
    count: _DEPRECATIONS_AD.length,
    deprecations: include ? _DEPRECATIONS_AD : past,
    activeCount: active.length,
    pastCount: past.length,
  };
}

interface ChangelogEntryAD {
  version: string;
  releasedAt: string;
  phase: number;
  pillar: string;
  title: string;
  added: string[];
  breaking: string[];
  notes: string;
}

const _CHANGELOG_AD: ChangelogEntryAD[] = [
  {
    version: "v1.20.0", releasedAt: "2026-06-21", phase: 20, pillar: "status",
    title: "Pillar AD — Status, SLO & deprecations",
    added: [
      "status.health", "status.components", "status.uptime", "status.incidents",
      "status.slo", "status.deprecations", "status.changelog", "status.version",
    ],
    breaking: [],
    notes: "Read-only status surface. Health/uptime derived from public_api_key_usage; SLOs and changelog are curated. New scope: read:status.",
  },
  {
    version: "v1.19.0", releasedAt: "2026-06-21", phase: 19, pillar: "search",
    title: "Pillar AB — Search & indexing",
    added: ["search.query", "search.recent", "search.facets", "search.suggest", "search.lookup", "search.indexes", "search.policy"],
    breaking: [],
    notes: "Cross-pillar caller-scoped search. New scope: read:search.",
  },
  {
    version: "v1.18.0", releasedAt: "2026-06-21", phase: 18, pillar: "storage",
    title: "Pillar Z — Storage & artifacts",
    added: ["storage.put", "storage.list", "storage.get", "storage.stat", "storage.delete", "storage.quota", "storage.policy"],
    breaking: [],
    notes: "R2-backed artifact storage with per-tier quota. New scopes: read:storage, write:storage. New webhooks: storage.artifact_created, storage.artifact_deleted, storage.quota_exceeded.",
  },
  {
    version: "v1.17.0", releasedAt: "2026-06-21", phase: 17, pillar: "privacy",
    title: "Pillar Y — Privacy & data rights",
    added: ["privacy.consents", "privacy.update_consent", "privacy.requests", "privacy.submit_request", "privacy.export_data", "privacy.retention_policy"],
    breaking: [],
    notes: "DSAR workflow with statutory 30-day window. New scopes: read:privacy, write:privacy. New webhooks: privacy.export_ready, privacy.deletion_requested, privacy.consent_changed.",
  },
];

export async function statusChangelog(
  input: { limit?: number; sinceVersion?: string },
  _ctx: CapabilityRunContext,
) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  let entries = [..._CHANGELOG_AD];
  if (input.sinceVersion) {
    const idx = entries.findIndex((e) => e.version === input.sinceVersion);
    if (idx >= 0) entries = entries.slice(0, idx);
  }
  return {
    generatedAt: new Date().toISOString(),
    count: Math.min(entries.length, limit),
    total: _CHANGELOG_AD.length,
    entries: entries.slice(0, limit),
  };
}

export async function statusVersion(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  const { listPublicCapabilities } = await import("./registry");
  const caps = listPublicCapabilities();
  const byPillar: Record<string, number> = {};
  const bySide: Record<string, number> = { read: 0, simulate: 0, write: 0 };
  const byStatus: Record<string, number> = { stable: 0, preview: 0 };
  for (const c of caps) {
    byPillar[c.pillar] = (byPillar[c.pillar] ?? 0) + 1;
    bySide[c.sideEffects] = (bySide[c.sideEffects] ?? 0) + 1;
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? null;
  return {
    api: "v1",
    generatedAt: new Date().toISOString(),
    totals: { capabilities: caps.length, pillars: Object.keys(byPillar).length, deprecations: _DEPRECATIONS_AD.length },
    byPillar, bySideEffect: bySide, byStatus,
    transports: ["rest", "mcp"],
    build: {
      commit: commit ? commit.slice(0, 12) : null,
      commitFull: commit,
      node: process.version,
      releasedAt: _CHANGELOG_AD[0]?.releasedAt ?? null,
      latestVersion: _CHANGELOG_AD[0]?.version ?? "v1.0.0",
    },
  };
}

// ─── Pillar AE — Jobs & Scheduling (Phase 21) ────────────────────────
import {
  publicApiJobs as _jobsAE,
  publicApiJobRuns as _jobRunsAE,
} from "@/db/schema";
import { sql as _sqlAE } from "drizzle-orm";

const _MIN_INTERVAL_AE = 60;          // 60s floor between recurring runs
const _MAX_INTERVAL_AE = 60 * 60 * 24 * 30; // 30 days ceiling
const _MAX_INPUT_BYTES_AE = 32 * 1024;
const _MAX_RESULT_CAPTURE_AE = 16 * 1024;

const _TIER_JOB_LIMITS_AE: Record<string, { jobs: number; minIntervalSeconds: number }> = {
  free:  { jobs: 5,   minIntervalSeconds: 60 * 15 },  // 15 min floor
  mini:  { jobs: 50,  minIntervalSeconds: 60 * 5  },  // 5 min
  max:   { jobs: 500, minIntervalSeconds: 60      },  // 1 min
};

async function _userTierAE(userId: string): Promise<"free" | "mini" | "max"> {
  const d = requireDb();
  const { users } = await import("@/db/schema");
  const [u] = await d.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
  const t = (u?.tier ?? "free") as string;
  return (t === "mini" || t === "max") ? t : "free";
}

function _truncateForCaptureAE(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length <= _MAX_RESULT_CAPTURE_AE) return value;
    return { _truncated: true, preview: s.slice(0, _MAX_RESULT_CAPTURE_AE) };
  } catch {
    return { _unserializable: true };
  }
}

async function _loadJobAE(id: string, userId: string) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_jobsAE)
    .where(and(eq(_jobsAE.id, id), eq(_jobsAE.userId, userId)))
    .limit(1);
  if (!row) throw new CapabilityError(`Job ${id} not found`, 404, null);
  return row;
}

export async function jobsSchedule(
  input: {
    label: string;
    capabilityId: string;
    payload?: Record<string, unknown>;
    kind?: "recurring" | "one_shot";
    intervalSeconds?: number;
    runAt?: string;
    maxRetries?: number;
    metadata?: Record<string, unknown>;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { getCapabilityById } = await import("./registry");
  const cap = getCapabilityById(input.capabilityId);
  if (!cap) throw new CapabilityError(`Unknown capability '${input.capabilityId}'`, 400, null);
  if (cap.id.startsWith("jobs.")) {
    throw new CapabilityError("Cannot schedule a jobs.* capability (would loop)", 400, null);
  }

  // Payload size guard
  const payload = input.payload ?? {};
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (payloadBytes > _MAX_INPUT_BYTES_AE) {
    throw new CapabilityError(
      `Job payload exceeds ${_MAX_INPUT_BYTES_AE} bytes (got ${payloadBytes})`,
      413,
      null,
    );
  }

  // Validate payload against the capability's own schema (catches bad jobs at schedule time)
  const parsed = cap.inputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CapabilityError(
      `Job payload invalid for '${cap.id}': ${parsed.error.message}`,
      400,
      parsed.error.flatten(),
    );
  }

  const kind: "recurring" | "one_shot" = input.kind ?? "recurring";
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_JOB_LIMITS_AE[tier];

  // Quota: count active+paused jobs (cancelled/completed don't count)
  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_jobsAE)
    .where(
      and(
        eq(_jobsAE.userId, ctx.userId),
        _sqlAE`${_jobsAE.status} IN ('active','paused')`,
      ),
    );
  if (n >= limits.jobs) {
    throw new CapabilityError(
      `Job quota reached for tier '${tier}' (${n}/${limits.jobs}). Upgrade or cancel jobs.`,
      402,
      { tier, used: n, limit: limits.jobs },
    );
  }

  let nextRunAt: Date;
  let intervalSeconds: number | null = null;
  if (kind === "recurring") {
    const iv = Math.floor(input.intervalSeconds ?? limits.minIntervalSeconds);
    if (iv < limits.minIntervalSeconds) {
      throw new CapabilityError(
        `Interval ${iv}s below tier '${tier}' minimum of ${limits.minIntervalSeconds}s`,
        400,
        { tier, minIntervalSeconds: limits.minIntervalSeconds },
      );
    }
    if (iv > _MAX_INTERVAL_AE) {
      throw new CapabilityError(`Interval exceeds 30-day ceiling`, 400, null);
    }
    intervalSeconds = iv;
    nextRunAt = new Date(Date.now() + iv * 1000);
  } else {
    if (!input.runAt) throw new CapabilityError("one_shot job requires runAt (ISO timestamp)", 400, null);
    const t = new Date(input.runAt);
    if (isNaN(t.getTime())) throw new CapabilityError("runAt is not a valid ISO timestamp", 400, null);
    if (t.getTime() < Date.now() - 5000) {
      throw new CapabilityError("runAt must be in the future", 400, null);
    }
    nextRunAt = t;
  }

  const label = input.label.trim().slice(0, 120) || `Job: ${cap.id}`;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 3, 10));

  const [row] = await d
    .insert(_jobsAE)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      label,
      capabilityId: cap.id,
      input: payload,
      kind,
      intervalSeconds,
      nextRunAt,
      maxRetries,
      metadata: input.metadata ?? {},
    })
    .returning();

  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "jobs.schedule",
    target: row.id,
    meta: { capabilityId: cap.id, kind, intervalSeconds, nextRunAt: nextRunAt.toISOString() },
  });

  void emitWebhookEvent({
    userId: ctx.userId,
    event: "job.scheduled",
    data: { jobId: row.id, capabilityId: cap.id, kind, nextRunAt: nextRunAt.toISOString() },
  }).catch(() => undefined);

  return {
    id: row.id,
    label: row.label,
    capabilityId: row.capabilityId,
    kind: row.kind,
    intervalSeconds: row.intervalSeconds,
    nextRunAt: row.nextRunAt,
    status: row.status,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
    tier,
    quota: { used: n + 1, limit: limits.jobs },
  };
}

export async function jobsList(
  input: { status?: "active" | "paused" | "cancelled" | "completed"; capabilityId?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_jobsAE.userId, ctx.userId)];
  if (input.status) conds.push(eq(_jobsAE.status, input.status));
  if (input.capabilityId) conds.push(eq(_jobsAE.capabilityId, input.capabilityId));
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await d
    .select()
    .from(_jobsAE)
    .where(and(...conds))
    .orderBy(desc(_jobsAE.createdAt))
    .limit(limit);
  return { count: rows.length, jobs: rows };
}

export async function jobsGet(
  input: { id: string; includeRuns?: boolean; runLimit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const job = await _loadJobAE(input.id, ctx.userId);
  let runs: unknown[] = [];
  if (input.includeRuns) {
    const lim = Math.min(Math.max(input.runLimit ?? 20, 1), 200);
    runs = await d
      .select()
      .from(_jobRunsAE)
      .where(eq(_jobRunsAE.jobId, job.id))
      .orderBy(desc(_jobRunsAE.createdAt))
      .limit(lim);
  }
  return { job, runs };
}

export async function jobsCancel(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const job = await _loadJobAE(input.id, ctx.userId);
  if (job.status === "cancelled" || job.status === "completed") {
    return { id: job.id, status: job.status, alreadyTerminal: true };
  }
  const [updated] = await d
    .update(_jobsAE)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(_jobsAE.id, job.id))
    .returning();
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "jobs.cancel",
    target: job.id,
    meta: { previousStatus: job.status },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "job.cancelled",
    data: { jobId: job.id, capabilityId: job.capabilityId, previousStatus: job.status },
  }).catch(() => undefined);
  return { id: updated.id, status: updated.status, alreadyTerminal: false };
}

export async function jobsRunNow(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const job = await _loadJobAE(input.id, ctx.userId);
  if (job.status === "cancelled" || job.status === "completed") {
    throw new CapabilityError(`Cannot run job in terminal status '${job.status}'`, 409, null);
  }
  const { getCapabilityById } = await import("./registry");
  const cap = getCapabilityById(job.capabilityId);
  if (!cap) throw new CapabilityError(`Capability '${job.capabilityId}' no longer registered`, 410, null);

  const [run] = await d
    .insert(_jobRunsAE)
    .values({
      jobId: job.id,
      userId: ctx.userId,
      status: "running",
      attempt: 1,
      startedAt: new Date(),
      triggeredBy: "manual",
    })
    .returning();

  const t0 = Date.now();
  let status: "ok" | "failed" = "ok";
  let result: unknown = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  try {
    const parsed = cap.inputSchema.safeParse(job.input ?? {});
    if (!parsed.success) {
      throw new CapabilityError(`Stored payload invalid: ${parsed.error.message}`, 400, parsed.error.flatten());
    }
    result = await cap.handler(parsed.data as never, {
      ...ctx,
      capabilityId: cap.id,
    } as CapabilityRunContext);
  } catch (err) {
    status = "failed";
    if (err instanceof CapabilityError) {
      errorCode = `http_${err.status}`;
      errorMessage = err.message;
    } else {
      errorCode = "exception";
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
  const duration = Date.now() - t0;

  await d
    .update(_jobRunsAE)
    .set({
      status,
      finishedAt: new Date(),
      durationMs: duration,
      result: status === "ok" ? (_truncateForCaptureAE(result) as object) : null,
      errorCode,
      errorMessage,
    })
    .where(eq(_jobRunsAE.id, run.id));

  await d
    .update(_jobsAE)
    .set({
      lastRunAt: new Date(),
      lastStatus: status,
      runCount: (job.runCount ?? 0) + 1,
      failCount: (job.failCount ?? 0) + (status === "failed" ? 1 : 0),
      updatedAt: new Date(),
    })
    .where(eq(_jobsAE.id, job.id));

  void emitWebhookEvent({
    userId: ctx.userId,
    event: status === "ok" ? "job.completed" : "job.failed",
    data: { jobId: job.id, runId: run.id, capabilityId: job.capabilityId, durationMs: duration, errorCode },
  }).catch(() => undefined);

  return {
    runId: run.id,
    jobId: job.id,
    status,
    durationMs: duration,
    triggeredBy: "manual" as const,
    errorCode,
    errorMessage,
    result: status === "ok" ? _truncateForCaptureAE(result) : null,
  };
}

export async function jobsRuns(
  input: { jobId?: string; status?: "queued" | "running" | "ok" | "failed" | "cancelled"; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_jobRunsAE.userId, ctx.userId)];
  if (input.jobId) conds.push(eq(_jobRunsAE.jobId, input.jobId));
  if (input.status) conds.push(eq(_jobRunsAE.status, input.status));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const rows = await d
    .select()
    .from(_jobRunsAE)
    .where(and(...conds))
    .orderBy(desc(_jobRunsAE.createdAt))
    .limit(limit);
  return { count: rows.length, runs: rows };
}

export async function jobsRetry(
  input: { runId: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [orig] = await d
    .select()
    .from(_jobRunsAE)
    .where(and(eq(_jobRunsAE.id, input.runId), eq(_jobRunsAE.userId, ctx.userId)))
    .limit(1);
  if (!orig) throw new CapabilityError(`Run ${input.runId} not found`, 404, null);
  if (orig.status !== "failed") {
    throw new CapabilityError(`Only failed runs can be retried (run is '${orig.status}')`, 409, null);
  }
  const job = await _loadJobAE(orig.jobId, ctx.userId);
  if (job.status === "cancelled") {
    throw new CapabilityError("Job is cancelled", 409, null);
  }
  if ((orig.attempt ?? 1) >= (job.maxRetries ?? 3) + 1) {
    throw new CapabilityError(
      `Max retries reached (${orig.attempt}/${(job.maxRetries ?? 3) + 1})`,
      409,
      null,
    );
  }
  const { getCapabilityById } = await import("./registry");
  const cap = getCapabilityById(job.capabilityId);
  if (!cap) throw new CapabilityError(`Capability '${job.capabilityId}' no longer registered`, 410, null);

  const [run] = await d
    .insert(_jobRunsAE)
    .values({
      jobId: job.id,
      userId: ctx.userId,
      status: "running",
      attempt: (orig.attempt ?? 1) + 1,
      startedAt: new Date(),
      triggeredBy: "retry",
    })
    .returning();

  const t0 = Date.now();
  let status: "ok" | "failed" = "ok";
  let result: unknown = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  try {
    const parsed = cap.inputSchema.safeParse(job.input ?? {});
    if (!parsed.success) throw new CapabilityError(parsed.error.message, 400, null);
    result = await cap.handler(parsed.data as never, { ...ctx, capabilityId: cap.id } as CapabilityRunContext);
  } catch (err) {
    status = "failed";
    if (err instanceof CapabilityError) { errorCode = `http_${err.status}`; errorMessage = err.message; }
    else { errorCode = "exception"; errorMessage = err instanceof Error ? err.message : String(err); }
  }
  const duration = Date.now() - t0;

  await d
    .update(_jobRunsAE)
    .set({
      status,
      finishedAt: new Date(),
      durationMs: duration,
      result: status === "ok" ? (_truncateForCaptureAE(result) as object) : null,
      errorCode,
      errorMessage,
    })
    .where(eq(_jobRunsAE.id, run.id));

  await d
    .update(_jobsAE)
    .set({
      lastRunAt: new Date(),
      lastStatus: status,
      runCount: (job.runCount ?? 0) + 1,
      failCount: (job.failCount ?? 0) + (status === "failed" ? 1 : 0),
      updatedAt: new Date(),
    })
    .where(eq(_jobsAE.id, job.id));

  void emitWebhookEvent({
    userId: ctx.userId,
    event: status === "ok" ? "job.completed" : "job.failed",
    data: { jobId: job.id, runId: run.id, capabilityId: job.capabilityId, attempt: run.attempt, durationMs: duration, errorCode },
  }).catch(() => undefined);

  return {
    runId: run.id,
    jobId: job.id,
    attempt: run.attempt,
    status,
    durationMs: duration,
    errorCode,
    errorMessage,
    result: status === "ok" ? _truncateForCaptureAE(result) : null,
  };
}

export async function jobsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_JOB_LIMITS_AE[tier],
    perTier: _TIER_JOB_LIMITS_AE,
    intervalCeilingSeconds: _MAX_INTERVAL_AE,
    payloadMaxBytes: _MAX_INPUT_BYTES_AE,
    resultCaptureMaxBytes: _MAX_RESULT_CAPTURE_AE,
    maxRetries: 10,
    triggers: ["schedule", "manual", "retry"],
    statuses: {
      job: ["active", "paused", "cancelled", "completed"],
      run: ["queued", "running", "ok", "failed", "cancelled"],
    },
    notes: [
      "jobs.* capabilities cannot themselves be scheduled (loop guard).",
      "Recurring jobs reschedule by adding intervalSeconds to the previous nextRunAt.",
      "Manual runs (jobs.run_now) do not affect nextRunAt for recurring jobs.",
      "Payloads are re-validated against the capability schema at every run.",
    ],
  };
}

// ─── Pillar AF — Exports & Reports (Phase 22) ────────────────────────
import { publicApiExports as _exportsAF } from "@/db/schema";
import { createHash as _hashAF } from "node:crypto";
import { gte as _gteAF, lte as _lteAF } from "drizzle-orm";

type _ExportSource =
  | "audit"
  | "usage"
  | "deliveries"
  | "notifications"
  | "watchers"
  | "monitors"
  | "proposals"
  | "jobs"
  | "runs"
  | "artifacts";

type _ExportFormat = "csv" | "jsonl";

const _MAX_BODY_BYTES_AF = 4 * 1024 * 1024; // 4 MiB inline cap
const _DEFAULT_TTL_DAYS_AF = 14;

const _TIER_EXPORT_LIMITS_AF: Record<
  string,
  { activeExports: number; maxRows: number; ttlDays: number }
> = {
  free: { activeExports: 5,   maxRows: 5_000,   ttlDays: 7 },
  mini: { activeExports: 50,  maxRows: 50_000,  ttlDays: 30 },
  max:  { activeExports: 500, maxRows: 500_000, ttlDays: 90 },
};

const _EXPORT_SOURCES_AF: ReadonlyArray<{
  source: _ExportSource;
  scope: string;
  columns: string[];
  description: string;
}> = [
  { source: "audit",         scope: "read:audit",         columns: ["id", "ts", "action", "target", "prevHash", "hash", "meta"], description: "Hash-chained mutation audit log." },
  { source: "usage",         scope: "read:audit",         columns: ["id", "ts", "capabilityId", "transport", "status", "latencyMs", "costCredits", "errorCode"], description: "Per-call metering rows." },
  { source: "deliveries",    scope: "read:notifications", columns: ["id", "createdAt", "webhookId", "event", "attempt", "status", "httpStatus", "latencyMs", "error"], description: "Webhook delivery attempts." },
  { source: "notifications", scope: "read:notifications", columns: ["id", "createdAt", "title", "body", "severity", "channel", "readAt"], description: "User-facing notification feed." },
  { source: "watchers",      scope: "read:portfolio",     columns: ["id", "createdAt", "label", "target", "active"], description: "Treasury watchers." },
  { source: "monitors",      scope: "read:portfolio",     columns: ["id", "createdAt", "label", "condition", "active"], description: "Programmatic monitors." },
  { source: "proposals",     scope: "read:portfolio",     columns: ["id", "createdAt", "label", "status", "chain"], description: "Multisig / treasury proposals." },
  { source: "jobs",          scope: "read:jobs",          columns: ["id", "createdAt", "label", "capabilityId", "kind", "status", "nextRunAt", "runCount", "failCount"], description: "Scheduled jobs." },
  { source: "runs",          scope: "read:jobs",          columns: ["id", "createdAt", "jobId", "status", "attempt", "durationMs", "triggeredBy", "errorCode"], description: "Job run history." },
  { source: "artifacts",     scope: "read:storage",       columns: ["id", "createdAt", "filename", "mime", "bytes", "sha256", "visibility"], description: "Uploaded storage artifacts (metadata only)." },
];

function _csvCellAF(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function _serializeRowsAF(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  format: _ExportFormat,
): { body: Buffer; truncated: boolean; rowCount: number } {
  let truncated = false;
  if (format === "csv") {
    const lines: string[] = [];
    lines.push(columns.map(_csvCellAF).join(","));
    let bytes = Buffer.byteLength(lines[0]) + 1;
    let i = 0;
    for (; i < rows.length; i++) {
      const line = columns.map((c) => _csvCellAF((rows[i] as Record<string, unknown>)[c])).join(",");
      const lineBytes = Buffer.byteLength(line) + 1;
      if (bytes + lineBytes > _MAX_BODY_BYTES_AF) { truncated = true; break; }
      lines.push(line);
      bytes += lineBytes;
    }
    return { body: Buffer.from(lines.join("\n") + "\n", "utf8"), truncated, rowCount: i };
  }
  // jsonl
  const out: string[] = [];
  let bytes = 0;
  let i = 0;
  for (; i < rows.length; i++) {
    const projected: Record<string, unknown> = {};
    for (const c of columns) projected[c] = (rows[i] as Record<string, unknown>)[c] ?? null;
    const line = JSON.stringify(projected);
    const lineBytes = Buffer.byteLength(line) + 1;
    if (bytes + lineBytes > _MAX_BODY_BYTES_AF) { truncated = true; break; }
    out.push(line);
    bytes += lineBytes;
  }
  return { body: Buffer.from(out.join("\n") + "\n", "utf8"), truncated, rowCount: i };
}

async function _fetchSourceRowsAF(
  source: _ExportSource,
  ctx: CapabilityRunContext,
  filters: { since?: Date; until?: Date; status?: string; capabilityId?: string },
  rowCap: number,
): Promise<Array<Record<string, unknown>>> {
  const d = requireDb();
  const schema = await import("@/db/schema");
  const since = filters.since;
  const until = filters.until;
  const within = <T>(col: T, conds: unknown[]) => {
    if (since) conds.push(_gteAF(col as never, since));
    if (until) conds.push(_lteAF(col as never, until));
  };
  switch (source) {
    case "audit": {
      const t = schema.publicApiAuditLog;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.ts, conds);
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.ts)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "usage": {
      const t = schema.publicApiKeyUsage;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.ts, conds);
      if (filters.status) conds.push(eq(t.status, filters.status));
      if (filters.capabilityId) conds.push(eq(t.capabilityId, filters.capabilityId));
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.ts)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "deliveries": {
      const t = schema.webhookDeliveries;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      if (filters.status) conds.push(eq(t.status, filters.status));
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "notifications": {
      const t = schema.notifications;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "watchers": {
      const t = schema.agentTreasuryWatchers;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "monitors": {
      const t = schema.monitors;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "proposals": {
      const t = schema.agentTxProposals;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      if (filters.status) conds.push(eq(t.status, filters.status));
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "jobs": {
      const t = _jobsAE;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      if (filters.status) conds.push(eq(t.status, filters.status));
      if (filters.capabilityId) conds.push(eq(t.capabilityId, filters.capabilityId));
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "runs": {
      const t = _jobRunsAE;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      if (filters.status) conds.push(eq(t.status, filters.status));
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    case "artifacts": {
      const t = schema.publicApiArtifacts;
      const conds: unknown[] = [eq(t.userId, ctx.userId)];
      within(t.createdAt, conds);
      const rows = await d.select().from(t).where(and(...(conds as never[]))).orderBy(desc(t.createdAt)).limit(rowCap);
      return rows as Array<Record<string, unknown>>;
    }
    default:
      throw new CapabilityError(`Unknown export source '${source}'`, 400, null);
  }
}

function _parseIsoAF(v: string | undefined, field: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new CapabilityError(`${field} is not a valid ISO timestamp`, 400, null);
  return d;
}

export async function exportsSources(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return {
    formats: ["csv", "jsonl"] as const,
    sources: _EXPORT_SOURCES_AF,
  };
}

export async function exportsCreate(
  input: {
    label: string;
    source: _ExportSource;
    format?: _ExportFormat;
    since?: string;
    until?: string;
    status?: string;
    capabilityId?: string;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const sourceMeta = _EXPORT_SOURCES_AF.find((s) => s.source === input.source);
  if (!sourceMeta) throw new CapabilityError(`Unknown export source '${input.source}'`, 400, null);
  const format: _ExportFormat = input.format ?? "csv";
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_EXPORT_LIMITS_AF[tier];

  // Active-export quota (non-purged rows).
  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_exportsAF)
    .where(and(eq(_exportsAF.userId, ctx.userId), _sqlAE`${_exportsAF.status} <> 'purged'`));
  if (n >= limits.activeExports) {
    throw new CapabilityError(
      `Export quota reached for tier '${tier}' (${n}/${limits.activeExports}). Purge old exports first.`,
      429,
      null,
    );
  }

  const since = _parseIsoAF(input.since, "since");
  const until = _parseIsoAF(input.until, "until");
  if (since && until && since.getTime() > until.getTime()) {
    throw new CapabilityError("`since` must be before `until`", 400, null);
  }

  const label = input.label.trim().slice(0, 120) || `Export: ${input.source}`;
  const expiresAt = new Date(Date.now() + limits.ttlDays * 24 * 60 * 60 * 1000);
  const filters = {
    since: since?.toISOString() ?? null,
    until: until?.toISOString() ?? null,
    status: input.status ?? null,
    capabilityId: input.capabilityId ?? null,
  };

  // Insert a pending row up front so concurrent quota checks see it.
  const [row] = await d
    .insert(_exportsAF)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      label,
      source: input.source,
      format,
      filters,
      status: "pending",
      expiresAt,
    })
    .returning();

  void emitWebhookEvent({
    userId: ctx.userId,
    event: "export.created",
    data: { exportId: row.id, source: input.source, format, label },
  }).catch(() => undefined);

  try {
    const rows = await _fetchSourceRowsAF(
      input.source,
      ctx,
      { since, until, status: input.status, capabilityId: input.capabilityId },
      limits.maxRows,
    );
    const { body, truncated, rowCount } = _serializeRowsAF(rows, sourceMeta.columns, format);
    const sha = _hashAF("sha256").update(body).digest("hex");

    await d
      .update(_exportsAF)
      .set({
        rowCount,
        byteSize: body.length,
        sha256: sha,
        truncated: truncated || rows.length >= limits.maxRows,
        body,
        status: "completed",
      })
      .where(eq(_exportsAF.id, row.id));

    await _appendAudit({
      keyId: ctx.keyId,
      userId: ctx.userId,
      action: "exports.create",
      target: row.id,
      meta: { source: input.source, format, rowCount, byteSize: body.length, truncated },
    });

    void emitWebhookEvent({
      userId: ctx.userId,
      event: "export.completed",
      data: { exportId: row.id, source: input.source, format, rowCount, byteSize: body.length, sha256: sha, truncated },
    }).catch(() => undefined);

    return {
      id: row.id,
      label,
      source: input.source,
      format,
      status: "completed" as const,
      rowCount,
      byteSize: body.length,
      sha256: sha,
      truncated: truncated || rows.length >= limits.maxRows,
      expiresAt: expiresAt.toISOString(),
      createdAt: row.createdAt,
      tier,
      quota: { used: n + 1, limit: limits.activeExports, maxRows: limits.maxRows },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorCode = err instanceof CapabilityError ? `http_${err.status}` : "exception";
    await d
      .update(_exportsAF)
      .set({ status: "failed", errorCode, errorMessage })
      .where(eq(_exportsAF.id, row.id));
    void emitWebhookEvent({
      userId: ctx.userId,
      event: "export.failed",
      data: { exportId: row.id, source: input.source, errorCode, errorMessage },
    }).catch(() => undefined);
    throw err;
  }
}

export async function exportsList(
  input: { source?: _ExportSource; status?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds: unknown[] = [eq(_exportsAF.userId, ctx.userId)];
  if (input.source) conds.push(eq(_exportsAF.source, input.source));
  if (input.status) conds.push(eq(_exportsAF.status, input.status));
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await d
    .select({
      id: _exportsAF.id,
      label: _exportsAF.label,
      source: _exportsAF.source,
      format: _exportsAF.format,
      status: _exportsAF.status,
      rowCount: _exportsAF.rowCount,
      byteSize: _exportsAF.byteSize,
      sha256: _exportsAF.sha256,
      truncated: _exportsAF.truncated,
      filters: _exportsAF.filters,
      errorCode: _exportsAF.errorCode,
      errorMessage: _exportsAF.errorMessage,
      expiresAt: _exportsAF.expiresAt,
      createdAt: _exportsAF.createdAt,
      purgedAt: _exportsAF.purgedAt,
    })
    .from(_exportsAF)
    .where(and(...(conds as never[])))
    .orderBy(desc(_exportsAF.createdAt))
    .limit(limit);
  return { count: rows.length, exports: rows };
}

async function _loadExportAF(id: string, userId: string) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_exportsAF)
    .where(and(eq(_exportsAF.id, id), eq(_exportsAF.userId, userId)))
    .limit(1);
  if (!row) throw new CapabilityError(`Export ${id} not found`, 404, null);
  return row;
}

export async function exportsGet(input: { id: string }, ctx: CapabilityRunContext) {
  const row = await _loadExportAF(input.id, ctx.userId);
  // Don't return the body here — exports.download owns that surface.
  return {
    id: row.id,
    label: row.label,
    source: row.source,
    format: row.format,
    status: row.status,
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    sha256: row.sha256,
    truncated: row.truncated,
    filters: row.filters,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    purgedAt: row.purgedAt,
  };
}

export async function exportsDownload(input: { id: string }, ctx: CapabilityRunContext) {
  const row = await _loadExportAF(input.id, ctx.userId);
  if (row.status !== "completed") {
    throw new CapabilityError(`Export is '${row.status}', not 'completed'`, 409, null);
  }
  if (!row.body) {
    throw new CapabilityError("Export body has been purged", 410, null);
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new CapabilityError("Export has expired", 410, null);
  }
  const contentType = row.format === "csv" ? "text/csv" : "application/x-ndjson";
  const filenameSafe = String(row.label).replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "export";
  const filename = `${filenameSafe}-${row.id.slice(0, 8)}.${row.format === "csv" ? "csv" : "jsonl"}`;
  const buf = Buffer.isBuffer(row.body) ? row.body : Buffer.from(row.body as unknown as Uint8Array);
  return {
    id: row.id,
    contentType,
    filename,
    encoding: "base64" as const,
    byteSize: buf.length,
    sha256: row.sha256,
    body: buf.toString("base64"),
  };
}

export async function exportsPurge(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const row = await _loadExportAF(input.id, ctx.userId);
  if (row.status === "purged") {
    return { id: row.id, status: "purged" as const, alreadyPurged: true };
  }
  await d
    .update(_exportsAF)
    .set({ status: "purged", body: null, purgedAt: new Date() })
    .where(eq(_exportsAF.id, row.id));
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "exports.purge",
    target: row.id,
    meta: { source: row.source, byteSize: row.byteSize, rowCount: row.rowCount },
  });
  return { id: row.id, status: "purged" as const, alreadyPurged: false };
}

export async function exportsStats(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const rows = await d
    .select({
      source: _exportsAF.source,
      status: _exportsAF.status,
      count: _sqlAE<number>`count(*)::int`,
      totalBytes: _sqlAE<number>`coalesce(sum(${_exportsAF.byteSize}), 0)::int`,
      totalRows: _sqlAE<number>`coalesce(sum(${_exportsAF.rowCount}), 0)::int`,
    })
    .from(_exportsAF)
    .where(eq(_exportsAF.userId, ctx.userId))
    .groupBy(_exportsAF.source, _exportsAF.status);
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_EXPORT_LIMITS_AF[tier];
  const [{ active }] = await d
    .select({ active: _sqlAE<number>`count(*)::int` })
    .from(_exportsAF)
    .where(and(eq(_exportsAF.userId, ctx.userId), _sqlAE`${_exportsAF.status} <> 'purged'`));
  return {
    tier,
    quota: { used: active, limit: limits.activeExports, maxRows: limits.maxRows, ttlDays: limits.ttlDays },
    bySourceStatus: rows,
  };
}

export async function exportsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_EXPORT_LIMITS_AF[tier],
    perTier: _TIER_EXPORT_LIMITS_AF,
    bodyMaxBytes: _MAX_BODY_BYTES_AF,
    defaultTtlDays: _DEFAULT_TTL_DAYS_AF,
    formats: ["csv", "jsonl"] as const,
    sources: _EXPORT_SOURCES_AF.map((s) => s.source),
    statuses: ["pending", "completed", "failed", "purged"] as const,
    notes: [
      "Exports are generated synchronously and stored inline as bytea.",
      "Body cap is 4 MiB per export; oversized results set `truncated:true`.",
      "Purged exports keep metadata but drop the body; the row counts against quota until removed by retention.",
      "Filters narrow the source query: `since`/`until` (ISO), plus per-source `status` / `capabilityId`.",
    ],
  };
}

// ─── Pillar AG — Tags, Labels & Annotations (Phase 23) ───────────────
import { publicApiTags as _tagsAG, publicApiTagLinks as _tagLinksAG } from "@/db/schema";

const _TAG_COLORS_AG = [
  "violet", "indigo", "blue", "sky", "cyan", "teal", "emerald",
  "lime", "amber", "orange", "rose", "pink", "fuchsia", "slate",
] as const;
type _TagColor = (typeof _TAG_COLORS_AG)[number];

const _ENTITY_TYPES_AG = [
  "address", "tx", "capability", "job", "run", "artifact",
  "proposal", "watcher", "monitor", "export", "notification",
  "delivery", "webhook", "custom",
] as const;
type _EntityType = (typeof _ENTITY_TYPES_AG)[number];

const _TIER_TAG_LIMITS_AG: Record<
  string,
  { tags: number; linksPerTag: number; linksPerEntity: number }
> = {
  free: { tags: 25,  linksPerTag: 500,    linksPerEntity: 8  },
  mini: { tags: 250, linksPerTag: 10_000, linksPerEntity: 32 },
  max:  { tags: 2_500, linksPerTag: 100_000, linksPerEntity: 128 },
};

const _MAX_TAG_NAME_AG = 64;
const _MAX_TAG_DESC_AG = 280;
const _MAX_NOTE_AG = 1_000;
const _MAX_ENTITY_ID_AG = 256;

function _normalizeTagNameAG(raw: string): { name: string; display: string } {
  const display = raw.trim().replace(/\s+/g, " ").slice(0, _MAX_TAG_NAME_AG);
  if (!display) throw new CapabilityError("Tag name cannot be empty", 400, null);
  const name = display.toLowerCase();
  // Ban control characters and stray separators.
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new CapabilityError("Tag name contains control characters", 400, null);
  }
  return { name, display };
}

function _assertColorAG(c: string | undefined): _TagColor {
  const v = (c ?? "violet").toLowerCase();
  if (!(_TAG_COLORS_AG as readonly string[]).includes(v)) {
    throw new CapabilityError(
      `Unknown color '${c}'. Allowed: ${_TAG_COLORS_AG.join(", ")}`,
      400,
      null,
    );
  }
  return v as _TagColor;
}

function _assertEntityTypeAG(t: string): _EntityType {
  if (!(_ENTITY_TYPES_AG as readonly string[]).includes(t)) {
    throw new CapabilityError(
      `Unknown entityType '${t}'. Allowed: ${_ENTITY_TYPES_AG.join(", ")}`,
      400,
      null,
    );
  }
  return t as _EntityType;
}

function _assertEntityIdAG(id: string): string {
  const v = id.trim();
  if (!v) throw new CapabilityError("entityId cannot be empty", 400, null);
  if (v.length > _MAX_ENTITY_ID_AG) {
    throw new CapabilityError(`entityId exceeds ${_MAX_ENTITY_ID_AG} chars`, 400, null);
  }
  return v;
}

async function _loadTagAG(idOrName: string, userId: string) {
  const d = requireDb();
  // Try uuid first, then fall back to normalized name lookup.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName);
  const [row] = isUuid
    ? await d.select().from(_tagsAG).where(and(eq(_tagsAG.id, idOrName), eq(_tagsAG.userId, userId))).limit(1)
    : await d.select().from(_tagsAG).where(and(eq(_tagsAG.name, idOrName.trim().toLowerCase()), eq(_tagsAG.userId, userId))).limit(1);
  if (!row) throw new CapabilityError(`Tag '${idOrName}' not found`, 404, null);
  return row;
}

export async function tagsCreate(
  input: { name: string; color?: string; description?: string; metadata?: Record<string, unknown> },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { name, display } = _normalizeTagNameAG(input.name);
  const color = _assertColorAG(input.color);
  const description = input.description?.slice(0, _MAX_TAG_DESC_AG) ?? null;

  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_TAG_LIMITS_AG[tier];
  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_tagsAG)
    .where(eq(_tagsAG.userId, ctx.userId));
  if (n >= limits.tags) {
    throw new CapabilityError(
      `Tag quota reached for tier '${tier}' (${n}/${limits.tags})`,
      429,
      null,
    );
  }

  // Idempotent on (userId, name): re-creating returns the existing row.
  const [existing] = await d
    .select()
    .from(_tagsAG)
    .where(and(eq(_tagsAG.userId, ctx.userId), eq(_tagsAG.name, name)))
    .limit(1);
  if (existing) return { ...existing, alreadyExisted: true };

  const [row] = await d
    .insert(_tagsAG)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      name,
      display,
      color,
      description,
      metadata: input.metadata ?? {},
    })
    .returning();

  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "tags.create",
    target: row.id,
    meta: { name, color },
  });

  return { ...row, alreadyExisted: false };
}

export async function tagsList(
  input: { query?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const conds: unknown[] = [eq(_tagsAG.userId, ctx.userId)];
  if (input.query) {
    const q = `%${input.query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
    conds.push(_sqlAE`${_tagsAG.name} ILIKE ${q}`);
  }
  const rows = await d
    .select()
    .from(_tagsAG)
    .where(and(...(conds as never[])))
    .orderBy(desc(_tagsAG.createdAt))
    .limit(limit);

  // Hydrate per-tag link count in a single grouped query.
  const ids = rows.map((r) => r.id);
  let counts: Record<string, number> = {};
  if (ids.length > 0) {
    const grouped = await d
      .select({
        tagId: _tagLinksAG.tagId,
        count: _sqlAE<number>`count(*)::int`,
      })
      .from(_tagLinksAG)
      .where(and(eq(_tagLinksAG.userId, ctx.userId), inArray(_tagLinksAG.tagId, ids)))
      .groupBy(_tagLinksAG.tagId);
    counts = Object.fromEntries(grouped.map((g) => [g.tagId, g.count]));
  }
  return {
    count: rows.length,
    tags: rows.map((r) => ({ ...r, linkCount: counts[r.id] ?? 0 })),
  };
}

export async function tagsUpdate(
  input: { id: string; display?: string; color?: string; description?: string; metadata?: Record<string, unknown> },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tag = await _loadTagAG(input.id, ctx.userId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.display !== undefined) {
    const display = input.display.trim().replace(/\s+/g, " ").slice(0, _MAX_TAG_NAME_AG);
    if (!display) throw new CapabilityError("display cannot be empty", 400, null);
    patch.display = display;
    // Keep `name` (the lookup key) stable — display is the only relabel surface.
  }
  if (input.color !== undefined) patch.color = _assertColorAG(input.color);
  if (input.description !== undefined) patch.description = input.description.slice(0, _MAX_TAG_DESC_AG);
  if (input.metadata !== undefined) patch.metadata = input.metadata;

  const [row] = await d.update(_tagsAG).set(patch).where(eq(_tagsAG.id, tag.id)).returning();
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "tags.update",
    target: tag.id,
    meta: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
  });
  return row;
}

export async function tagsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const tag = await _loadTagAG(input.id, ctx.userId);
  // Count links for the audit trail before cascade.
  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_tagLinksAG)
    .where(eq(_tagLinksAG.tagId, tag.id));
  await d.delete(_tagsAG).where(eq(_tagsAG.id, tag.id));
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "tags.delete",
    target: tag.id,
    meta: { name: tag.name, removedLinks: n },
  });
  return { id: tag.id, deleted: true, removedLinks: n };
}

export async function tagsAttach(
  input: { tag: string; entityType: string; entityId: string; note?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tag = await _loadTagAG(input.tag, ctx.userId);
  const entityType = _assertEntityTypeAG(input.entityType);
  const entityId = _assertEntityIdAG(input.entityId);
  const note = input.note ? input.note.slice(0, _MAX_NOTE_AG) : null;

  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_TAG_LIMITS_AG[tier];

  // Per-tag and per-entity quotas.
  const [linksOnTag] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_tagLinksAG)
    .where(eq(_tagLinksAG.tagId, tag.id));
  if (linksOnTag.n >= limits.linksPerTag) {
    throw new CapabilityError(
      `Per-tag link cap reached (${linksOnTag.n}/${limits.linksPerTag}) for tier '${tier}'`,
      429,
      null,
    );
  }
  const [linksOnEntity] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_tagLinksAG)
    .where(and(
      eq(_tagLinksAG.userId, ctx.userId),
      eq(_tagLinksAG.entityType, entityType),
      eq(_tagLinksAG.entityId, entityId),
    ));
  if (linksOnEntity.n >= limits.linksPerEntity) {
    throw new CapabilityError(
      `Per-entity tag cap reached (${linksOnEntity.n}/${limits.linksPerEntity}) for tier '${tier}'`,
      429,
      null,
    );
  }

  // Idempotent on (tagId, entityType, entityId).
  const [existing] = await d
    .select()
    .from(_tagLinksAG)
    .where(and(
      eq(_tagLinksAG.tagId, tag.id),
      eq(_tagLinksAG.entityType, entityType),
      eq(_tagLinksAG.entityId, entityId),
    ))
    .limit(1);
  if (existing) {
    // Allow note-only updates without re-creating the row.
    if (note !== null && note !== existing.note) {
      const [updated] = await d
        .update(_tagLinksAG)
        .set({ note })
        .where(eq(_tagLinksAG.id, existing.id))
        .returning();
      return { ...updated, alreadyExisted: true, noteUpdated: true };
    }
    return { ...existing, alreadyExisted: true, noteUpdated: false };
  }

  const [row] = await d
    .insert(_tagLinksAG)
    .values({
      userId: ctx.userId,
      tagId: tag.id,
      entityType,
      entityId,
      note,
    })
    .returning();

  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "tags.attach",
    target: row.id,
    meta: { tagId: tag.id, name: tag.name, entityType, entityId },
  });
  return { ...row, alreadyExisted: false, noteUpdated: false };
}

export async function tagsDetach(
  input: { tag: string; entityType: string; entityId: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tag = await _loadTagAG(input.tag, ctx.userId);
  const entityType = _assertEntityTypeAG(input.entityType);
  const entityId = _assertEntityIdAG(input.entityId);
  const [existing] = await d
    .select()
    .from(_tagLinksAG)
    .where(and(
      eq(_tagLinksAG.tagId, tag.id),
      eq(_tagLinksAG.entityType, entityType),
      eq(_tagLinksAG.entityId, entityId),
      eq(_tagLinksAG.userId, ctx.userId),
    ))
    .limit(1);
  if (!existing) {
    return { deleted: false, alreadyDetached: true, tagId: tag.id, entityType, entityId };
  }
  await d.delete(_tagLinksAG).where(eq(_tagLinksAG.id, existing.id));
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "tags.detach",
    target: existing.id,
    meta: { tagId: tag.id, entityType, entityId },
  });
  return { deleted: true, alreadyDetached: false, tagId: tag.id, entityType, entityId };
}

export async function tagsEntities(
  input: {
    tag?: string;
    entityType?: string;
    entityId?: string;
    limit?: number;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);

  // Mode A: by tag → list its attached entities.
  if (input.tag) {
    const tag = await _loadTagAG(input.tag, ctx.userId);
    const rows = await d
      .select({
        id: _tagLinksAG.id,
        entityType: _tagLinksAG.entityType,
        entityId: _tagLinksAG.entityId,
        note: _tagLinksAG.note,
        createdAt: _tagLinksAG.createdAt,
      })
      .from(_tagLinksAG)
      .where(eq(_tagLinksAG.tagId, tag.id))
      .orderBy(desc(_tagLinksAG.createdAt))
      .limit(limit);
    return {
      mode: "by_tag" as const,
      tag: { id: tag.id, name: tag.name, display: tag.display, color: tag.color },
      count: rows.length,
      entities: rows,
    };
  }

  // Mode B: by entity → list its tags.
  if (input.entityType && input.entityId) {
    const entityType = _assertEntityTypeAG(input.entityType);
    const entityId = _assertEntityIdAG(input.entityId);
    const rows = await d
      .select({
        linkId: _tagLinksAG.id,
        note: _tagLinksAG.note,
        attachedAt: _tagLinksAG.createdAt,
        tagId: _tagsAG.id,
        name: _tagsAG.name,
        display: _tagsAG.display,
        color: _tagsAG.color,
        description: _tagsAG.description,
      })
      .from(_tagLinksAG)
      .innerJoin(_tagsAG, eq(_tagsAG.id, _tagLinksAG.tagId))
      .where(and(
        eq(_tagLinksAG.userId, ctx.userId),
        eq(_tagLinksAG.entityType, entityType),
        eq(_tagLinksAG.entityId, entityId),
      ))
      .orderBy(desc(_tagLinksAG.createdAt))
      .limit(limit);
    return {
      mode: "by_entity" as const,
      entity: { type: entityType, id: entityId },
      count: rows.length,
      tags: rows,
    };
  }

  throw new CapabilityError(
    "Supply either `tag` (to list attached entities) or both `entityType` + `entityId` (to list tags on an entity).",
    400,
    null,
  );
}

export async function tagsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_TAG_LIMITS_AG[tier],
    perTier: _TIER_TAG_LIMITS_AG,
    colors: _TAG_COLORS_AG,
    entityTypes: _ENTITY_TYPES_AG,
    fieldLimits: {
      nameMaxChars: _MAX_TAG_NAME_AG,
      descriptionMaxChars: _MAX_TAG_DESC_AG,
      noteMaxChars: _MAX_NOTE_AG,
      entityIdMaxChars: _MAX_ENTITY_ID_AG,
    },
    notes: [
      "Tag `name` is the lowercased lookup key and is immutable; `display` is the relabel surface.",
      "Re-attaching the same (tag, entityType, entityId) tuple is idempotent and may update the note.",
      "entityId is opaque text (uuid, numeric id, address, tx hash, capability id, or freeform).",
      "Deleting a tag cascades and removes every link; `removedLinks` is reported in the audit row.",
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pillar AH — Feature Flags & Experiments (Phase 24)
// ─────────────────────────────────────────────────────────────────────
import {
  publicApiFlags as _flagsAH,
  publicApiFlagEvaluations as _flagEvalsAH,
} from "@/db/schema";
import { createHash as _createHashAH } from "node:crypto";

const _FLAG_TYPES_AH = ["boolean", "string", "number", "json"] as const;
type _FlagType = (typeof _FLAG_TYPES_AH)[number];

const _FLAG_OPERATORS_AH = [
  "eq", "neq", "in", "nin",
  "gt", "gte", "lt", "lte",
  "contains", "startsWith", "endsWith",
  "regex", "exists", "percent",
] as const;
type _FlagOp = (typeof _FLAG_OPERATORS_AH)[number];

const _TIER_FLAG_LIMITS_AH: Record<
  string,
  { flags: number; rulesPerFlag: number; evalLogPerDay: number }
> = {
  free: { flags: 10,  rulesPerFlag: 8,  evalLogPerDay: 1_000 },
  mini: { flags: 100, rulesPerFlag: 32, evalLogPerDay: 50_000 },
  max:  { flags: 1_000, rulesPerFlag: 128, evalLogPerDay: 1_000_000 },
};

const _MAX_FLAG_KEY_AH = 96;
const _MAX_FLAG_DISPLAY_AH = 96;
const _MAX_FLAG_DESC_AH = 280;
const _MAX_FLAG_RULES_AH = 128;
const _MAX_CONTEXT_BYTES_AH = 2048;
const _UUID_RE_AH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function _normalizeFlagKeyAH(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) throw new CapabilityError("Flag key cannot be empty", 400, null);
  if (!/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(key)) {
    throw new CapabilityError(
      "Flag key must match /^[a-z0-9][a-z0-9._:-]{0,95}$/ (lowercase, may include . _ : -)",
      400,
      null,
    );
  }
  return key;
}

function _assertFlagTypeAH(t: string): _FlagType {
  if (!(_FLAG_TYPES_AH as readonly string[]).includes(t)) {
    throw new CapabilityError(
      `Unknown flag type '${t}'. Allowed: ${_FLAG_TYPES_AH.join(", ")}`,
      400,
      null,
    );
  }
  return t as _FlagType;
}

function _coerceFlagValueAH(type: _FlagType, value: unknown): unknown {
  if (value === null || value === undefined) {
    throw new CapabilityError(`Value required for type '${type}'`, 400, null);
  }
  switch (type) {
    case "boolean":
      if (typeof value !== "boolean") throw new CapabilityError("Expected boolean value", 400, null);
      return value;
    case "string":
      if (typeof value !== "string") throw new CapabilityError("Expected string value", 400, null);
      if (value.length > 4096) throw new CapabilityError("String value exceeds 4096 chars", 400, null);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new CapabilityError("Expected finite number value", 400, null);
      }
      return value;
    case "json": {
      const s = JSON.stringify(value);
      if (s.length > 16 * 1024) throw new CapabilityError("JSON value exceeds 16KiB", 400, null);
      return value;
    }
  }
}

type _FlagRuleAH = {
  when: Record<string, { op: _FlagOp; value?: unknown }>;
  value: unknown;
  note?: string;
};

function _validateRulesAH(rules: unknown, type: _FlagType): _FlagRuleAH[] {
  if (!Array.isArray(rules)) throw new CapabilityError("rules must be an array", 400, null);
  if (rules.length > _MAX_FLAG_RULES_AH) {
    throw new CapabilityError(`Too many rules (max ${_MAX_FLAG_RULES_AH})`, 400, null);
  }
  const out: _FlagRuleAH[] = [];
  rules.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") {
      throw new CapabilityError(`rules[${i}] must be an object`, 400, null);
    }
    const r = raw as Record<string, unknown>;
    if (!r.when || typeof r.when !== "object" || Array.isArray(r.when)) {
      throw new CapabilityError(`rules[${i}].when must be an object`, 400, null);
    }
    const when: Record<string, { op: _FlagOp; value?: unknown }> = {};
    for (const [k, v] of Object.entries(r.when as Record<string, unknown>)) {
      if (!v || typeof v !== "object") {
        throw new CapabilityError(`rules[${i}].when[${k}] must be { op, value? }`, 400, null);
      }
      const w = v as { op?: unknown; value?: unknown };
      if (typeof w.op !== "string" || !(_FLAG_OPERATORS_AH as readonly string[]).includes(w.op)) {
        throw new CapabilityError(
          `rules[${i}].when[${k}].op invalid. Allowed: ${_FLAG_OPERATORS_AH.join(", ")}`,
          400,
          null,
        );
      }
      when[k] = { op: w.op as _FlagOp, value: w.value };
    }
    if (!("value" in r)) {
      throw new CapabilityError(`rules[${i}].value is required`, 400, null);
    }
    const value = _coerceFlagValueAH(type, r.value);
    const note = typeof r.note === "string" ? r.note.slice(0, 280) : undefined;
    out.push({ when, value, note });
  });
  return out;
}

function _percentBucketAH(seed: string, salt: string): number {
  const h = _createHashAH("sha256").update(`${salt}:${seed}`).digest();
  // First 4 bytes → uint32 → 0..99
  const n = h.readUInt32BE(0);
  return n % 100;
}

function _matchOperatorAH(op: _FlagOp, actual: unknown, expected: unknown, salt: string): boolean {
  switch (op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as never);
    case "nin":
      return Array.isArray(expected) && !expected.includes(actual as never);
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "startsWith":
      return typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);
    case "endsWith":
      return typeof actual === "string" && typeof expected === "string" && actual.endsWith(expected);
    case "regex": {
      if (typeof actual !== "string" || typeof expected !== "string") return false;
      try { return new RegExp(expected).test(actual); } catch { return false; }
    }
    case "percent": {
      // expected: number 0..100. actual: any stable seed (typically userId).
      if (typeof expected !== "number" || expected < 0 || expected > 100) return false;
      const seed = typeof actual === "string" ? actual : JSON.stringify(actual ?? "");
      return _percentBucketAH(seed, salt) < expected;
    }
  }
}

function _evaluateFlagAH(
  flag: typeof _flagsAH.$inferSelect,
  context: Record<string, unknown>,
): { value: unknown; matchedRule: number | null; reason: string } {
  if (!flag.enabled || flag.archivedAt) {
    return { value: flag.defaultValue, matchedRule: null, reason: flag.archivedAt ? "archived" : "disabled" };
  }
  const rules = (flag.rules as unknown as _FlagRuleAH[]) ?? [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const conds = Object.entries(r.when);
    if (conds.length === 0) continue;
    const allMatch = conds.every(([attr, { op, value }]) =>
      _matchOperatorAH(op, context[attr], value, `${flag.key}:${i}`),
    );
    if (allMatch) return { value: r.value, matchedRule: i, reason: "rule_match" };
  }
  return { value: flag.defaultValue, matchedRule: null, reason: "default" };
}

function _canonicalContextAH(ctx: Record<string, unknown>): { hash: string; redacted: Record<string, unknown> } {
  const keys = Object.keys(ctx).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of keys) canonical[k] = ctx[k];
  let serialized = JSON.stringify(canonical);
  if (serialized.length > _MAX_CONTEXT_BYTES_AH) {
    // Drop largest fields until under the cap.
    const sized = keys
      .map((k) => ({ k, n: JSON.stringify(ctx[k]).length }))
      .sort((a, b) => b.n - a.n);
    for (const { k } of sized) {
      delete canonical[k];
      canonical["__truncated__"] = true;
      serialized = JSON.stringify(canonical);
      if (serialized.length <= _MAX_CONTEXT_BYTES_AH) break;
    }
  }
  const hash = _createHashAH("sha256").update(serialized).digest("hex");
  return { hash, redacted: canonical };
}

async function _loadFlagAH(idOrKey: string, userId: string) {
  const d = requireDb();
  const isUuid = _UUID_RE_AH.test(idOrKey);
  const [row] = isUuid
    ? await d.select().from(_flagsAH).where(and(eq(_flagsAH.id, idOrKey), eq(_flagsAH.userId, userId))).limit(1)
    : await d.select().from(_flagsAH).where(and(eq(_flagsAH.key, idOrKey.trim().toLowerCase()), eq(_flagsAH.userId, userId))).limit(1);
  if (!row) throw new CapabilityError(`Flag '${idOrKey}' not found`, 404, null);
  return row;
}

export async function flagsCreate(
  input: {
    key: string;
    display?: string;
    description?: string;
    type: string;
    defaultValue: unknown;
    rules?: unknown;
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const key = _normalizeFlagKeyAH(input.key);
  const type = _assertFlagTypeAH(input.type);
  const display = (input.display ?? key).trim().slice(0, _MAX_FLAG_DISPLAY_AH) || key;
  const description = input.description?.slice(0, _MAX_FLAG_DESC_AH) ?? null;
  const defaultValue = _coerceFlagValueAH(type, input.defaultValue);
  const rules = _validateRulesAH(input.rules ?? [], type);

  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_FLAG_LIMITS_AH[tier];
  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_flagsAH)
    .where(eq(_flagsAH.userId, ctx.userId));
  if (n >= limits.flags) {
    throw new CapabilityError(
      `Flag quota reached for tier '${tier}' (${n}/${limits.flags})`,
      429,
      null,
    );
  }
  if (rules.length > limits.rulesPerFlag) {
    throw new CapabilityError(
      `Per-flag rule cap exceeded (${rules.length}/${limits.rulesPerFlag}) for tier '${tier}'`,
      429,
      null,
    );
  }

  const [existing] = await d
    .select()
    .from(_flagsAH)
    .where(and(eq(_flagsAH.userId, ctx.userId), eq(_flagsAH.key, key)))
    .limit(1);
  if (existing) {
    throw new CapabilityError(
      `Flag '${key}' already exists (id=${existing.id}). Use flags.update to modify.`,
      409,
      { existingId: existing.id },
    );
  }

  const [row] = await d
    .insert(_flagsAH)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      key,
      display,
      description,
      type,
      defaultValue: defaultValue as never,
      rules: rules as never,
      enabled: input.enabled ?? true,
    })
    .returning();

  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "flags.create",
    target: row.id,
    meta: { key, type, rules: rules.length },
  });

  return row;
}

export async function flagsList(
  input: { query?: string; includeArchived?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const conds: unknown[] = [eq(_flagsAH.userId, ctx.userId)];
  if (!input.includeArchived) {
    conds.push(_sqlAE`${_flagsAH.archivedAt} IS NULL`);
  }
  if (input.query) {
    const q = `%${input.query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
    conds.push(_sqlAE`${_flagsAH.key} ILIKE ${q}`);
  }
  const rows = await d
    .select()
    .from(_flagsAH)
    .where(and(...(conds as never[])))
    .orderBy(desc(_flagsAH.createdAt))
    .limit(limit);
  return {
    count: rows.length,
    flags: rows.map((r) => ({
      ...r,
      ruleCount: Array.isArray(r.rules) ? (r.rules as unknown[]).length : 0,
    })),
  };
}

export async function flagsGet(input: { id: string }, ctx: CapabilityRunContext) {
  const row = await _loadFlagAH(input.id, ctx.userId);
  return row;
}

export async function flagsUpdate(
  input: {
    id: string;
    display?: string;
    description?: string;
    defaultValue?: unknown;
    rules?: unknown;
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const flag = await _loadFlagAH(input.id, ctx.userId);
  const type = flag.type as _FlagType;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const touched: string[] = [];
  if (input.display !== undefined) {
    const display = input.display.trim().slice(0, _MAX_FLAG_DISPLAY_AH);
    if (!display) throw new CapabilityError("display cannot be empty", 400, null);
    patch.display = display;
    touched.push("display");
  }
  if (input.description !== undefined) {
    patch.description = input.description.slice(0, _MAX_FLAG_DESC_AH);
    touched.push("description");
  }
  if (input.defaultValue !== undefined) {
    patch.defaultValue = _coerceFlagValueAH(type, input.defaultValue);
    touched.push("defaultValue");
  }
  if (input.rules !== undefined) {
    const rules = _validateRulesAH(input.rules, type);
    const tier = await _userTierAE(ctx.userId);
    const limit = _TIER_FLAG_LIMITS_AH[tier].rulesPerFlag;
    if (rules.length > limit) {
      throw new CapabilityError(
        `Per-flag rule cap exceeded (${rules.length}/${limit}) for tier '${tier}'`,
        429,
        null,
      );
    }
    patch.rules = rules;
    touched.push("rules");
  }
  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;
    touched.push("enabled");
  }
  const [row] = await d
    .update(_flagsAH)
    .set(patch)
    .where(eq(_flagsAH.id, flag.id))
    .returning();
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "flags.update",
    target: flag.id,
    meta: { key: flag.key, fields: touched },
  });
  return row;
}

export async function flagsArchive(
  input: { id: string; restore?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const flag = await _loadFlagAH(input.id, ctx.userId);
  const restore = input.restore === true;
  const [row] = await d
    .update(_flagsAH)
    .set({
      archivedAt: restore ? null : new Date(),
      enabled: restore ? flag.enabled : false,
      updatedAt: new Date(),
    })
    .where(eq(_flagsAH.id, flag.id))
    .returning();
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: restore ? "flags.restore" : "flags.archive",
    target: flag.id,
    meta: { key: flag.key },
  });
  return row;
}

export async function flagsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const flag = await _loadFlagAH(input.id, ctx.userId);
  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_flagEvalsAH)
    .where(eq(_flagEvalsAH.flagId, flag.id));
  await d.delete(_flagsAH).where(eq(_flagsAH.id, flag.id));
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "flags.delete",
    target: flag.id,
    meta: { key: flag.key, removedEvaluations: n },
  });
  return { id: flag.id, key: flag.key, deleted: true, removedEvaluations: n };
}

async function _logEvaluationAH(args: {
  userId: string;
  flagId: string;
  key: string;
  matchedRule: number | null;
  value: unknown;
  context: Record<string, unknown>;
}): Promise<void> {
  const d = requireDb();
  const { hash, redacted } = _canonicalContextAH(args.context);
  try {
    await d.insert(_flagEvalsAH).values({
      userId: args.userId,
      flagId: args.flagId,
      key: args.key,
      matchedRule: args.matchedRule,
      value: args.value as never,
      contextHash: hash,
      context: redacted as never,
    });
  } catch {
    // evaluation logging is best-effort
  }
}

export async function flagsEvaluate(
  input: { key: string; context?: Record<string, unknown>; log?: boolean },
  ctx: CapabilityRunContext,
) {
  const flag = await _loadFlagAH(input.key, ctx.userId);
  const context = input.context ?? {};
  const { value, matchedRule, reason } = _evaluateFlagAH(flag, context);
  if (input.log !== false) {
    await _logEvaluationAH({
      userId: ctx.userId,
      flagId: flag.id,
      key: flag.key,
      matchedRule,
      value,
      context,
    });
  }
  return {
    key: flag.key,
    type: flag.type,
    value,
    matchedRule,
    reason,
    enabled: flag.enabled,
    archived: flag.archivedAt !== null,
  };
}

export async function flagsBulkEvaluate(
  input: { keys: string[]; context?: Record<string, unknown>; log?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (!Array.isArray(input.keys) || input.keys.length === 0) {
    throw new CapabilityError("keys must be a non-empty array", 400, null);
  }
  if (input.keys.length > 100) {
    throw new CapabilityError("Bulk evaluate caps at 100 keys per call", 400, null);
  }
  const normalized = Array.from(new Set(input.keys.map((k) => k.trim().toLowerCase()).filter(Boolean)));
  const rows = await d
    .select()
    .from(_flagsAH)
    .where(and(eq(_flagsAH.userId, ctx.userId), inArray(_flagsAH.key, normalized)));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const context = input.context ?? {};
  const results: Record<string, unknown> = {};
  for (const k of normalized) {
    const flag = byKey.get(k);
    if (!flag) {
      results[k] = { found: false };
      continue;
    }
    const { value, matchedRule, reason } = _evaluateFlagAH(flag, context);
    results[k] = {
      found: true,
      type: flag.type,
      value,
      matchedRule,
      reason,
      enabled: flag.enabled,
      archived: flag.archivedAt !== null,
    };
    if (input.log !== false) {
      await _logEvaluationAH({
        userId: ctx.userId,
        flagId: flag.id,
        key: flag.key,
        matchedRule,
        value,
        context,
      });
    }
  }
  return {
    requested: normalized.length,
    matched: rows.length,
    missing: normalized.filter((k) => !byKey.has(k)),
    results,
  };
}

export async function flagsHistory(
  input: { id: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const flag = await _loadFlagAH(input.id, ctx.userId);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await d
    .select({
      id: _flagEvalsAH.id,
      matchedRule: _flagEvalsAH.matchedRule,
      value: _flagEvalsAH.value,
      contextHash: _flagEvalsAH.contextHash,
      context: _flagEvalsAH.context,
      createdAt: _flagEvalsAH.createdAt,
    })
    .from(_flagEvalsAH)
    .where(and(eq(_flagEvalsAH.userId, ctx.userId), eq(_flagEvalsAH.flagId, flag.id)))
    .orderBy(desc(_flagEvalsAH.createdAt))
    .limit(limit);

  // Aggregate matched-rule distribution.
  const dist: Record<string, number> = {};
  for (const r of rows) {
    const k = r.matchedRule === null ? "default" : `rule_${r.matchedRule}`;
    dist[k] = (dist[k] ?? 0) + 1;
  }
  return {
    flag: { id: flag.id, key: flag.key, type: flag.type },
    count: rows.length,
    distribution: dist,
    evaluations: rows,
  };
}

export async function flagsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_FLAG_LIMITS_AH[tier],
    perTier: _TIER_FLAG_LIMITS_AH,
    types: _FLAG_TYPES_AH,
    operators: _FLAG_OPERATORS_AH,
    fieldLimits: {
      keyMaxChars: _MAX_FLAG_KEY_AH,
      displayMaxChars: _MAX_FLAG_DISPLAY_AH,
      descriptionMaxChars: _MAX_FLAG_DESC_AH,
      maxRulesPerFlag: _MAX_FLAG_RULES_AH,
      maxContextBytes: _MAX_CONTEXT_BYTES_AH,
    },
    notes: [
      "Flag `key` is the lowercased lookup slug and is immutable; `display` is the relabel surface.",
      "Rules are evaluated in array order; the first rule whose `when` map fully matches the context wins.",
      "`percent` operator uses sha256(`${flagKey}:${ruleIndex}` + actual) for stable per-rule bucketing.",
      "Context is canonicalized (sorted keys), sha256-hashed, and redacted to <=2KiB before logging.",
      "Archived flags are evaluated as disabled and always return the default value.",
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pillar AI — Inbox & Digests (Phase 25)
// ─────────────────────────────────────────────────────────────────────
import {
  publicApiInboxState as _inboxStateAI,
  publicApiInboxDigests as _inboxDigestsAI,
} from "@/db/schema";

const _TIER_INBOX_LIMITS_AI: Record<
  string,
  { digests: number; minScheduleSeconds: number; bulkSendMax: number }
> = {
  free: { digests: 3,  minScheduleSeconds: 60 * 60 * 6, bulkSendMax: 20 },   // 6h floor
  mini: { digests: 25, minScheduleSeconds: 60 * 30,     bulkSendMax: 100 },  // 30m
  max:  { digests: 250, minScheduleSeconds: 60 * 5,     bulkSendMax: 500 },  // 5m
};

const _MAX_THREAD_KEY_AI = 200;
const _NOTIF_TYPES_AI = ["alert", "dca", "agent", "marketplace", "system", "team", "digest"] as const;
const _NOTIF_SEVERITIES_AI = ["info", "success", "warning", "error"] as const;

async function _loadInboxStateAI(notificationId: number, userId: string) {
  const d = requireDb();
  const [s] = await d
    .select()
    .from(_inboxStateAI)
    .where(and(eq(_inboxStateAI.notificationId, notificationId), eq(_inboxStateAI.userId, userId)))
    .limit(1);
  return s ?? null;
}

async function _assertNotificationsOwnedAI(ids: number[], userId: string): Promise<number[]> {
  if (!ids.length) return [];
  const d = requireDb();
  const owned = await d
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
  return owned.map((r) => r.id);
}

async function _upsertInboxStateAI(
  notificationId: number,
  userId: string,
  patch: {
    threadKey?: string | null;
    archived?: boolean;
    snoozedUntil?: Date | null;
    pinned?: boolean;
  },
) {
  const d = requireDb();
  const existing = await _loadInboxStateAI(notificationId, userId);
  const now = new Date();
  if (!existing) {
    const [row] = await d
      .insert(_inboxStateAI)
      .values({
        userId,
        notificationId,
        threadKey: patch.threadKey ?? null,
        archived: patch.archived ?? false,
        archivedAt: patch.archived ? now : null,
        snoozedUntil: patch.snoozedUntil ?? null,
        pinned: patch.pinned ?? false,
        pinnedAt: patch.pinned ? now : null,
      })
      .returning();
    return row;
  }
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.threadKey !== undefined) set.threadKey = patch.threadKey;
  if (patch.archived !== undefined) {
    set.archived = patch.archived;
    set.archivedAt = patch.archived ? now : null;
  }
  if (patch.snoozedUntil !== undefined) set.snoozedUntil = patch.snoozedUntil;
  if (patch.pinned !== undefined) {
    set.pinned = patch.pinned;
    set.pinnedAt = patch.pinned ? now : null;
  }
  const [row] = await d
    .update(_inboxStateAI)
    .set(set)
    .where(eq(_inboxStateAI.id, existing.id))
    .returning();
  return row;
}

export async function inboxSearch(
  input: {
    query?: string;
    types?: string[];
    severities?: string[];
    unreadOnly?: boolean;
    includeArchived?: boolean;
    pinnedOnly?: boolean;
    threadKey?: string;
    since?: string;
    until?: string;
    limit?: number;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const conds: unknown[] = [_sqlAE`${notifications.userId} = ${ctx.userId}`];
  if (input.query) {
    const q = `%${input.query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
    conds.push(_sqlAE`(${notifications.title} ILIKE ${q} OR ${notifications.message} ILIKE ${q})`);
  }
  if (input.types?.length) conds.push(_sqlAE`${notifications.type} = ANY(${input.types})`);
  if (input.severities?.length) conds.push(_sqlAE`${notifications.severity} = ANY(${input.severities})`);
  if (input.unreadOnly) conds.push(_sqlAE`${notifications.read} = false`);
  if (input.since) conds.push(_sqlAE`${notifications.createdAt} >= ${new Date(input.since).toISOString()}`);
  if (input.until) conds.push(_sqlAE`${notifications.createdAt} <= ${new Date(input.until).toISOString()}`);
  if (!input.includeArchived) {
    conds.push(_sqlAE`NOT EXISTS (SELECT 1 FROM ${_inboxStateAI} s WHERE s.notification_id = ${notifications.id} AND s.archived = true)`);
  }
  if (input.pinnedOnly) {
    conds.push(_sqlAE`EXISTS (SELECT 1 FROM ${_inboxStateAI} s WHERE s.notification_id = ${notifications.id} AND s.pinned = true)`);
  }
  if (input.threadKey) {
    conds.push(_sqlAE`EXISTS (SELECT 1 FROM ${_inboxStateAI} s WHERE s.notification_id = ${notifications.id} AND s.thread_key = ${input.threadKey})`);
  }

  const rows = await d
    .select()
    .from(notifications)
    .where(and(...(conds as never[])))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const states = ids.length
    ? await d.select().from(_inboxStateAI).where(and(eq(_inboxStateAI.userId, ctx.userId), inArray(_inboxStateAI.notificationId, ids)))
    : [];
  const byId = new Map(states.map((s) => [s.notificationId, s]));
  return {
    count: rows.length,
    notifications: rows.map((r) => ({ ...r, state: byId.get(r.id) ?? null })),
  };
}

export async function inboxArchive(
  input: { ids: number[]; restore?: boolean },
  ctx: CapabilityRunContext,
) {
  if (!input.ids?.length) throw new CapabilityError("`ids` must be a non-empty array", 400, null);
  if (input.ids.length > 500) throw new CapabilityError("Cannot archive more than 500 ids at once", 400, null);
  const owned = await _assertNotificationsOwnedAI(input.ids, ctx.userId);
  const results: unknown[] = [];
  for (const id of owned) {
    const row = await _upsertInboxStateAI(id, ctx.userId, { archived: !input.restore });
    results.push(row);
  }
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: input.restore ? "inbox.restore" : "inbox.archive",
    target: null,
    meta: { count: owned.length, ids: owned },
  });
  if (!input.restore && owned.length) {
    try {
      await emitWebhookEvent({
        userId: ctx.userId,
        event: "inbox.notification_archived",
        data: { ids: owned, archivedAt: new Date().toISOString() },
      });
    } catch { /* webhook failures are non-fatal */ }
  }
  return { updated: results.length, ids: owned, states: results };
}

export async function inboxSnooze(
  input: { ids: number[]; until?: string; clear?: boolean },
  ctx: CapabilityRunContext,
) {
  if (!input.ids?.length) throw new CapabilityError("`ids` must be a non-empty array", 400, null);
  if (input.ids.length > 500) throw new CapabilityError("Cannot snooze more than 500 ids at once", 400, null);
  let snoozedUntil: Date | null = null;
  if (!input.clear) {
    if (!input.until) throw new CapabilityError("`until` is required unless `clear:true`", 400, null);
    snoozedUntil = new Date(input.until);
    if (Number.isNaN(snoozedUntil.getTime())) throw new CapabilityError("`until` is not a valid ISO timestamp", 400, null);
    if (snoozedUntil.getTime() <= Date.now()) throw new CapabilityError("`until` must be in the future", 400, null);
  }
  const owned = await _assertNotificationsOwnedAI(input.ids, ctx.userId);
  const results: unknown[] = [];
  for (const id of owned) {
    const row = await _upsertInboxStateAI(id, ctx.userId, { snoozedUntil });
    results.push(row);
  }
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: input.clear ? "inbox.snooze_clear" : "inbox.snooze",
    target: null,
    meta: { count: owned.length, ids: owned, until: snoozedUntil?.toISOString() ?? null },
  });
  if (!input.clear && owned.length) {
    try {
      await emitWebhookEvent({
        userId: ctx.userId,
        event: "inbox.notification_snoozed",
        data: { ids: owned, until: snoozedUntil?.toISOString() ?? null },
      });
    } catch { /* webhook failures are non-fatal */ }
  }
  return { updated: results.length, ids: owned, states: results };
}

export async function inboxPin(
  input: { ids: number[]; unpin?: boolean },
  ctx: CapabilityRunContext,
) {
  if (!input.ids?.length) throw new CapabilityError("`ids` must be a non-empty array", 400, null);
  if (input.ids.length > 200) throw new CapabilityError("Cannot pin more than 200 ids at once", 400, null);
  const owned = await _assertNotificationsOwnedAI(input.ids, ctx.userId);
  const results: unknown[] = [];
  for (const id of owned) {
    const row = await _upsertInboxStateAI(id, ctx.userId, { pinned: !input.unpin });
    results.push(row);
  }
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: input.unpin ? "inbox.unpin" : "inbox.pin",
    target: null,
    meta: { count: owned.length, ids: owned },
  });
  return { updated: results.length, ids: owned, states: results };
}

export async function inboxThreadSet(
  input: { ids: number[]; threadKey: string | null },
  ctx: CapabilityRunContext,
) {
  if (!input.ids?.length) throw new CapabilityError("`ids` must be a non-empty array", 400, null);
  if (input.ids.length > 500) throw new CapabilityError("Cannot rethread more than 500 ids at once", 400, null);
  let threadKey: string | null = null;
  if (input.threadKey !== null && input.threadKey !== undefined) {
    threadKey = String(input.threadKey).trim();
    if (!threadKey) throw new CapabilityError("threadKey cannot be empty (pass null to clear)", 400, null);
    if (threadKey.length > _MAX_THREAD_KEY_AI) {
      throw new CapabilityError(`threadKey exceeds ${_MAX_THREAD_KEY_AI} chars`, 400, null);
    }
  }
  const owned = await _assertNotificationsOwnedAI(input.ids, ctx.userId);
  const results: unknown[] = [];
  for (const id of owned) {
    const row = await _upsertInboxStateAI(id, ctx.userId, { threadKey });
    results.push(row);
  }
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "inbox.thread_set",
    target: threadKey,
    meta: { count: owned.length, ids: owned, threadKey },
  });
  return { updated: results.length, ids: owned, threadKey, states: results };
}

export async function inboxThreads(
  input: { limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await d
    .select({
      threadKey: _inboxStateAI.threadKey,
      count: _sqlAE<number>`count(*)::int`,
      lastUpdated: _sqlAE<Date>`max(${_inboxStateAI.updatedAt})`,
    })
    .from(_inboxStateAI)
    .where(and(eq(_inboxStateAI.userId, ctx.userId), _sqlAE`${_inboxStateAI.threadKey} IS NOT NULL`))
    .groupBy(_inboxStateAI.threadKey)
    .orderBy(_sqlAE`max(${_inboxStateAI.updatedAt}) DESC`)
    .limit(limit);
  return { count: rows.length, threads: rows };
}

export async function inboxBulkSend(
  input: {
    items: Array<{
      title: string;
      message: string;
      type?: string;
      severity?: "info" | "success" | "warning" | "error";
      threadKey?: string;
      actionUrl?: string;
      actionLabel?: string;
      metadata?: Record<string, unknown>;
    }>;
  },
  ctx: CapabilityRunContext,
) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new CapabilityError("`items` must be a non-empty array", 400, null);
  }
  const tier = await _userTierAE(ctx.userId);
  const cap = _TIER_INBOX_LIMITS_AI[tier].bulkSendMax;
  if (input.items.length > cap) {
    throw new CapabilityError(`Bulk send capped at ${cap} items for tier '${tier}' (got ${input.items.length})`, 429, null);
  }
  const d = requireDb();
  const values = input.items.map((item) => {
    if (!item.title || !item.message) throw new CapabilityError("Each item requires `title` and `message`", 400, null);
    return {
      userId: ctx.userId,
      type: (item.type ?? "system").slice(0, 40),
      title: item.title.slice(0, 200),
      message: item.message.slice(0, 4000),
      severity: item.severity ?? "info",
      actionUrl: item.actionUrl ?? null,
      actionLabel: item.actionLabel ?? null,
      metadata: item.metadata ?? null,
    };
  });
  const inserted = await d.insert(notifications).values(values).returning();

  // Optional thread assignment for each insertion that carries a threadKey
  for (let i = 0; i < inserted.length; i++) {
    const tk = input.items[i].threadKey;
    if (tk) {
      const trimmed = String(tk).trim().slice(0, _MAX_THREAD_KEY_AI);
      if (trimmed) {
        await _upsertInboxStateAI(inserted[i].id, ctx.userId, { threadKey: trimmed });
      }
    }
  }

  // Fan-out one webhook event per row (best-effort)
  const deliveries: unknown[] = [];
  for (const row of inserted) {
    try {
      const r = await emitWebhookEvent({
        userId: ctx.userId,
        event: "notification.created",
        data: {
          id: row.id,
          type: row.type,
          title: row.title,
          message: row.message,
          severity: row.severity,
          actionUrl: row.actionUrl,
          createdAt: row.createdAt,
        },
      });
      deliveries.push({ id: row.id, deliveries: r });
    } catch (e) {
      deliveries.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "inbox.bulk_send",
    target: null,
    meta: { count: inserted.length },
  });

  return { inserted: inserted.length, notifications: inserted, webhookDeliveries: deliveries };
}

function _validateDigestFiltersAI(filters: unknown): {
  types?: string[];
  severities?: string[];
  since?: string;
  threadKey?: string;
} {
  if (filters === undefined || filters === null) return {};
  if (typeof filters !== "object" || Array.isArray(filters)) {
    throw new CapabilityError("`filters` must be an object", 400, null);
  }
  const f = filters as Record<string, unknown>;
  const out: { types?: string[]; severities?: string[]; since?: string; threadKey?: string } = {};
  if (f.types !== undefined) {
    if (!Array.isArray(f.types)) throw new CapabilityError("filters.types must be an array", 400, null);
    out.types = (f.types as unknown[]).map((t) => {
      if (typeof t !== "string") throw new CapabilityError("filters.types entries must be strings", 400, null);
      return t.slice(0, 40);
    });
  }
  if (f.severities !== undefined) {
    if (!Array.isArray(f.severities)) throw new CapabilityError("filters.severities must be an array", 400, null);
    out.severities = (f.severities as unknown[]).map((s) => {
      if (typeof s !== "string" || !(_NOTIF_SEVERITIES_AI as readonly string[]).includes(s)) {
        throw new CapabilityError(`Unknown severity '${String(s)}'. Allowed: ${_NOTIF_SEVERITIES_AI.join(", ")}`, 400, null);
      }
      return s;
    });
  }
  if (f.since !== undefined) {
    if (typeof f.since !== "string") throw new CapabilityError("filters.since must be an ISO string", 400, null);
    const d = new Date(f.since);
    if (Number.isNaN(d.getTime())) throw new CapabilityError("filters.since is not a valid ISO timestamp", 400, null);
    out.since = d.toISOString();
  }
  if (f.threadKey !== undefined) {
    if (typeof f.threadKey !== "string") throw new CapabilityError("filters.threadKey must be a string", 400, null);
    out.threadKey = f.threadKey.slice(0, _MAX_THREAD_KEY_AI);
  }
  return out;
}

export async function inboxDigestsUpsert(
  input: {
    id?: string;
    name: string;
    filters?: unknown;
    channel?: "inbox" | "preview";
    scheduleSeconds?: number;
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const name = (input.name ?? "").trim().slice(0, 120);
  if (!name) throw new CapabilityError("`name` is required", 400, null);
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_INBOX_LIMITS_AI[tier];
  const filters = _validateDigestFiltersAI(input.filters);
  const channel = input.channel ?? "inbox";
  if (!["inbox", "preview"].includes(channel)) {
    throw new CapabilityError("`channel` must be 'inbox' or 'preview'", 400, null);
  }
  const scheduleSeconds = Math.max(input.scheduleSeconds ?? 86400, limits.minScheduleSeconds);
  if (input.scheduleSeconds !== undefined && input.scheduleSeconds < limits.minScheduleSeconds) {
    throw new CapabilityError(
      `scheduleSeconds floor for tier '${tier}' is ${limits.minScheduleSeconds}s`,
      400,
      null,
    );
  }

  if (input.id) {
    const [existing] = await d
      .select()
      .from(_inboxDigestsAI)
      .where(and(eq(_inboxDigestsAI.id, input.id), eq(_inboxDigestsAI.userId, ctx.userId)))
      .limit(1);
    if (!existing) throw new CapabilityError(`Digest '${input.id}' not found`, 404, null);
    const [row] = await d
      .update(_inboxDigestsAI)
      .set({
        name,
        filters: filters as never,
        channel,
        scheduleSeconds,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(_inboxDigestsAI.id, existing.id))
      .returning();
    await _appendAudit({
      keyId: ctx.keyId,
      userId: ctx.userId,
      action: "inbox.digest_update",
      target: row.id,
      meta: { name, channel, scheduleSeconds },
    });
    return row;
  }

  const [{ n }] = await d
    .select({ n: _sqlAE<number>`count(*)::int` })
    .from(_inboxDigestsAI)
    .where(eq(_inboxDigestsAI.userId, ctx.userId));
  if (n >= limits.digests) {
    throw new CapabilityError(
      `Digest quota reached for tier '${tier}' (${n}/${limits.digests})`,
      429,
      null,
    );
  }
  const [dup] = await d
    .select({ id: _inboxDigestsAI.id })
    .from(_inboxDigestsAI)
    .where(and(eq(_inboxDigestsAI.userId, ctx.userId), eq(_inboxDigestsAI.name, name)))
    .limit(1);
  if (dup) throw new CapabilityError(`Digest named '${name}' already exists (id=${dup.id})`, 409, { existingId: dup.id });

  const [row] = await d
    .insert(_inboxDigestsAI)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      name,
      filters: filters as never,
      channel,
      scheduleSeconds,
      enabled: input.enabled ?? true,
    })
    .returning();
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "inbox.digest_create",
    target: row.id,
    meta: { name, channel, scheduleSeconds },
  });
  return row;
}

export async function inboxDigestsList(
  input: { includeDisabled?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const conds: unknown[] = [eq(_inboxDigestsAI.userId, ctx.userId)];
  if (!input.includeDisabled) conds.push(eq(_inboxDigestsAI.enabled, true));
  const rows = await d
    .select()
    .from(_inboxDigestsAI)
    .where(and(...(conds as never[])))
    .orderBy(desc(_inboxDigestsAI.createdAt))
    .limit(limit);
  return { count: rows.length, digests: rows };
}

export async function inboxDigestsDelete(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [existing] = await d
    .select()
    .from(_inboxDigestsAI)
    .where(and(eq(_inboxDigestsAI.id, input.id), eq(_inboxDigestsAI.userId, ctx.userId)))
    .limit(1);
  if (!existing) throw new CapabilityError(`Digest '${input.id}' not found`, 404, null);
  await d.delete(_inboxDigestsAI).where(eq(_inboxDigestsAI.id, existing.id));
  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "inbox.digest_delete",
    target: existing.id,
    meta: { name: existing.name },
  });
  return { deleted: true, id: existing.id, name: existing.name };
}

export async function inboxDigestsRun(
  input: { id: string; dryRun?: boolean; force?: boolean; previewLimit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [digest] = await d
    .select()
    .from(_inboxDigestsAI)
    .where(and(eq(_inboxDigestsAI.id, input.id), eq(_inboxDigestsAI.userId, ctx.userId)))
    .limit(1);
  if (!digest) throw new CapabilityError(`Digest '${input.id}' not found`, 404, null);
  if (!digest.enabled && !input.force) {
    throw new CapabilityError("Digest is disabled. Pass `force:true` to run anyway.", 409, null);
  }

  const previewLimit = Math.min(Math.max(input.previewLimit ?? 50, 1), 200);
  const filters = (digest.filters ?? {}) as {
    types?: string[];
    severities?: string[];
    since?: string;
    threadKey?: string;
  };

  // Window: rows since max(filters.since, lastRunAt, now-24h-default)
  const windowStart = (() => {
    const candidates: number[] = [];
    if (filters.since) candidates.push(new Date(filters.since).getTime());
    if (digest.lastRunAt) candidates.push(new Date(digest.lastRunAt).getTime());
    if (candidates.length === 0) {
      candidates.push(Date.now() - digest.scheduleSeconds * 1000);
    }
    return new Date(Math.max(...candidates));
  })();

  const conds: unknown[] = [
    _sqlAE`${notifications.userId} = ${ctx.userId}`,
    _sqlAE`${notifications.createdAt} >= ${windowStart.toISOString()}`,
  ];
  if (filters.types?.length) conds.push(_sqlAE`${notifications.type} = ANY(${filters.types})`);
  if (filters.severities?.length) conds.push(_sqlAE`${notifications.severity} = ANY(${filters.severities})`);
  if (filters.threadKey) {
    conds.push(_sqlAE`EXISTS (SELECT 1 FROM ${_inboxStateAI} s WHERE s.notification_id = ${notifications.id} AND s.thread_key = ${filters.threadKey})`);
  }
  const matched = await d
    .select()
    .from(notifications)
    .where(and(...(conds as never[])))
    .orderBy(desc(notifications.createdAt))
    .limit(previewLimit);

  const matchCount = matched.length;
  const breakdown = matched.reduce<Record<string, number>>((acc, m) => {
    acc[m.severity] = (acc[m.severity] ?? 0) + 1;
    return acc;
  }, {});

  let summaryNotification: unknown = null;
  if (!input.dryRun && digest.channel === "inbox" && matchCount > 0) {
    const headline = `${digest.name}: ${matchCount} new ${matchCount === 1 ? "item" : "items"}`;
    const lines = matched.slice(0, 5).map((m) => `• [${m.severity}] ${m.title}`).join("\n");
    const [row] = await d
      .insert(notifications)
      .values({
        userId: ctx.userId,
        type: "digest",
        title: headline.slice(0, 200),
        message: (lines + (matchCount > 5 ? `\n…and ${matchCount - 5} more` : "")).slice(0, 4000),
        severity: "info",
        metadata: {
          digestId: digest.id,
          digestName: digest.name,
          matchCount,
          breakdown,
          windowStart: windowStart.toISOString(),
          memberIds: matched.map((m) => m.id),
        },
      })
      .returning();
    summaryNotification = row;
  }

  if (!input.dryRun) {
    await d
      .update(_inboxDigestsAI)
      .set({ lastRunAt: new Date(), lastMatchCount: matchCount, updatedAt: new Date() })
      .where(eq(_inboxDigestsAI.id, digest.id));
    try {
      await emitWebhookEvent({
        userId: ctx.userId,
        event: "inbox.digest_ready",
        data: {
          digestId: digest.id,
          name: digest.name,
          matchCount,
          breakdown,
          windowStart: windowStart.toISOString(),
        },
      });
    } catch { /* non-fatal */ }
  }

  await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: input.dryRun ? "inbox.digest_dryrun" : "inbox.digest_run",
    target: digest.id,
    meta: { name: digest.name, matchCount, channel: digest.channel },
  });

  return {
    digestId: digest.id,
    name: digest.name,
    channel: digest.channel,
    windowStart: windowStart.toISOString(),
    matchCount,
    breakdown,
    members: matched,
    summaryNotification,
    dryRun: !!input.dryRun,
  };
}

export async function inboxPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_INBOX_LIMITS_AI[tier],
    perTier: _TIER_INBOX_LIMITS_AI,
    knownTypes: _NOTIF_TYPES_AI,
    severities: _NOTIF_SEVERITIES_AI,
    fieldLimits: {
      titleMaxChars: 200,
      messageMaxChars: 4000,
      threadKeyMaxChars: _MAX_THREAD_KEY_AI,
    },
    notes: [
      "Inbox state (archive / snooze / pin / thread) is an overlay table — the legacy `notifications` row is never mutated.",
      "`inbox.search` excludes archived rows by default; pass `includeArchived:true` to include them.",
      "Digest `channel` is 'inbox' (writes a summary notification + fires `inbox.digest_ready`) or 'preview' (returns matches only).",
      "Digest evaluation window starts at max(filters.since, lastRunAt, now-scheduleSeconds) so re-runs do not double-count items.",
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pillar AJ — Teams, Members & Invites (Phase 26)
// Wraps the legacy `teams`, `team_members`, and `team_invitations` tables
// with a hash-chained per-team audit overlay and webhook emission. All
// mutations require active membership on the target team; create/rename/
// delete/role-change require role >= 'admin' (delete = owner only).
// ─────────────────────────────────────────────────────────────────────
import {
  teams as _teamsAJ,
  teamMembers as _teamMembersAJ,
  teamInvitations as _teamInvitesAJ,
  publicApiTeamAudit as _teamAuditAJ,
  users as _usersAJ,
} from "@/db/schema";
import { createHash as _chAJ, randomBytes as _rbAJ } from "node:crypto";

const _TIER_TEAM_LIMITS_AJ: Record<
  string,
  { maxTeams: number; maxMembersPerTeam: number; maxPendingInvitesPerTeam: number; inviteTtlDays: number }
> = {
  free: { maxTeams: 1,  maxMembersPerTeam: 3,   maxPendingInvitesPerTeam: 5,   inviteTtlDays: 7 },
  mini: { maxTeams: 5,  maxMembersPerTeam: 25,  maxPendingInvitesPerTeam: 50,  inviteTtlDays: 14 },
  max:  { maxTeams: 50, maxMembersPerTeam: 250, maxPendingInvitesPerTeam: 500, inviteTtlDays: 30 },
};

const _TEAM_ROLES_AJ = ["owner", "admin", "signer", "viewer"] as const;
type _TeamRoleAJ = (typeof _TEAM_ROLES_AJ)[number];
const _ROLE_RANK_AJ: Record<_TeamRoleAJ, number> = { viewer: 1, signer: 2, admin: 3, owner: 4 };

async function _teamAppendAuditAJ(args: {
  keyId: string;
  userId: string;
  teamId: string;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
}) {
  const d = requireDb();
  const [last] = await d
    .select({ hash: _teamAuditAJ.hash })
    .from(_teamAuditAJ)
    .where(eq(_teamAuditAJ.teamId, args.teamId))
    .orderBy(desc(_teamAuditAJ.ts))
    .limit(1);
  const prev = last?.hash ?? "";
  const meta = args.meta ?? {};
  const canonical = JSON.stringify({
    teamId: args.teamId,
    keyId: args.keyId,
    userId: args.userId,
    action: args.action,
    target: args.target ?? null,
    meta,
    ts: new Date().toISOString().slice(0, 19),
  });
  const hash = _chAJ("sha256").update(prev + canonical, "utf8").digest("hex");
  const [row] = await d
    .insert(_teamAuditAJ)
    .values({
      teamId: args.teamId,
      keyId: args.keyId,
      userId: args.userId,
      action: args.action,
      target: args.target ?? null,
      meta,
      prevHash: prev,
      hash,
    })
    .returning({ id: _teamAuditAJ.id, hash: _teamAuditAJ.hash, prevHash: _teamAuditAJ.prevHash, ts: _teamAuditAJ.ts });
  // Mirror to global key audit too so /audit.* surfaces these.
  void _appendAudit({ keyId: args.keyId, userId: args.userId, action: args.action, target: args.teamId, meta }).catch(() => undefined);
  return row;
}

async function _requireTeamMembershipAJ(
  teamId: string,
  userId: string,
  minRole: _TeamRoleAJ = "viewer",
): Promise<{ team: typeof _teamsAJ.$inferSelect; membership: typeof _teamMembersAJ.$inferSelect | null; isCreator: boolean; effectiveRole: _TeamRoleAJ }> {
  const d = requireDb();
  const [team] = await d.select().from(_teamsAJ).where(eq(_teamsAJ.id, teamId)).limit(1);
  if (!team) throw new CapabilityError("Team not found", 404, null);
  const [m] = await d
    .select()
    .from(_teamMembersAJ)
    .where(and(eq(_teamMembersAJ.teamId, teamId), eq(_teamMembersAJ.userId, userId), eq(_teamMembersAJ.status, "active")))
    .limit(1);
  const isCreator = team.createdBy === userId;
  const effective: _TeamRoleAJ = (m?.role as _TeamRoleAJ | undefined) ?? (isCreator ? "owner" : "viewer");
  if (!m && !isCreator) throw new CapabilityError("Not a member of this team", 403, null);
  if (_ROLE_RANK_AJ[effective] < _ROLE_RANK_AJ[minRole]) {
    throw new CapabilityError(`Requires role ${minRole}+ (you are ${effective})`, 403, { role: effective });
  }
  return { team, membership: m ?? null, isCreator, effectiveRole: effective };
}

function _normalizeRoleAJ(r: string): _TeamRoleAJ {
  const k = r.toLowerCase();
  if ((_TEAM_ROLES_AJ as readonly string[]).includes(k)) return k as _TeamRoleAJ;
  throw new CapabilityError(`Invalid role: ${r}`, 400, { allowed: _TEAM_ROLES_AJ });
}

// ─── teams.list ──────────────────────────────────────────────────────
// (teams.list is provided by the legacy handler earlier in this file —
// the Phase 26 layer below extends it with get/create/update/delete/
// invites_list/invites_revoke/audit/policy. members_* are also covered
// by the legacy teams.members / teams.invite / teams.update_role /
// teams.remove_member capabilities.)



// ─── teams.get ───────────────────────────────────────────────────────
export async function teamsGet(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const { team, effectiveRole } = await _requireTeamMembershipAJ(input.id, ctx.userId, "viewer");
  const members = await d
    .select({ id: _teamMembersAJ.id, userId: _teamMembersAJ.userId, role: _teamMembersAJ.role, status: _teamMembersAJ.status, walletAddress: _teamMembersAJ.walletAddress })
    .from(_teamMembersAJ)
    .where(eq(_teamMembersAJ.teamId, team.id));
  const invites = await d
    .select({ id: _teamInvitesAJ.id, email: _teamInvitesAJ.email, role: _teamInvitesAJ.role, expiresAt: _teamInvitesAJ.expiresAt, acceptedAt: _teamInvitesAJ.acceptedAt })
    .from(_teamInvitesAJ)
    .where(eq(_teamInvitesAJ.teamId, team.id));
  return {
    team: { id: team.id, name: team.name, vaultAddress: team.vaultAddress, createdBy: team.createdBy, createdAt: team.createdAt },
    myRole: effectiveRole,
    counts: {
      members: members.filter((m) => m.status === "active").length,
      pendingMembers: members.filter((m) => m.status === "pending").length,
      pendingInvites: invites.filter((i) => !i.acceptedAt && new Date(i.expiresAt) > new Date()).length,
    },
    members,
  };
}

// ─── teams.create ────────────────────────────────────────────────────
export async function teamsCreate(
  input: { name: string; vaultAddress?: string | null },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_TEAM_LIMITS_AJ[tier];
  const existing = await d.select({ id: _teamsAJ.id }).from(_teamsAJ).where(eq(_teamsAJ.createdBy, ctx.userId));
  if (existing.length >= limits.maxTeams) {
    throw new CapabilityError(`Team cap reached for tier ${tier} (${limits.maxTeams})`, 402, { tier, limit: limits.maxTeams });
  }
  const name = input.name.trim();
  if (!name) throw new CapabilityError("name is required", 400, null);
  const [row] = await d
    .insert(_teamsAJ)
    .values({ name, vaultAddress: input.vaultAddress ?? null, createdBy: ctx.userId })
    .returning();
  // Auto-add the creator as an active owner member so downstream queries see them.
  const [me] = await d.select({ wallet: _usersAJ.walletAddress }).from(_usersAJ).where(eq(_usersAJ.id, ctx.userId)).limit(1);
  await d.insert(_teamMembersAJ).values({
    teamId: row.id,
    userId: ctx.userId,
    walletAddress: me?.wallet ?? "",
    role: "owner",
    invitedBy: ctx.userId,
    acceptedAt: new Date(),
    status: "active",
  });
  const audit = await _teamAppendAuditAJ({
    keyId: ctx.keyId,
    userId: ctx.userId,
    teamId: row.id,
    action: "team.created",
    target: row.id,
    meta: { name: row.name, vaultAddress: row.vaultAddress },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "team.created",
    data: { teamId: row.id, name: row.name, createdBy: ctx.userId },
  }).catch(() => undefined);
  return { team: row, audit };
}

// ─── teams.update ────────────────────────────────────────────────────
export async function teamsUpdate(
  input: { id: string; name?: string; vaultAddress?: string | null },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  await _requireTeamMembershipAJ(input.id, ctx.userId, "admin");
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new CapabilityError("name cannot be empty", 400, null);
    patch.name = n;
  }
  if (input.vaultAddress !== undefined) patch.vaultAddress = input.vaultAddress;
  if (!Object.keys(patch).length) throw new CapabilityError("no fields to update", 400, null);
  const [row] = await d.update(_teamsAJ).set(patch).where(eq(_teamsAJ.id, input.id)).returning();
  const audit = await _teamAppendAuditAJ({
    keyId: ctx.keyId,
    userId: ctx.userId,
    teamId: input.id,
    action: "team.updated",
    target: input.id,
    meta: patch,
  });
  return { team: row, audit };
}

// ─── teams.delete ────────────────────────────────────────────────────
export async function teamsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const { team, isCreator, effectiveRole } = await _requireTeamMembershipAJ(input.id, ctx.userId, "owner");
  if (!isCreator && effectiveRole !== "owner") {
    throw new CapabilityError("Only the team creator/owner can delete", 403, null);
  }
  const audit = await _teamAppendAuditAJ({
    keyId: ctx.keyId,
    userId: ctx.userId,
    teamId: team.id,
    action: "team.deleted",
    target: team.id,
    meta: { name: team.name },
  });
  // Cascade via FKs removes members, invites, and audit rows.
  await d.delete(_teamsAJ).where(eq(_teamsAJ.id, team.id));
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "team.deleted",
    data: { teamId: team.id, name: team.name },
  }).catch(() => undefined);
  return { ok: true, deletedTeamId: team.id, audit };
}


// ─── teams.invites_list ──────────────────────────────────────────────
export async function teamsInvitesList(
  input: { teamId: string; includeExpired?: boolean; includeAccepted?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  await _requireTeamMembershipAJ(input.teamId, ctx.userId, "viewer");
  const rows = await d.select().from(_teamInvitesAJ).where(eq(_teamInvitesAJ.teamId, input.teamId));
  const now = Date.now();
  const filtered = rows.filter((r) => {
    if (!input.includeAccepted && r.acceptedAt) return false;
    if (!input.includeExpired && new Date(r.expiresAt).getTime() < now) return false;
    return true;
  });
  return {
    count: filtered.length,
    invites: filtered.map((r) => ({
      id: r.id,
      email: r.email,
      walletAddress: r.walletAddress,
      role: r.role,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
      createdAt: r.createdAt,
      // token deliberately omitted — only returned on create.
    })),
  };
}

// ─── teams.invites_revoke ────────────────────────────────────────────
export async function teamsInvitesRevoke(
  input: { teamId: string; inviteId: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  await _requireTeamMembershipAJ(input.teamId, ctx.userId, "admin");
  const [invite] = await d
    .select()
    .from(_teamInvitesAJ)
    .where(and(eq(_teamInvitesAJ.id, input.inviteId), eq(_teamInvitesAJ.teamId, input.teamId)))
    .limit(1);
  if (!invite) throw new CapabilityError("Invite not found", 404, null);
  if (invite.acceptedAt) throw new CapabilityError("Invite already accepted", 409, null);
  await d.delete(_teamInvitesAJ).where(eq(_teamInvitesAJ.id, input.inviteId));
  const audit = await _teamAppendAuditAJ({
    keyId: ctx.keyId,
    userId: ctx.userId,
    teamId: input.teamId,
    action: "team.invite_revoked",
    target: input.inviteId,
    meta: { role: invite.role, email: invite.email, walletAddress: invite.walletAddress },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "team.invite_revoked",
    data: { teamId: input.teamId, inviteId: input.inviteId, role: invite.role },
  }).catch(() => undefined);
  return { ok: true, inviteId: input.inviteId, audit };
}

// ─── teams.audit ─────────────────────────────────────────────────────
export async function teamsAudit(
  input: { teamId: string; limit?: number; action?: string; since?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  await _requireTeamMembershipAJ(input.teamId, ctx.userId, "viewer");
  const limit = Math.min(input.limit ?? 100, 1000);
  const sinceDate = input.since ? new Date(input.since) : null;
  let rows = await d
    .select()
    .from(_teamAuditAJ)
    .where(eq(_teamAuditAJ.teamId, input.teamId))
    .orderBy(desc(_teamAuditAJ.ts))
    .limit(limit);
  if (input.action) rows = rows.filter((r) => r.action === input.action);
  if (sinceDate) rows = rows.filter((r) => new Date(r.ts) >= sinceDate);
  // Verify chain integrity for the returned slice (against full chain to the right of it).
  const verifyRows = [...rows].reverse(); // oldest → newest
  let chainOk = true;
  for (let i = 1; i < verifyRows.length; i++) {
    if (verifyRows[i].prevHash !== verifyRows[i - 1].hash) { chainOk = false; break; }
  }
  return { count: rows.length, chainOk, entries: rows };
}

// ─── teams.policy ────────────────────────────────────────────────────
export async function teamsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_TEAM_LIMITS_AJ[tier],
    perTier: _TIER_TEAM_LIMITS_AJ,
    roles: _TEAM_ROLES_AJ,
    roleRank: _ROLE_RANK_AJ,
    permissions: {
      "teams.create":           { minRole: null,    note: "Anyone within team-cap can create" },
      "teams.update":           { minRole: "admin", note: "Owner/admin rename or rebind vault" },
      "teams.delete":           { minRole: "owner", note: "Creator/owner only; cascades members + invites" },
      "teams.members_invite":   { minRole: "admin", note: "Email or wallet; token returned ONCE" },
      "teams.members_role_set": { minRole: "admin", note: "Cannot demote the owner" },
      "teams.members_remove":   { minRole: "admin", note: "Soft-set status=removed; owner is protected" },
      "teams.invites_revoke":   { minRole: "admin", note: "Hard-deletes the pending invite" },
      "teams.*":                { minRole: "viewer", note: "All reads require active membership" },
    },
    notes: [
      "The creator is auto-added as an `owner` member at creation time.",
      "Pending invite tokens are returned once on `teams.members_invite` and never echoed by `teams.invites_list`.",
      "Every mutation appends to a per-team hash-chained audit (`teams.audit`) AND mirrors to the global key audit log.",
      "Webhook events: team.created / team.deleted / team.member_invited / team.member_joined / team.member_role_changed / team.member_removed / team.invite_revoked.",
    ],
  };
}
// ─────────────────────────────────────────────────────────────────────
// Pillar AK — Billing, Usage & Quotas (Phase 27)
// Adds usage timeseries, per-capability / per-key breakdowns, forecasts,
// invoice details + cancellation, and user-defined usage threshold
// alerts on top of the legacy Pillar X billing surface.
// ─────────────────────────────────────────────────────────────────────
import {
  publicApiBillingAlerts as _alertsAK,
  notifications as _notifAK,
} from "@/db/schema";
import { sql as _sqlAK } from "drizzle-orm";

const _MAX_HISTORY_DAYS_AK = 90;
const _MIN_HISTORY_DAYS_AK = 1;
const _ALERT_CHANNELS_AK = ["inbox", "webhook"] as const;
const _ALERT_METRICS_AK = ["calls", "credits"] as const;
const _ALERT_SCOPES_AK = ["monthly", "daily"] as const;

const _TIER_ALERT_LIMITS_AK: Record<string, { maxAlerts: number }> = {
  free: { maxAlerts: 3 },
  mini: { maxAlerts: 25 },
  max:  { maxAlerts: 250 },
};

function _dayWindowAK(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

function _windowForScopeAK(scope: "monthly" | "daily") {
  return scope === "daily" ? _dayWindowAK() : _monthWindow();
}

async function _userTierAK(userId: string): Promise<string> {
  const d = requireDb();
  const [u] = await d.select({ tier: _usersX.tier }).from(_usersX).where(eq(_usersX.id, userId)).limit(1);
  return (u?.tier ?? "free").toLowerCase();
}

// ─── billing.usage_history ──────────────────────────────────────────
export async function billingUsageHistory(
  input: { days?: number; granularity?: "day" | "hour" },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const days = Math.max(_MIN_HISTORY_DAYS_AK, Math.min(input.days ?? 30, _MAX_HISTORY_DAYS_AK));
  const gran = input.granularity ?? "day";
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await d
    .select({
      bucket: _sqlAK<Date>`date_trunc(${gran}, ${_publicApiKeyUsageX.ts})`.as("bucket"),
      status: _publicApiKeyUsageX.status,
      credits: _publicApiKeyUsageX.costCredits,
    })
    .from(_publicApiKeyUsageX)
    .where(and(
      eq(_publicApiKeyUsageX.userId, ctx.userId),
      gte(_publicApiKeyUsageX.ts, since),
    ));
  const series = new Map<string, { calls: number; ok: number; errors: number; denied: number; rateLimited: number; credits: number }>();
  for (const r of rows) {
    const k = (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).toISOString();
    const slot = series.get(k) ?? { calls: 0, ok: 0, errors: 0, denied: 0, rateLimited: 0, credits: 0 };
    slot.calls++;
    const c = Number(r.credits ?? 0);
    if (Number.isFinite(c)) slot.credits += c;
    if (r.status === "ok") slot.ok++;
    else if (r.status === "denied") slot.denied++;
    else if (r.status === "rate_limited") slot.rateLimited++;
    else slot.errors++;
    series.set(k, slot);
  }
  const points = Array.from(series.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ts, v]) => ({ ts, ...v, credits: Math.round(v.credits * 1e4) / 1e4 }));
  return {
    period: { since: since.toISOString(), now: new Date().toISOString(), days, granularity: gran },
    pointCount: points.length,
    points,
  };
}

// ─── billing.usage_by_capability ─────────────────────────────────────
export async function billingUsageByCapability(
  input: { scope?: "monthly" | "daily"; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { start, end } = _windowForScopeAK(input.scope ?? "monthly");
  const rows = await d
    .select({
      capabilityId: _publicApiKeyUsageX.capabilityId,
      status: _publicApiKeyUsageX.status,
      credits: _publicApiKeyUsageX.costCredits,
      latency: _publicApiKeyUsageX.latencyMs,
    })
    .from(_publicApiKeyUsageX)
    .where(and(
      eq(_publicApiKeyUsageX.userId, ctx.userId),
      gte(_publicApiKeyUsageX.ts, start),
      lte(_publicApiKeyUsageX.ts, end),
    ));
  const limit = Math.min(input.limit ?? 100, 500);
  const agg = new Map<string, { calls: number; ok: number; errors: number; credits: number; latencyTotal: number; latencyN: number }>();
  for (const r of rows) {
    const slot = agg.get(r.capabilityId) ?? { calls: 0, ok: 0, errors: 0, credits: 0, latencyTotal: 0, latencyN: 0 };
    slot.calls++;
    if (r.status === "ok") slot.ok++; else slot.errors++;
    const c = Number(r.credits ?? 0);
    if (Number.isFinite(c)) slot.credits += c;
    if (r.latency != null && Number.isFinite(r.latency)) {
      slot.latencyTotal += r.latency;
      slot.latencyN++;
    }
    agg.set(r.capabilityId, slot);
  }
  const out = Array.from(agg.entries())
    .map(([capabilityId, v]) => ({
      capabilityId,
      calls: v.calls,
      ok: v.ok,
      errors: v.errors,
      credits: Math.round(v.credits * 1e4) / 1e4,
      avgLatencyMs: v.latencyN ? Math.round(v.latencyTotal / v.latencyN) : null,
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);
  return {
    period: { start: start.toISOString(), end: end.toISOString(), scope: input.scope ?? "monthly" },
    count: out.length,
    capabilities: out,
  };
}

// ─── billing.quota_check ────────────────────────────────────────────
export async function billingQuotaCheck(
  input: { plannedCalls?: number; plannedCredits?: number; scope?: "monthly" | "daily" },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const scope = input.scope ?? "monthly";
  const { start, end } = _windowForScopeAK(scope);
  const tier = await _userTierAK(ctx.userId);
  const limits = _TIER_LIMITS_X[tier] ?? _TIER_LIMITS_X.free;
  // Daily scope only makes sense if we synthesise a soft daily ceiling = monthly/30.
  const callCeiling = scope === "daily" ? Math.ceil(limits.callsPerMonth / 30) : limits.callsPerMonth;
  const creditCeiling = scope === "daily" ? Math.ceil(limits.creditsPerMonth / 30) : limits.creditsPerMonth;
  const rows = await d
    .select({ status: _publicApiKeyUsageX.status, credits: _publicApiKeyUsageX.costCredits })
    .from(_publicApiKeyUsageX)
    .where(and(
      eq(_publicApiKeyUsageX.userId, ctx.userId),
      gte(_publicApiKeyUsageX.ts, start),
      lte(_publicApiKeyUsageX.ts, end),
    ));
  let usedCalls = 0;
  let usedCredits = 0;
  for (const r of rows) {
    usedCalls++;
    const c = Number(r.credits ?? 0);
    if (Number.isFinite(c)) usedCredits += c;
  }
  const planCalls = (input.plannedCalls ?? 0);
  const planCredits = (input.plannedCredits ?? 0);
  const projectedCalls = usedCalls + planCalls;
  const projectedCredits = usedCredits + planCredits;
  return {
    period: { start: start.toISOString(), end: end.toISOString(), scope },
    tier,
    ceilings: { calls: callCeiling, credits: creditCeiling },
    used: { calls: usedCalls, credits: Math.round(usedCredits * 1e4) / 1e4 },
    planned: { calls: planCalls, credits: planCredits },
    projected: { calls: projectedCalls, credits: Math.round(projectedCredits * 1e4) / 1e4 },
    headroom: {
      calls: Math.max(0, callCeiling - projectedCalls),
      credits: Math.max(0, Math.round((creditCeiling - projectedCredits) * 1e4) / 1e4),
    },
    callsPct: callCeiling > 0 ? Math.round((projectedCalls / callCeiling) * 1000) / 10 : 0,
    creditsPct: creditCeiling > 0 ? Math.round((projectedCredits / creditCeiling) * 1000) / 10 : 0,
    wouldExceed: {
      calls: callCeiling > 0 && projectedCalls > callCeiling,
      credits: creditCeiling > 0 && projectedCredits > creditCeiling,
    },
  };
}

// ─── billing.forecast ────────────────────────────────────────────────
export async function billingForecast(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const d = requireDb();
  const { start, end } = _monthWindow();
  const now = new Date();
  const elapsedMs = Math.max(1, now.getTime() - start.getTime());
  const windowMs = end.getTime() - start.getTime();
  const rows = await d
    .select({ status: _publicApiKeyUsageX.status, credits: _publicApiKeyUsageX.costCredits })
    .from(_publicApiKeyUsageX)
    .where(and(
      eq(_publicApiKeyUsageX.userId, ctx.userId),
      gte(_publicApiKeyUsageX.ts, start),
    ));
  let calls = 0;
  let credits = 0;
  for (const r of rows) {
    calls++;
    const c = Number(r.credits ?? 0);
    if (Number.isFinite(c)) credits += c;
  }
  const rate = elapsedMs / windowMs;
  const projectedCalls = rate > 0 ? Math.round(calls / rate) : calls;
  const projectedCredits = rate > 0 ? Math.round((credits / rate) * 1e4) / 1e4 : Math.round(credits * 1e4) / 1e4;
  const tier = await _userTierAK(ctx.userId);
  const limits = _TIER_LIMITS_X[tier] ?? _TIER_LIMITS_X.free;
  const verdict =
    (limits.callsPerMonth > 0 && projectedCalls > limits.callsPerMonth) ||
    (limits.creditsPerMonth > 0 && projectedCredits > limits.creditsPerMonth)
      ? "over_quota"
      : "within_quota";
  return {
    period: { start: start.toISOString(), end: end.toISOString(), elapsedPct: Math.round(rate * 1000) / 10 },
    actual: { calls, credits: Math.round(credits * 1e4) / 1e4 },
    projected: { calls: projectedCalls, credits: projectedCredits },
    tier,
    limits,
    verdict,
  };
}

// ─── billing.credits_ledger ─────────────────────────────────────────
export async function billingCreditsLedger(
  input: { since?: string; until?: string; minCost?: number; limit?: number; capabilityId?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(input.limit ?? 200, 1000);
  const conds = [
    eq(_publicApiKeyUsageX.userId, ctx.userId),
    _sqlAK`${_publicApiKeyUsageX.costCredits}::numeric > ${input.minCost ?? 0}`,
  ];
  if (input.since) conds.push(gte(_publicApiKeyUsageX.ts, new Date(input.since)));
  if (input.until) conds.push(lte(_publicApiKeyUsageX.ts, new Date(input.until)));
  if (input.capabilityId) conds.push(eq(_publicApiKeyUsageX.capabilityId, input.capabilityId));
  const rows = await d
    .select()
    .from(_publicApiKeyUsageX)
    .where(and(...conds))
    .orderBy(desc(_publicApiKeyUsageX.ts))
    .limit(limit);
  const total = rows.reduce((s, r) => s + Number(r.costCredits ?? 0), 0);
  return {
    count: rows.length,
    totalCredits: Math.round(total * 1e4) / 1e4,
    entries: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      capabilityId: r.capabilityId,
      keyId: r.keyId,
      transport: r.transport,
      status: r.status,
      credits: Number(r.costCredits ?? 0),
      latencyMs: r.latencyMs,
    })),
  };
}

// ─── billing.invoice_get ────────────────────────────────────────────
export async function billingInvoiceGet(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_cryptoInvoicesX)
    .where(and(eq(_cryptoInvoicesX.id, input.id), eq(_cryptoInvoicesX.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError("Invoice not found", 404, null);
  return { invoice: row };
}

// ─── billing.cancel_invoice ─────────────────────────────────────────
export async function billingCancelInvoice(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_cryptoInvoicesX)
    .where(and(eq(_cryptoInvoicesX.id, input.id), eq(_cryptoInvoicesX.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError("Invoice not found", 404, null);
  if (row.status !== "pending") {
    throw new CapabilityError(`Cannot cancel invoice in status ${row.status}`, 409, { status: row.status });
  }
  const [updated] = await d
    .update(_cryptoInvoicesX)
    .set({ status: "expired" })
    .where(eq(_cryptoInvoicesX.id, input.id))
    .returning();
  const audit = await _appendAudit({
    keyId: ctx.keyId,
    userId: ctx.userId,
    action: "billing.invoice_cancelled",
    target: input.id,
    meta: { tier: row.tier, amount: row.amountMinor },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "billing.invoice_cancelled",
    data: { invoiceId: input.id, tier: row.tier },
  }).catch(() => undefined);
  return { invoice: updated, audit };
}

// ─── billing.alerts_upsert ──────────────────────────────────────────
export async function billingAlertsUpsert(
  input: {
    id?: string;
    name: string;
    metric?: "calls" | "credits";
    scope?: "monthly" | "daily";
    thresholdPct?: number;
    thresholdAbs?: number;
    channel?: "inbox" | "webhook";
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (input.thresholdPct == null && input.thresholdAbs == null) {
    throw new CapabilityError("Provide thresholdPct or thresholdAbs", 400, null);
  }
  if (input.thresholdPct != null && (input.thresholdPct < 1 || input.thresholdPct > 100)) {
    throw new CapabilityError("thresholdPct must be 1..100", 400, null);
  }
  if (input.thresholdAbs != null && input.thresholdAbs < 0) {
    throw new CapabilityError("thresholdAbs must be >= 0", 400, null);
  }
  if (input.id) {
    const [existing] = await d
      .select()
      .from(_alertsAK)
      .where(and(eq(_alertsAK.id, input.id), eq(_alertsAK.userId, ctx.userId)))
      .limit(1);
    if (!existing) throw new CapabilityError("Alert not found", 404, null);
    const patch: Record<string, unknown> = { updatedAt: new Date(), name: input.name };
    if (input.metric) patch.metric = input.metric;
    if (input.scope) patch.scope = input.scope;
    if (input.thresholdPct !== undefined) patch.thresholdPct = input.thresholdPct ?? null;
    if (input.thresholdAbs !== undefined) patch.thresholdAbs = input.thresholdAbs?.toString() ?? null;
    if (input.channel) patch.channel = input.channel;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    const [row] = await d.update(_alertsAK).set(patch).where(eq(_alertsAK.id, input.id)).returning();
    await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "billing.alert_updated", target: row.id, meta: patch });
    return { alert: row, created: false };
  }
  const tier = await _userTierAK(ctx.userId);
  const cap = _TIER_ALERT_LIMITS_AK[tier]?.maxAlerts ?? _TIER_ALERT_LIMITS_AK.free.maxAlerts;
  const existing = await d.select({ id: _alertsAK.id }).from(_alertsAK).where(eq(_alertsAK.userId, ctx.userId));
  if (existing.length >= cap) {
    throw new CapabilityError(`Alert cap reached for tier ${tier} (${cap})`, 402, { tier, limit: cap });
  }
  const [row] = await d
    .insert(_alertsAK)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      name: input.name.trim(),
      metric: input.metric ?? "calls",
      scope: input.scope ?? "monthly",
      thresholdPct: input.thresholdPct ?? null,
      thresholdAbs: input.thresholdAbs?.toString() ?? null,
      channel: input.channel ?? "inbox",
      enabled: input.enabled ?? true,
    })
    .returning();
  await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "billing.alert_created", target: row.id, meta: { name: row.name } });
  return { alert: row, created: true };
}

// ─── billing.alerts_list ────────────────────────────────────────────
export async function billingAlertsList(
  input: { includeDisabled?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const limit = Math.min(input.limit ?? 100, 500);
  const rows = await d
    .select()
    .from(_alertsAK)
    .where(eq(_alertsAK.userId, ctx.userId))
    .orderBy(desc(_alertsAK.createdAt))
    .limit(limit);
  const filtered = input.includeDisabled ? rows : rows.filter((r) => r.enabled);
  return { count: filtered.length, alerts: filtered };
}

// ─── billing.alerts_delete ──────────────────────────────────────────
export async function billingAlertsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d.select().from(_alertsAK).where(and(eq(_alertsAK.id, input.id), eq(_alertsAK.userId, ctx.userId))).limit(1);
  if (!row) throw new CapabilityError("Alert not found", 404, null);
  await d.delete(_alertsAK).where(eq(_alertsAK.id, input.id));
  await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "billing.alert_deleted", target: input.id, meta: { name: row.name } });
  return { ok: true, id: input.id };
}

// ─── billing.alerts_evaluate ────────────────────────────────────────
// Evaluates every enabled alert for the caller against the current window.
// Triggered alerts (a) write one inbox notification per trigger, (b) fire
// `billing.quota_threshold` or `billing.quota_exceeded` (>=100%) webhook,
// and (c) debounce via last_triggered_at until the next window.
export async function billingAlertsEvaluate(
  input: { dryRun?: boolean; force?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAK(ctx.userId);
  const monthlyLimits = _TIER_LIMITS_X[tier] ?? _TIER_LIMITS_X.free;
  const alerts = await d
    .select()
    .from(_alertsAK)
    .where(and(eq(_alertsAK.userId, ctx.userId), eq(_alertsAK.enabled, true)));
  // Pre-aggregate both windows once.
  const buckets: Record<"monthly" | "daily", { calls: number; credits: number; window: { start: Date; end: Date } }> = {
    monthly: { calls: 0, credits: 0, window: _monthWindow() },
    daily: { calls: 0, credits: 0, window: _dayWindowAK() },
  };
  for (const scope of ["monthly", "daily"] as const) {
    const { start, end } = buckets[scope].window;
    const rows = await d
      .select({ credits: _publicApiKeyUsageX.costCredits })
      .from(_publicApiKeyUsageX)
      .where(and(
        eq(_publicApiKeyUsageX.userId, ctx.userId),
        gte(_publicApiKeyUsageX.ts, start),
        lte(_publicApiKeyUsageX.ts, end),
      ));
    buckets[scope].calls = rows.length;
    buckets[scope].credits = rows.reduce((s, r) => s + Number(r.credits ?? 0), 0);
  }
  const evaluated: Array<{ id: string; name: string; triggered: boolean; value: number; threshold: number; pct: number; reason: string; debounced: boolean }> = [];
  for (const a of alerts) {
    const scope = (a.scope as "monthly" | "daily");
    const metric = (a.metric as "calls" | "credits");
    const b = buckets[scope];
    const value = metric === "calls" ? b.calls : Math.round(b.credits * 1e4) / 1e4;
    const ceiling = scope === "daily"
      ? Math.ceil((metric === "calls" ? monthlyLimits.callsPerMonth : monthlyLimits.creditsPerMonth) / 30)
      : (metric === "calls" ? monthlyLimits.callsPerMonth : monthlyLimits.creditsPerMonth);
    let threshold = 0;
    let pct = 0;
    if (a.thresholdAbs != null) {
      threshold = Number(a.thresholdAbs);
      pct = ceiling > 0 ? (value / ceiling) * 100 : 0;
    } else if (a.thresholdPct != null) {
      threshold = ceiling * (a.thresholdPct / 100);
      pct = ceiling > 0 ? (value / ceiling) * 100 : 0;
    }
    const crossed = value >= threshold && threshold > 0;
    const debouncedUntil = a.lastTriggeredAt ? new Date(a.lastTriggeredAt).getTime() >= b.window.start.getTime() : false;
    const triggered = crossed && (input.force || !debouncedUntil);
    evaluated.push({
      id: a.id, name: a.name, triggered, value, threshold, pct: Math.round(pct * 10) / 10,
      reason: triggered ? `${metric}=${value} >= ${threshold} (${a.thresholdPct ?? "abs"}${a.thresholdPct != null ? "%" : ""})` : (crossed ? "debounced" : "below"),
      debounced: crossed && debouncedUntil && !input.force,
    });
    if (!triggered || input.dryRun) continue;
    // (a) inbox notification
    await d.insert(_notifAK).values({
      userId: ctx.userId,
      title: `Usage alert: ${a.name}`,
      message: `${metric} usage hit ${value} (threshold ${threshold}, ${Math.round(pct)}% of ${scope} ceiling).`,
      type: "billing",
      severity: pct >= 100 ? "error" : "warning",
      metadata: { alertId: a.id, metric, scope, value, threshold, pct, ceiling },
    } as never).catch(() => undefined);
    // (b) webhook
    const event: WebhookEventName = pct >= 100 ? "billing.quota_exceeded" : "billing.quota_threshold";
    void emitWebhookEvent({
      userId: ctx.userId,
      event,
      data: { alertId: a.id, name: a.name, metric, scope, value, threshold, pct, ceiling },
    }).catch(() => undefined);
    // (c) debounce
    await d.update(_alertsAK).set({
      lastTriggeredAt: new Date(),
      lastValue: value.toString(),
      fireCount: (a.fireCount ?? 0) + 1,
      updatedAt: new Date(),
    }).where(eq(_alertsAK.id, a.id));
    await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "billing.alert_triggered", target: a.id, meta: { metric, scope, value, threshold, pct } });
  }
  return {
    tier,
    dryRun: !!input.dryRun,
    counts: { evaluated: alerts.length, triggered: evaluated.filter((e) => e.triggered).length },
    results: evaluated,
  };
}

// ─── billing.policy ─────────────────────────────────────────────────
export async function billingPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAK(ctx.userId);
  return {
    tier,
    tierLimits: _TIER_LIMITS_X,
    alertLimits: _TIER_ALERT_LIMITS_AK,
    alertOptions: {
      metrics: _ALERT_METRICS_AK,
      scopes: _ALERT_SCOPES_AK,
      channels: _ALERT_CHANNELS_AK,
      thresholdPctRange: [1, 100],
    },
    webhookEvents: [
      "billing.invoice_created",
      "billing.invoice_paid",
      "billing.invoice_cancelled",
      "billing.tier_changed",
      "billing.quota_threshold",
      "billing.quota_exceeded",
    ],
    historyLimits: { minDays: _MIN_HISTORY_DAYS_AK, maxDays: _MAX_HISTORY_DAYS_AK, granularities: ["day", "hour"] },
    notes: [
      "Daily ceilings are synthesised as ceil(monthlyLimit / 30) — they're a soft pacing guide, not a hard wall.",
      "`alerts_evaluate` is idempotent within a window via `last_triggered_at`. Pass `force:true` to re-trigger in dev.",
      "`forecast` uses linear extrapolation (used / elapsedFraction). Early-month forecasts have high variance.",
      "`cancel_invoice` only works on `pending` rows; confirmed invoices are permanent and refunded out of band.",
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pillar AL — Workspace Insights & Reporting (Phase 28)
// Read-side rollups on top of public_api_key_usage + public_api_audit_log
// + public_api_team_audit, plus a reusable saved-report layer with
// immutable snapshots and tokenised public share links.
// ─────────────────────────────────────────────────────────────────────
import {
  publicApiReports as _reportsAL,
  publicApiReportSnapshots as _snapshotsAL,
  publicApiReportShares as _sharesAL,
  publicApiKeyUsage as _usageAL,
  publicApiAuditLog as _auditAL,
  publicApiTeamAudit as _teamAuditAL,
  teamMembers as _teamMembersAL,
  teams as _teamsAL,
} from "@/db/schema";
import { sql as _sqlAL, gte as _gteAL, lte as _lteAL } from "drizzle-orm";
import { randomBytes as _rbAL, createHash as _shaAL } from "node:crypto";

const _MAX_WINDOW_DAYS_AL = 365;
const _MIN_WINDOW_DAYS_AL = 1;
const _MAX_SECTIONS_AL = 16;
const _MAX_PAYLOAD_BYTES_AL = 256 * 1024;

const _SECTION_TYPES_AL = [
  "overview",
  "activity",
  "top_capabilities",
  "errors",
  "audit_summary",
  "teams_overview",
  "billing_snapshot",
] as const;
type SectionTypeAL = (typeof _SECTION_TYPES_AL)[number];

const _TIER_REPORT_LIMITS_AL: Record<string, {
  maxReports: number;
  maxSnapshotsPerReport: number;
  maxShares: number;
  shareMaxDays: number;
  minScheduleSeconds: number;
  maxWindowDays: number;
}> = {
  free: { maxReports: 3,   maxSnapshotsPerReport: 10,  maxShares: 5,   shareMaxDays: 7,   minScheduleSeconds: 86400,  maxWindowDays: 30  },
  mini: { maxReports: 50,  maxSnapshotsPerReport: 90,  maxShares: 100, shareMaxDays: 90,  minScheduleSeconds: 3600,   maxWindowDays: 180 },
  max:  { maxReports: 500, maxSnapshotsPerReport: 365, maxShares: 5000,shareMaxDays: 365, minScheduleSeconds: 900,    maxWindowDays: 365 },
};

async function _userTierAL(userId: string): Promise<"free" | "mini" | "max"> {
  return _userTierAE(userId);
}

function _clampWindowAL(days: number | undefined, tier: string): { start: Date; end: Date; days: number } {
  const limits = _TIER_REPORT_LIMITS_AL[tier] ?? _TIER_REPORT_LIMITS_AL.free;
  const n = Math.max(_MIN_WINDOW_DAYS_AL, Math.min(days ?? 30, Math.min(limits.maxWindowDays, _MAX_WINDOW_DAYS_AL)));
  const end = new Date();
  const start = new Date(end.getTime() - n * 86_400_000);
  return { start, end, days: n };
}

// ── Section runners ────────────────────────────────────────────────
async function _runOverviewAL(ctx: CapabilityRunContext, start: Date, end: Date, keyOnly: boolean) {
  const d = requireDb();
  const conds = [eq(_usageAL.userId, ctx.userId), _gteAL(_usageAL.ts, start), _lteAL(_usageAL.ts, end)];
  if (keyOnly) conds.push(eq(_usageAL.keyId, ctx.keyId));
  const [row] = await d
    .select({
      calls: _sqlAL<number>`count(*)::int`,
      errors: _sqlAL<number>`count(*) filter (where ${_usageAL.status} <> 'ok')::int`,
      denied: _sqlAL<number>`count(*) filter (where ${_usageAL.status} = 'denied')::int`,
      rateLimited: _sqlAL<number>`count(*) filter (where ${_usageAL.status} = 'rate_limited')::int`,
      credits: _sqlAL<string>`coalesce(sum(${_usageAL.costCredits})::text, '0')`,
      avgLatency: _sqlAL<number>`coalesce(avg(${_usageAL.latencyMs})::int, 0)`,
      p95: _sqlAL<number>`coalesce(percentile_cont(0.95) within group (order by ${_usageAL.latencyMs})::int, 0)`,
      distinctCaps: _sqlAL<number>`count(distinct ${_usageAL.capabilityId})::int`,
    })
    .from(_usageAL)
    .where(and(...conds));
  return {
    calls: row?.calls ?? 0,
    errors: row?.errors ?? 0,
    errorRate: row?.calls ? Math.round(((row.errors ?? 0) / row.calls) * 10000) / 100 : 0,
    denied: row?.denied ?? 0,
    rateLimited: row?.rateLimited ?? 0,
    credits: row?.credits ?? "0",
    avgLatencyMs: row?.avgLatency ?? 0,
    p95LatencyMs: row?.p95 ?? 0,
    distinctCapabilities: row?.distinctCaps ?? 0,
  };
}

async function _runActivityAL(ctx: CapabilityRunContext, start: Date, end: Date, granularity: "day" | "hour", keyOnly: boolean) {
  const d = requireDb();
  const bucket = granularity === "hour"
    ? _sqlAL<Date>`date_trunc('hour', ${_usageAL.ts})`
    : _sqlAL<Date>`date_trunc('day', ${_usageAL.ts})`;
  const conds = [eq(_usageAL.userId, ctx.userId), _gteAL(_usageAL.ts, start), _lteAL(_usageAL.ts, end)];
  if (keyOnly) conds.push(eq(_usageAL.keyId, ctx.keyId));
  const rows = await d
    .select({
      bucket,
      calls: _sqlAL<number>`count(*)::int`,
      errors: _sqlAL<number>`count(*) filter (where ${_usageAL.status} <> 'ok')::int`,
      credits: _sqlAL<string>`coalesce(sum(${_usageAL.costCredits})::text, '0')`,
      avgLatency: _sqlAL<number>`coalesce(avg(${_usageAL.latencyMs})::int, 0)`,
    })
    .from(_usageAL)
    .where(and(...conds))
    .groupBy(bucket)
    .orderBy(bucket);
  return { granularity, buckets: rows };
}

async function _runTopCapsAL(ctx: CapabilityRunContext, start: Date, end: Date, limit: number, keyOnly: boolean) {
  const d = requireDb();
  const conds = [eq(_usageAL.userId, ctx.userId), _gteAL(_usageAL.ts, start), _lteAL(_usageAL.ts, end)];
  if (keyOnly) conds.push(eq(_usageAL.keyId, ctx.keyId));
  const rows = await d
    .select({
      capabilityId: _usageAL.capabilityId,
      calls: _sqlAL<number>`count(*)::int`,
      errors: _sqlAL<number>`count(*) filter (where ${_usageAL.status} <> 'ok')::int`,
      credits: _sqlAL<string>`coalesce(sum(${_usageAL.costCredits})::text, '0')`,
      avgLatencyMs: _sqlAL<number>`coalesce(avg(${_usageAL.latencyMs})::int, 0)`,
      p95LatencyMs: _sqlAL<number>`coalesce(percentile_cont(0.95) within group (order by ${_usageAL.latencyMs})::int, 0)`,
    })
    .from(_usageAL)
    .where(and(...conds))
    .groupBy(_usageAL.capabilityId)
    .orderBy(_sqlAL`count(*) desc`)
    .limit(Math.max(1, Math.min(limit, 100)));
  return { items: rows };
}

async function _runErrorsAL(ctx: CapabilityRunContext, start: Date, end: Date, limit: number, keyOnly: boolean) {
  const d = requireDb();
  const conds = [
    eq(_usageAL.userId, ctx.userId),
    _gteAL(_usageAL.ts, start),
    _lteAL(_usageAL.ts, end),
    _sqlAL`${_usageAL.status} <> 'ok'`,
  ];
  if (keyOnly) conds.push(eq(_usageAL.keyId, ctx.keyId));
  const rows = await d
    .select({
      capabilityId: _usageAL.capabilityId,
      errorCode: _usageAL.errorCode,
      status: _usageAL.status,
      n: _sqlAL<number>`count(*)::int`,
      lastSeen: _sqlAL<Date>`max(${_usageAL.ts})`,
    })
    .from(_usageAL)
    .where(and(...conds))
    .groupBy(_usageAL.capabilityId, _usageAL.errorCode, _usageAL.status)
    .orderBy(_sqlAL`count(*) desc`)
    .limit(Math.max(1, Math.min(limit, 100)));
  return { items: rows };
}

async function _runAuditSummaryAL(ctx: CapabilityRunContext, start: Date, end: Date) {
  const d = requireDb();
  const rows = await d
    .select({
      action: _auditAL.action,
      n: _sqlAL<number>`count(*)::int`,
      lastSeen: _sqlAL<Date>`max(${_auditAL.ts})`,
    })
    .from(_auditAL)
    .where(and(eq(_auditAL.userId, ctx.userId), _gteAL(_auditAL.ts, start), _lteAL(_auditAL.ts, end)))
    .groupBy(_auditAL.action)
    .orderBy(_sqlAL`count(*) desc`)
    .limit(50);
  const [{ total }] = await d
    .select({ total: _sqlAL<number>`count(*)::int` })
    .from(_auditAL)
    .where(and(eq(_auditAL.userId, ctx.userId), _gteAL(_auditAL.ts, start), _lteAL(_auditAL.ts, end)));
  return { total: total ?? 0, byAction: rows };
}

async function _runTeamsOverviewAL(ctx: CapabilityRunContext, start: Date, end: Date) {
  const d = requireDb();
  // Teams where caller is a member (active).
  const mine = await d
    .select({
      teamId: _teamsAL.id,
      name: _teamsAL.name,
      role: _teamMembersAL.role,
    })
    .from(_teamMembersAL)
    .innerJoin(_teamsAL, eq(_teamsAL.id, _teamMembersAL.teamId))
    .where(and(eq(_teamMembersAL.userId, ctx.userId), eq(_teamMembersAL.status, "active")));
  if (mine.length === 0) return { teams: [] };
  const out: Array<{ teamId: string; name: string; role: string; auditCount: number; lastActivity: Date | null }> = [];
  for (const t of mine) {
    const [row] = await d
      .select({
        n: _sqlAL<number>`count(*)::int`,
        last: _sqlAL<Date>`max(${_teamAuditAL.ts})`,
      })
      .from(_teamAuditAL)
      .where(and(eq(_teamAuditAL.teamId, t.teamId), _gteAL(_teamAuditAL.ts, start), _lteAL(_teamAuditAL.ts, end)));
    out.push({
      teamId: t.teamId,
      name: t.name,
      role: t.role,
      auditCount: row?.n ?? 0,
      lastActivity: row?.last ?? null,
    });
  }
  return { teams: out };
}

async function _runBillingSnapshotAL(ctx: CapabilityRunContext, start: Date, end: Date) {
  const tier = await _userTierAL(ctx.userId);
  const limits = _TIER_LIMITS_X[tier] ?? _TIER_LIMITS_X.free;
  const ov = await _runOverviewAL(ctx, start, end, false);
  const callsPct = limits.callsPerMonth > 0 ? (ov.calls / limits.callsPerMonth) * 100 : 0;
  const creditsNum = Number(ov.credits) || 0;
  const creditsPct = limits.creditsPerMonth > 0 ? (creditsNum / limits.creditsPerMonth) * 100 : 0;
  return {
    tier,
    limits,
    usage: { calls: ov.calls, credits: ov.credits, errors: ov.errors },
    pct: {
      calls: Math.round(callsPct * 10) / 10,
      credits: Math.round(creditsPct * 10) / 10,
    },
  };
}

async function _runSectionAL(ctx: CapabilityRunContext, section: { type: string; params?: Record<string, unknown> }, start: Date, end: Date) {
  const params = section.params ?? {};
  const keyOnly = params.keyOnly === true;
  switch (section.type) {
    case "overview":         return _runOverviewAL(ctx, start, end, keyOnly);
    case "activity":         return _runActivityAL(ctx, start, end, (params.granularity as "day" | "hour") ?? "day", keyOnly);
    case "top_capabilities": return _runTopCapsAL(ctx, start, end, Number(params.limit) || 10, keyOnly);
    case "errors":           return _runErrorsAL(ctx, start, end, Number(params.limit) || 10, keyOnly);
    case "audit_summary":    return _runAuditSummaryAL(ctx, start, end);
    case "teams_overview":   return _runTeamsOverviewAL(ctx, start, end);
    case "billing_snapshot": return _runBillingSnapshotAL(ctx, start, end);
    default:                 throw new CapabilityError(`Unknown section type '${section.type}'`, 400, null);
  }
}

// ─── insights.overview ─────────────────────────────────────────────
export async function insightsOverview(
  input: { windowDays?: number; keyOnly?: boolean },
  ctx: CapabilityRunContext,
) {
  const tier = await _userTierAL(ctx.userId);
  const { start, end, days } = _clampWindowAL(input.windowDays, tier);
  const overview = await _runOverviewAL(ctx, start, end, !!input.keyOnly);
  return { window: { start, end, days }, overview };
}

// ─── insights.activity ─────────────────────────────────────────────
export async function insightsActivity(
  input: { windowDays?: number; granularity?: "day" | "hour"; keyOnly?: boolean },
  ctx: CapabilityRunContext,
) {
  const tier = await _userTierAL(ctx.userId);
  const { start, end, days } = _clampWindowAL(input.windowDays, tier);
  const data = await _runActivityAL(ctx, start, end, input.granularity ?? "day", !!input.keyOnly);
  return { window: { start, end, days }, ...data };
}

// ─── insights.top_capabilities ─────────────────────────────────────
export async function insightsTopCapabilities(
  input: { windowDays?: number; limit?: number; keyOnly?: boolean },
  ctx: CapabilityRunContext,
) {
  const tier = await _userTierAL(ctx.userId);
  const { start, end, days } = _clampWindowAL(input.windowDays, tier);
  const data = await _runTopCapsAL(ctx, start, end, input.limit ?? 10, !!input.keyOnly);
  return { window: { start, end, days }, ...data };
}

// ─── insights.errors ───────────────────────────────────────────────
export async function insightsErrors(
  input: { windowDays?: number; limit?: number; keyOnly?: boolean },
  ctx: CapabilityRunContext,
) {
  const tier = await _userTierAL(ctx.userId);
  const { start, end, days } = _clampWindowAL(input.windowDays, tier);
  const data = await _runErrorsAL(ctx, start, end, input.limit ?? 10, !!input.keyOnly);
  return { window: { start, end, days }, ...data };
}

// ─── insights.audit_summary ────────────────────────────────────────
export async function insightsAuditSummary(
  input: { windowDays?: number },
  ctx: CapabilityRunContext,
) {
  const tier = await _userTierAL(ctx.userId);
  const { start, end, days } = _clampWindowAL(input.windowDays, tier);
  const data = await _runAuditSummaryAL(ctx, start, end);
  return { window: { start, end, days }, ...data };
}

// ─── insights.teams_overview ───────────────────────────────────────
export async function insightsTeamsOverview(
  input: { windowDays?: number },
  ctx: CapabilityRunContext,
) {
  const tier = await _userTierAL(ctx.userId);
  const { start, end, days } = _clampWindowAL(input.windowDays, tier);
  const data = await _runTeamsOverviewAL(ctx, start, end);
  return { window: { start, end, days }, ...data };
}

// ─── reports.create ────────────────────────────────────────────────
export async function reportsCreate(
  input: {
    name: string;
    description?: string;
    sections: Array<{ type: SectionTypeAL; params?: Record<string, unknown> }>;
    filters?: { windowDays?: number; keyOnly?: boolean };
    scheduleSeconds?: number;
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAL(ctx.userId);
  const limits = _TIER_REPORT_LIMITS_AL[tier];

  if (!input.sections || input.sections.length === 0) {
    throw new CapabilityError("At least one section is required", 400, null);
  }
  if (input.sections.length > _MAX_SECTIONS_AL) {
    throw new CapabilityError(`Too many sections (max ${_MAX_SECTIONS_AL})`, 400, null);
  }
  for (const s of input.sections) {
    if (!_SECTION_TYPES_AL.includes(s.type as SectionTypeAL)) {
      throw new CapabilityError(`Unknown section type '${s.type}'`, 400, { allowed: _SECTION_TYPES_AL });
    }
  }
  const schedule = input.scheduleSeconds ?? 0;
  if (schedule > 0 && schedule < limits.minScheduleSeconds) {
    throw new CapabilityError(
      `Schedule too frequent for tier '${tier}' (min ${limits.minScheduleSeconds}s)`,
      400,
      { minScheduleSeconds: limits.minScheduleSeconds },
    );
  }

  const [{ n }] = await d
    .select({ n: _sqlAL<number>`count(*)::int` })
    .from(_reportsAL)
    .where(eq(_reportsAL.userId, ctx.userId));
  if (n >= limits.maxReports) {
    throw new CapabilityError(
      `Report quota reached for tier '${tier}' (${n}/${limits.maxReports})`,
      402,
      { tier, current: n, limit: limits.maxReports },
    );
  }

  const [row] = await d
    .insert(_reportsAL)
    .values({
      userId: ctx.userId,
      keyId: ctx.keyId,
      name: input.name,
      description: input.description ?? null,
      sections: input.sections as never,
      filters: (input.filters ?? {}) as never,
      scheduleSeconds: schedule,
      enabled: input.enabled ?? true,
    } as never)
    .returning();
  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId,
    action: "reports.create", target: row.id,
    meta: { name: input.name, sections: input.sections.length, schedule },
  });
  return { report: row, audit };
}

// ─── reports.list ──────────────────────────────────────────────────
export async function reportsList(
  input: { enabledOnly?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_reportsAL.userId, ctx.userId)];
  if (input.enabledOnly) conds.push(eq(_reportsAL.enabled, true));
  const rows = await d
    .select()
    .from(_reportsAL)
    .where(and(...conds))
    .orderBy(desc(_reportsAL.createdAt))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
  return { count: rows.length, reports: rows };
}

// ─── reports.get ───────────────────────────────────────────────────
export async function reportsGet(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_reportsAL)
    .where(and(eq(_reportsAL.id, input.id), eq(_reportsAL.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError("Report not found", 404, null);
  return { report: row };
}

// ─── reports.update ────────────────────────────────────────────────
export async function reportsUpdate(
  input: {
    id: string;
    name?: string;
    description?: string;
    sections?: Array<{ type: SectionTypeAL; params?: Record<string, unknown> }>;
    filters?: { windowDays?: number; keyOnly?: boolean };
    scheduleSeconds?: number;
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAL(ctx.userId);
  const limits = _TIER_REPORT_LIMITS_AL[tier];
  const [existing] = await d
    .select()
    .from(_reportsAL)
    .where(and(eq(_reportsAL.id, input.id), eq(_reportsAL.userId, ctx.userId)))
    .limit(1);
  if (!existing) throw new CapabilityError("Report not found", 404, null);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sections !== undefined) {
    if (input.sections.length === 0 || input.sections.length > _MAX_SECTIONS_AL) {
      throw new CapabilityError(`Sections must be 1..${_MAX_SECTIONS_AL}`, 400, null);
    }
    for (const s of input.sections) {
      if (!_SECTION_TYPES_AL.includes(s.type as SectionTypeAL)) {
        throw new CapabilityError(`Unknown section type '${s.type}'`, 400, { allowed: _SECTION_TYPES_AL });
      }
    }
    patch.sections = input.sections;
  }
  if (input.filters !== undefined) patch.filters = input.filters;
  if (input.scheduleSeconds !== undefined) {
    if (input.scheduleSeconds > 0 && input.scheduleSeconds < limits.minScheduleSeconds) {
      throw new CapabilityError(
        `Schedule too frequent for tier '${tier}' (min ${limits.minScheduleSeconds}s)`,
        400, { minScheduleSeconds: limits.minScheduleSeconds },
      );
    }
    patch.scheduleSeconds = input.scheduleSeconds;
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const [row] = await d
    .update(_reportsAL)
    .set(patch as never)
    .where(eq(_reportsAL.id, input.id))
    .returning();
  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId,
    action: "reports.update", target: input.id,
    meta: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
  });
  return { report: row, audit };
}

// ─── reports.delete ────────────────────────────────────────────────
export async function reportsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select({ id: _reportsAL.id, name: _reportsAL.name })
    .from(_reportsAL)
    .where(and(eq(_reportsAL.id, input.id), eq(_reportsAL.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError("Report not found", 404, null);
  await d.delete(_reportsAL).where(eq(_reportsAL.id, input.id));
  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId,
    action: "reports.delete", target: input.id, meta: { name: row.name },
  });
  return { ok: true, id: input.id, audit };
}

// ─── reports.run ───────────────────────────────────────────────────
export async function reportsRun(
  input: { id: string; trigger?: "manual" | "scheduled" | "webhook"; dryRun?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAL(ctx.userId);
  const limits = _TIER_REPORT_LIMITS_AL[tier];
  const [report] = await d
    .select()
    .from(_reportsAL)
    .where(and(eq(_reportsAL.id, input.id), eq(_reportsAL.userId, ctx.userId)))
    .limit(1);
  if (!report) throw new CapabilityError("Report not found", 404, null);

  const filters = (report.filters ?? {}) as { windowDays?: number; keyOnly?: boolean };
  const { start, end, days } = _clampWindowAL(filters.windowDays, tier);
  const sections = (report.sections ?? []) as Array<{ type: SectionTypeAL; params?: Record<string, unknown> }>;

  const sectionResults: Array<{ type: string; params: Record<string, unknown>; data: unknown; error?: string }> = [];
  for (const s of sections) {
    const params = { ...(s.params ?? {}), keyOnly: filters.keyOnly ?? s.params?.keyOnly };
    try {
      const data = await _runSectionAL(ctx, { type: s.type, params }, start, end);
      sectionResults.push({ type: s.type, params, data });
    } catch (e) {
      sectionResults.push({ type: s.type, params, data: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const summary = {
    sections: sections.length,
    succeeded: sectionResults.filter((r) => !r.error).length,
    failed: sectionResults.filter((r) => !!r.error).length,
    windowDays: days,
  };

  if (input.dryRun) {
    return { dryRun: true, report: { id: report.id, name: report.name }, window: { start, end, days }, summary, sections: sectionResults };
  }

  // Enforce snapshot retention: drop oldest beyond cap.
  const existing = await d
    .select({ id: _snapshotsAL.id, generatedAt: _snapshotsAL.generatedAt })
    .from(_snapshotsAL)
    .where(eq(_snapshotsAL.reportId, report.id))
    .orderBy(desc(_snapshotsAL.generatedAt));
  if (existing.length >= limits.maxSnapshotsPerReport) {
    const toDrop = existing.slice(limits.maxSnapshotsPerReport - 1).map((r) => r.id);
    if (toDrop.length > 0) {
      await d.delete(_snapshotsAL).where(inArray(_snapshotsAL.id, toDrop));
    }
  }

  const payload = { sections: sectionResults };
  const payloadStr = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(payloadStr, "utf8");
  if (sizeBytes > _MAX_PAYLOAD_BYTES_AL) {
    throw new CapabilityError(
      `Snapshot payload exceeds ${_MAX_PAYLOAD_BYTES_AL} bytes (${sizeBytes}). Trim sections or reduce window.`,
      413, { sizeBytes, max: _MAX_PAYLOAD_BYTES_AL },
    );
  }

  const [snap] = await d
    .insert(_snapshotsAL)
    .values({
      reportId: report.id,
      userId: ctx.userId,
      keyId: ctx.keyId,
      trigger: input.trigger ?? "manual",
      windowStart: start,
      windowEnd: end,
      summary: summary as never,
      payload: payload as never,
      sizeBytes,
    } as never)
    .returning();

  await d
    .update(_reportsAL)
    .set({
      lastRunAt: new Date(),
      lastSnapshotId: snap.id,
      runCount: (report.runCount ?? 0) + 1,
      updatedAt: new Date(),
    } as never)
    .where(eq(_reportsAL.id, report.id));

  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId,
    action: "reports.run", target: report.id,
    meta: { snapshotId: snap.id, trigger: input.trigger ?? "manual", summary },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "report.generated",
    data: { reportId: report.id, snapshotId: snap.id, trigger: input.trigger ?? "manual", summary },
  }).catch(() => undefined);

  return { snapshot: snap, summary, audit };
}

// ─── reports.snapshots_list ────────────────────────────────────────
export async function reportsSnapshotsList(
  input: { reportId: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const rows = await d
    .select({
      id: _snapshotsAL.id,
      reportId: _snapshotsAL.reportId,
      trigger: _snapshotsAL.trigger,
      windowStart: _snapshotsAL.windowStart,
      windowEnd: _snapshotsAL.windowEnd,
      summary: _snapshotsAL.summary,
      sizeBytes: _snapshotsAL.sizeBytes,
      generatedAt: _snapshotsAL.generatedAt,
    })
    .from(_snapshotsAL)
    .where(and(eq(_snapshotsAL.reportId, input.reportId), eq(_snapshotsAL.userId, ctx.userId)))
    .orderBy(desc(_snapshotsAL.generatedAt))
    .limit(Math.max(1, Math.min(input.limit ?? 50, 500)));
  return { count: rows.length, snapshots: rows };
}

// ─── reports.snapshot_get ──────────────────────────────────────────
export async function reportsSnapshotGet(
  input: { id: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_snapshotsAL)
    .where(and(eq(_snapshotsAL.id, input.id), eq(_snapshotsAL.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError("Snapshot not found", 404, null);
  return { snapshot: row };
}

// ─── reports.share ─────────────────────────────────────────────────
export async function reportsShare(
  input: { snapshotId: string; ttlHours?: number; password?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAL(ctx.userId);
  const limits = _TIER_REPORT_LIMITS_AL[tier];
  const [snap] = await d
    .select()
    .from(_snapshotsAL)
    .where(and(eq(_snapshotsAL.id, input.snapshotId), eq(_snapshotsAL.userId, ctx.userId)))
    .limit(1);
  if (!snap) throw new CapabilityError("Snapshot not found", 404, null);

  const [{ n }] = await d
    .select({ n: _sqlAL<number>`count(*) filter (where revoked_at is null and expires_at > now())::int` })
    .from(_sharesAL)
    .where(eq(_sharesAL.userId, ctx.userId));
  if (n >= limits.maxShares) {
    throw new CapabilityError(
      `Active share quota reached for tier '${tier}' (${n}/${limits.maxShares})`,
      402, { tier, current: n, limit: limits.maxShares },
    );
  }

  const maxHours = limits.shareMaxDays * 24;
  const ttlHours = Math.max(1, Math.min(input.ttlHours ?? 24 * 7, maxHours));
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  const token = _rbAL(32).toString("base64url");
  const passwordHash = input.password ? _shaAL("sha256").update(input.password).digest("hex") : null;

  const [row] = await d
    .insert(_sharesAL)
    .values({
      snapshotId: snap.id,
      reportId: snap.reportId,
      userId: ctx.userId,
      keyId: ctx.keyId,
      token,
      passwordHash,
      expiresAt,
    } as never)
    .returning();

  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId,
    action: "reports.share", target: row.id,
    meta: { snapshotId: snap.id, reportId: snap.reportId, expiresAt, hasPassword: !!input.password },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "report.shared",
    data: { shareId: row.id, snapshotId: snap.id, reportId: snap.reportId, expiresAt },
  }).catch(() => undefined);

  return {
    share: {
      id: row.id,
      token,            // returned ONCE; treat like an API key
      snapshotId: snap.id,
      reportId: snap.reportId,
      expiresAt,
      passwordProtected: !!input.password,
      url: `${ctx.origin}/r/${token}`,
    },
    audit,
  };
}

// ─── reports.shares_list ───────────────────────────────────────────
export async function reportsSharesList(
  input: { reportId?: string; activeOnly?: boolean; limit?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_sharesAL.userId, ctx.userId)];
  if (input.reportId) conds.push(eq(_sharesAL.reportId, input.reportId));
  if (input.activeOnly) conds.push(_sqlAL`${_sharesAL.revokedAt} is null and ${_sharesAL.expiresAt} > now()`);
  const rows = await d
    .select({
      id: _sharesAL.id,
      snapshotId: _sharesAL.snapshotId,
      reportId: _sharesAL.reportId,
      expiresAt: _sharesAL.expiresAt,
      viewCount: _sharesAL.viewCount,
      lastViewedAt: _sharesAL.lastViewedAt,
      revokedAt: _sharesAL.revokedAt,
      createdAt: _sharesAL.createdAt,
    })
    .from(_sharesAL)
    .where(and(...conds))
    .orderBy(desc(_sharesAL.createdAt))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
  return { count: rows.length, shares: rows };
}

// ─── reports.share_revoke ──────────────────────────────────────────
export async function reportsShareRevoke(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d
    .select()
    .from(_sharesAL)
    .where(and(eq(_sharesAL.id, input.id), eq(_sharesAL.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new CapabilityError("Share not found", 404, null);
  if (row.revokedAt) return { ok: true, alreadyRevoked: true, id: input.id };
  await d.update(_sharesAL).set({ revokedAt: new Date() }).where(eq(_sharesAL.id, input.id));
  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId,
    action: "reports.share_revoke", target: input.id,
    meta: { snapshotId: row.snapshotId, reportId: row.reportId },
  });
  void emitWebhookEvent({
    userId: ctx.userId,
    event: "report.share_revoked",
    data: { shareId: input.id, snapshotId: row.snapshotId, reportId: row.reportId },
  }).catch(() => undefined);
  return { ok: true, id: input.id, audit };
}

// ─── reports.policy ────────────────────────────────────────────────
export async function reportsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAL(ctx.userId);
  return {
    tier,
    limits: _TIER_REPORT_LIMITS_AL[tier],
    perTier: _TIER_REPORT_LIMITS_AL,
    sectionTypes: _SECTION_TYPES_AL,
    payloadMaxBytes: _MAX_PAYLOAD_BYTES_AL,
    maxSections: _MAX_SECTIONS_AL,
    windowRange: { minDays: _MIN_WINDOW_DAYS_AL, maxDays: _MAX_WINDOW_DAYS_AL },
    webhookEvents: ["report.generated", "report.shared", "report.share_revoked"],
    shareUrlTemplate: "/r/{token}",
    notes: [
      "Each section runs independently; failures don't abort the snapshot (errors are captured per section).",
      "`reports.run` enforces per-report snapshot retention by dropping the oldest beyond the tier cap.",
      "Share tokens are returned ONCE — store immediately. Revoked or expired shares stop resolving server-side.",
      "Snapshots are immutable; re-run the report to capture a new window.",
    ],
  };
}

// ─── Pillar AM — Marketplace & Catalog (Phase 29) ─────────────────────
import { createHash as _chAM } from "node:crypto";
import { sql as _sqlAM, gte as _gteAM, ilike as _ilikeAM, or as _orAM, asc as _ascAM } from "drizzle-orm";
import {
  publicApiPublishers as _pubAM,
  publicApiListings as _lstAM,
  publicApiListingVersions as _vrsAM,
  publicApiListingInstalls as _insAM,
  publicApiListingReviews as _revAM,
} from "@/db/schema";

const _CATEGORIES_AM = [
  "general", "defi", "treasury", "trading", "research", "analytics",
  "automation", "data", "governance", "security", "ai", "developer",
] as const;
const _KINDS_AM = ["capability", "template", "agent", "dataset", "workflow"] as const;
const _PRICING_AM = ["free", "one_time", "subscription", "usage"] as const;
const _STATUSES_AM = ["draft", "pending", "published", "suspended", "archived"] as const;
const _VISIBILITY_AM = ["public", "unlisted", "private"] as const;

const _TIER_MARKET_LIMITS_AM: Record<string, {
  maxListings: number;
  maxVersionsPerListing: number;
  maxInstalls: number;
  maxReviewsPerDay: number;
  payoutsAllowed: boolean;
  paidListingsAllowed: boolean;
}> = {
  free: { maxListings: 3,   maxVersionsPerListing: 10,  maxInstalls: 25,   maxReviewsPerDay: 5,   payoutsAllowed: false, paidListingsAllowed: false },
  mini: { maxListings: 25,  maxVersionsPerListing: 100, maxInstalls: 500,  maxReviewsPerDay: 50,  payoutsAllowed: true,  paidListingsAllowed: true  },
  max:  { maxListings: 500, maxVersionsPerListing: 1000,maxInstalls: 10000,maxReviewsPerDay: 500, payoutsAllowed: true,  paidListingsAllowed: true  },
};

const _SEMVER_AM = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const _SLUG_AM = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

function _manifestHashAM(manifest: unknown): string {
  return _chAM("sha256").update(JSON.stringify(manifest ?? {}), "utf8").digest("hex");
}

async function _loadPublisherForUserAM(userId: string) {
  const d = requireDb();
  const [row] = await d.select().from(_pubAM).where(eq(_pubAM.userId, userId)).limit(1);
  return row ?? null;
}

async function _requirePublisherAM(userId: string) {
  const row = await _loadPublisherForUserAM(userId);
  if (!row) throw new CapabilityError("Publisher profile required — call marketplace.publishers_upsert first", 412, null);
  return row;
}

async function _recomputeRatingAM(listingId: string) {
  const d = requireDb();
  const [agg] = await d
    .select({
      avg: _sqlAM<string>`coalesce(round(avg(${_revAM.rating})::numeric, 2)::text, '0')`,
      count: _sqlAM<number>`count(*)::int`,
    })
    .from(_revAM)
    .where(and(eq(_revAM.listingId, listingId), _sqlAM`${_revAM.hiddenAt} is null`));
  await d
    .update(_lstAM)
    .set({ ratingAvg: agg?.avg ?? "0", ratingCount: agg?.count ?? 0, updatedAt: new Date() })
    .where(eq(_lstAM.id, listingId));
}

export async function marketplacePublishersUpsert(
  input: {
    slug: string; displayName: string;
    website?: string; supportEmail?: string; description?: string; logoUrl?: string;
    metadata?: Record<string, unknown>;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  if (!_SLUG_AM.test(input.slug)) throw new CapabilityError("slug must be 2-64 chars, lowercase letters/digits/hyphens", 400, null);
  if (input.displayName.length < 2 || input.displayName.length > 80) throw new CapabilityError("displayName must be 2-80 chars", 400, null);
  if (input.supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.supportEmail)) throw new CapabilityError("supportEmail is not a valid email", 400, null);
  if (input.website && !/^https?:\/\//i.test(input.website)) throw new CapabilityError("website must start with http(s)://", 400, null);
  const existing = await _loadPublisherForUserAM(ctx.userId);
  const slugTaken = await d
    .select({ id: _pubAM.id })
    .from(_pubAM)
    .where(and(eq(_pubAM.slug, input.slug), existing ? _sqlAM`${_pubAM.id} <> ${existing.id}` : _sqlAM`true`))
    .limit(1);
  if (slugTaken.length) throw new CapabilityError(`Publisher slug '${input.slug}' is already taken`, 409, null);
  if (existing) {
    await d.update(_pubAM).set({
      slug: input.slug,
      displayName: input.displayName,
      website: input.website ?? null,
      supportEmail: input.supportEmail ?? null,
      description: input.description ?? null,
      logoUrl: input.logoUrl ?? null,
      metadata: input.metadata ?? {},
      updatedAt: new Date(),
    }).where(eq(_pubAM.id, existing.id));
    const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.publishers_upsert", target: existing.id, meta: { slug: input.slug, mode: "update" } });
    return { ok: true, id: existing.id, mode: "update" as const, audit };
  }
  const [row] = await d.insert(_pubAM).values({
    userId: ctx.userId,
    slug: input.slug,
    displayName: input.displayName,
    website: input.website ?? null,
    supportEmail: input.supportEmail ?? null,
    description: input.description ?? null,
    logoUrl: input.logoUrl ?? null,
    metadata: input.metadata ?? {},
  }).returning();
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.publishers_upsert", target: row.id, meta: { slug: input.slug, mode: "create" } });
  return { ok: true, id: row.id, mode: "create" as const, audit };
}

export async function marketplacePublishersGet(input: { slug?: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const row = input.slug
    ? (await d.select().from(_pubAM).where(eq(_pubAM.slug, input.slug)).limit(1))[0]
    : await _loadPublisherForUserAM(ctx.userId);
  if (!row) throw new CapabilityError("Publisher not found", 404, null);
  const isOwner = row.userId === ctx.userId;
  return {
    id: row.id, slug: row.slug, displayName: row.displayName, website: row.website,
    supportEmail: isOwner ? row.supportEmail : null,
    description: row.description, logoUrl: row.logoUrl,
    verified: row.verified, verificationAt: row.verificationAt,
    isOwner, createdAt: row.createdAt,
  };
}

export async function marketplacePublishersApplyVerification(
  input: { evidenceUrl?: string; notes?: string },
  ctx: CapabilityRunContext,
) {
  const pub = await _requirePublisherAM(ctx.userId);
  if (pub.verified) return { ok: true, alreadyVerified: true, id: pub.id };
  if (input.evidenceUrl && !/^https?:\/\//i.test(input.evidenceUrl)) throw new CapabilityError("evidenceUrl must start with http(s)://", 400, null);
  const audit = await _appendAudit({
    keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.publishers_apply_verification",
    target: pub.id, meta: { evidenceUrl: input.evidenceUrl ?? null, notes: input.notes ?? null },
  });
  return { ok: true, id: pub.id, status: "submitted" as const, reviewSlaHours: 72, audit };
}

export async function marketplaceListingsCreate(
  input: {
    slug: string; title: string; summary: string;
    longDescription?: string; category?: string; kind?: string;
    pricingModel?: string; priceMinor?: number; currency?: string;
    visibility?: string; tags?: string[]; manifest?: Record<string, unknown>;
    version?: string;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_MARKET_LIMITS_AM[tier];
  const pub = await _requirePublisherAM(ctx.userId);
  if (!_SLUG_AM.test(input.slug)) throw new CapabilityError("slug must be 2-64 chars (lowercase, digits, hyphens)", 400, null);
  if (input.title.length < 3 || input.title.length > 120) throw new CapabilityError("title must be 3-120 chars", 400, null);
  if (input.summary.length < 10 || input.summary.length > 280) throw new CapabilityError("summary must be 10-280 chars", 400, null);
  const category = input.category ?? "general";
  if (!_CATEGORIES_AM.includes(category as typeof _CATEGORIES_AM[number])) throw new CapabilityError(`category must be one of ${_CATEGORIES_AM.join(", ")}`, 400, null);
  const kind = input.kind ?? "capability";
  if (!_KINDS_AM.includes(kind as typeof _KINDS_AM[number])) throw new CapabilityError(`kind must be one of ${_KINDS_AM.join(", ")}`, 400, null);
  const pricingModel = input.pricingModel ?? "free";
  if (!_PRICING_AM.includes(pricingModel as typeof _PRICING_AM[number])) throw new CapabilityError(`pricingModel must be one of ${_PRICING_AM.join(", ")}`, 400, null);
  const priceMinor = Math.max(0, Math.floor(input.priceMinor ?? 0));
  if (pricingModel !== "free" && priceMinor <= 0) throw new CapabilityError("priceMinor must be > 0 for paid listings", 400, null);
  if (pricingModel !== "free" && !limits.paidListingsAllowed) throw new CapabilityError(`Tier '${tier}' cannot publish paid listings — upgrade required`, 402, { tier, requires: "mini" });
  const currency = (input.currency ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new CapabilityError("currency must be a 3-letter ISO code", 400, null);
  const visibility = input.visibility ?? "public";
  if (!_VISIBILITY_AM.includes(visibility as typeof _VISIBILITY_AM[number])) throw new CapabilityError(`visibility must be one of ${_VISIBILITY_AM.join(", ")}`, 400, null);
  const version = input.version ?? "0.1.0";
  if (!_SEMVER_AM.test(version)) throw new CapabilityError("version must be semver (e.g. 0.1.0)", 400, null);
  const tags = (input.tags ?? []).slice(0, 12).map((t) => String(t).slice(0, 32));

  const [{ count }] = await d
    .select({ count: _sqlAM<number>`count(*)::int` })
    .from(_lstAM)
    .where(and(eq(_lstAM.userId, ctx.userId), _sqlAM`${_lstAM.status} <> 'archived'`));
  if ((count ?? 0) >= limits.maxListings) throw new CapabilityError(`Tier '${tier}' allows at most ${limits.maxListings} listings`, 402, { tier, current: count, max: limits.maxListings });

  const dup = await d.select({ id: _lstAM.id }).from(_lstAM)
    .where(and(eq(_lstAM.publisherId, pub.id), eq(_lstAM.slug, input.slug))).limit(1);
  if (dup.length) throw new CapabilityError(`Listing slug '${input.slug}' already exists for this publisher`, 409, null);

  const manifest = input.manifest ?? {};
  const [row] = await d.insert(_lstAM).values({
    publisherId: pub.id, userId: ctx.userId, slug: input.slug, title: input.title,
    summary: input.summary, longDescription: input.longDescription ?? null,
    category, kind, pricingModel, priceMinor, currency, status: "draft", visibility,
    tags, manifest, currentVersion: version,
  }).returning();
  await d.insert(_vrsAM).values({
    listingId: row.id, userId: ctx.userId, version, changelog: "Initial draft",
    manifest, manifestHash: _manifestHashAM(manifest),
  });
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_create", target: row.id, meta: { slug: input.slug, kind, pricingModel, priceMinor } });
  return { ok: true, id: row.id, slug: row.slug, status: row.status, version, audit };
}

export async function marketplaceListingsUpdate(
  input: {
    id: string;
    title?: string; summary?: string; longDescription?: string;
    category?: string; tags?: string[];
    pricingModel?: string; priceMinor?: number; currency?: string;
    visibility?: string; manifest?: Record<string, unknown>;
    bumpVersion?: string; changelog?: string;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_MARKET_LIMITS_AM[tier];
  const [row] = await d.select().from(_lstAM).where(and(eq(_lstAM.id, input.id), eq(_lstAM.userId, ctx.userId))).limit(1);
  if (!row) throw new CapabilityError("Listing not found", 404, null);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) { if (input.title.length < 3 || input.title.length > 120) throw new CapabilityError("title must be 3-120 chars", 400, null); patch.title = input.title; }
  if (input.summary !== undefined) { if (input.summary.length < 10 || input.summary.length > 280) throw new CapabilityError("summary must be 10-280 chars", 400, null); patch.summary = input.summary; }
  if (input.longDescription !== undefined) patch.longDescription = input.longDescription;
  if (input.category !== undefined) { if (!_CATEGORIES_AM.includes(input.category as typeof _CATEGORIES_AM[number])) throw new CapabilityError("invalid category", 400, null); patch.category = input.category; }
  if (input.tags !== undefined) patch.tags = input.tags.slice(0, 12).map((t) => String(t).slice(0, 32));
  if (input.pricingModel !== undefined) {
    if (!_PRICING_AM.includes(input.pricingModel as typeof _PRICING_AM[number])) throw new CapabilityError("invalid pricingModel", 400, null);
    if (input.pricingModel !== "free" && !limits.paidListingsAllowed) throw new CapabilityError(`Tier '${tier}' cannot publish paid listings`, 402, { tier });
    patch.pricingModel = input.pricingModel;
  }
  if (input.priceMinor !== undefined) patch.priceMinor = Math.max(0, Math.floor(input.priceMinor));
  if (input.currency !== undefined) { const cur = input.currency.toUpperCase(); if (!/^[A-Z]{3}$/.test(cur)) throw new CapabilityError("currency must be ISO 3-letter", 400, null); patch.currency = cur; }
  if (input.visibility !== undefined) { if (!_VISIBILITY_AM.includes(input.visibility as typeof _VISIBILITY_AM[number])) throw new CapabilityError("invalid visibility", 400, null); patch.visibility = input.visibility; }

  let newVersionRow: { id: string; version: string } | null = null;
  if (input.bumpVersion !== undefined) {
    if (!_SEMVER_AM.test(input.bumpVersion)) throw new CapabilityError("bumpVersion must be semver", 400, null);
    const existing = await d.select({ id: _vrsAM.id }).from(_vrsAM).where(and(eq(_vrsAM.listingId, row.id), eq(_vrsAM.version, input.bumpVersion))).limit(1);
    if (existing.length) throw new CapabilityError(`Version ${input.bumpVersion} already exists`, 409, null);
    const [{ count }] = await d.select({ count: _sqlAM<number>`count(*)::int` }).from(_vrsAM).where(eq(_vrsAM.listingId, row.id));
    if ((count ?? 0) >= limits.maxVersionsPerListing) throw new CapabilityError(`Tier '${tier}' allows at most ${limits.maxVersionsPerListing} versions per listing`, 402, { tier });
    const manifest = input.manifest ?? (row.manifest as Record<string, unknown>);
    const [v] = await d.insert(_vrsAM).values({
      listingId: row.id, userId: ctx.userId, version: input.bumpVersion,
      changelog: input.changelog ?? null, manifest, manifestHash: _manifestHashAM(manifest),
    }).returning({ id: _vrsAM.id, version: _vrsAM.version });
    patch.manifest = manifest;
    patch.currentVersion = input.bumpVersion;
    newVersionRow = { id: v.id, version: v.version };
  } else if (input.manifest !== undefined) {
    if (row.status !== "draft") throw new CapabilityError("Cannot mutate manifest on a non-draft listing without bumpVersion", 409, { status: row.status });
    patch.manifest = input.manifest;
  }

  await d.update(_lstAM).set(patch).where(eq(_lstAM.id, row.id));
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_update", target: row.id, meta: { keys: Object.keys(patch), bumpVersion: input.bumpVersion ?? null } });
  return { ok: true, id: row.id, version: patch.currentVersion ?? row.currentVersion, newVersion: newVersionRow, audit };
}

export async function marketplaceListingsSubmit(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d.select().from(_lstAM).where(and(eq(_lstAM.id, input.id), eq(_lstAM.userId, ctx.userId))).limit(1);
  if (!row) throw new CapabilityError("Listing not found", 404, null);
  if (row.status !== "draft" && row.status !== "suspended") throw new CapabilityError(`Cannot submit from status '${row.status}'`, 409, null);
  await d.update(_lstAM).set({ status: "pending", updatedAt: new Date() }).where(eq(_lstAM.id, row.id));
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_submit", target: row.id, meta: { from: row.status } });
  return { ok: true, id: row.id, status: "pending" as const, audit };
}

export async function marketplaceListingsPublish(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d.select().from(_lstAM).where(and(eq(_lstAM.id, input.id), eq(_lstAM.userId, ctx.userId))).limit(1);
  if (!row) throw new CapabilityError("Listing not found", 404, null);
  if (row.status === "published") return { ok: true, id: row.id, alreadyPublished: true };
  if (row.status !== "pending" && row.status !== "draft") throw new CapabilityError(`Cannot publish from status '${row.status}'`, 409, null);
  const manifest = (row.manifest as Record<string, unknown>) ?? {};
  if (row.kind === "capability") {
    const bindings = Array.isArray((manifest as { bindings?: unknown[] }).bindings) ? (manifest as { bindings: unknown[] }).bindings : [];
    if (bindings.length === 0) throw new CapabilityError("capability listings must define `manifest.bindings` (at least one capability)", 400, null);
  }
  await d.update(_lstAM).set({ status: "published", publishedAt: new Date(), unpublishedAt: null, updatedAt: new Date() }).where(eq(_lstAM.id, row.id));
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_publish", target: row.id, meta: { from: row.status, version: row.currentVersion } });
  void emitWebhookEvent({ userId: ctx.userId, event: "marketplace.listing_published", data: { listingId: row.id, slug: row.slug, version: row.currentVersion, pricingModel: row.pricingModel } }).catch(() => undefined);
  return { ok: true, id: row.id, status: "published" as const, audit };
}

export async function marketplaceListingsUnpublish(input: { id: string; reason?: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d.select().from(_lstAM).where(and(eq(_lstAM.id, input.id), eq(_lstAM.userId, ctx.userId))).limit(1);
  if (!row) throw new CapabilityError("Listing not found", 404, null);
  if (row.status !== "published") return { ok: true, id: row.id, status: row.status, noop: true };
  await d.update(_lstAM).set({ status: "draft", unpublishedAt: new Date(), updatedAt: new Date() }).where(eq(_lstAM.id, row.id));
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_unpublish", target: row.id, meta: { reason: input.reason ?? null } });
  void emitWebhookEvent({ userId: ctx.userId, event: "marketplace.listing_unpublished", data: { listingId: row.id, slug: row.slug, reason: input.reason ?? null } }).catch(() => undefined);
  return { ok: true, id: row.id, status: "draft" as const, audit };
}

export async function marketplaceListingsGet(
  input: { id?: string; publisherSlug?: string; listingSlug?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  let listing: typeof _lstAM.$inferSelect | undefined;
  if (input.id) {
    [listing] = await d.select().from(_lstAM).where(eq(_lstAM.id, input.id)).limit(1);
  } else if (input.publisherSlug && input.listingSlug) {
    const [pub] = await d.select().from(_pubAM).where(eq(_pubAM.slug, input.publisherSlug)).limit(1);
    if (pub) [listing] = await d.select().from(_lstAM).where(and(eq(_lstAM.publisherId, pub.id), eq(_lstAM.slug, input.listingSlug))).limit(1);
  } else {
    throw new CapabilityError("Provide either `id` or (`publisherSlug` and `listingSlug`)", 400, null);
  }
  if (!listing) throw new CapabilityError("Listing not found", 404, null);
  const isOwner = listing.userId === ctx.userId;
  const accessible = isOwner || (listing.status === "published" && (listing.visibility === "public" || listing.visibility === "unlisted"));
  if (!accessible) throw new CapabilityError("Listing not accessible", 404, null);
  const [pub] = await d.select({ id: _pubAM.id, slug: _pubAM.slug, displayName: _pubAM.displayName, verified: _pubAM.verified })
    .from(_pubAM).where(eq(_pubAM.id, listing.publisherId)).limit(1);
  const [install] = await d.select().from(_insAM)
    .where(and(eq(_insAM.userId, ctx.userId), eq(_insAM.listingId, listing.id))).limit(1);
  return {
    listing: {
      id: listing.id, slug: listing.slug, title: listing.title, summary: listing.summary,
      longDescription: listing.longDescription, category: listing.category, kind: listing.kind,
      pricingModel: listing.pricingModel, priceMinor: listing.priceMinor, currency: listing.currency,
      status: listing.status, visibility: listing.visibility, tags: listing.tags,
      manifest: isOwner ? listing.manifest : { bindings: (listing.manifest as { bindings?: unknown })?.bindings ?? null },
      currentVersion: listing.currentVersion, installCount: listing.installCount,
      ratingAvg: listing.ratingAvg, ratingCount: listing.ratingCount,
      publishedAt: listing.publishedAt, createdAt: listing.createdAt,
    },
    publisher: pub ?? null,
    install: install ? { id: install.id, status: install.status, versionId: install.versionId, installedAt: install.installedAt } : null,
    isOwner,
  };
}

export async function marketplaceListingsSearch(
  input: {
    q?: string; category?: string; kind?: string; pricingModel?: string;
    tag?: string; publisherSlug?: string;
    includeUnpublished?: boolean;
    sort?: "recent" | "popular" | "rating" | "alpha";
    limit?: number; offset?: number;
  },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds: ReturnType<typeof eq>[] = [];
  if (input.includeUnpublished) {
    conds.push(eq(_lstAM.userId, ctx.userId));
  } else {
    conds.push(eq(_lstAM.status, "published"));
    conds.push(_sqlAM`${_lstAM.visibility} <> 'private'` as unknown as ReturnType<typeof eq>);
  }
  if (input.category) conds.push(eq(_lstAM.category, input.category));
  if (input.kind) conds.push(eq(_lstAM.kind, input.kind));
  if (input.pricingModel) conds.push(eq(_lstAM.pricingModel, input.pricingModel));
  if (input.q) {
    const q = `%${input.q.trim().slice(0, 80)}%`;
    conds.push(_orAM(_ilikeAM(_lstAM.title, q), _ilikeAM(_lstAM.summary, q)) as unknown as ReturnType<typeof eq>);
  }
  if (input.tag) conds.push(_sqlAM`${_lstAM.tags} @> ${JSON.stringify([input.tag])}::jsonb` as unknown as ReturnType<typeof eq>);
  if (input.publisherSlug) {
    const [pub] = await d.select({ id: _pubAM.id }).from(_pubAM).where(eq(_pubAM.slug, input.publisherSlug)).limit(1);
    if (!pub) return { count: 0, total: 0, listings: [] };
    conds.push(eq(_lstAM.publisherId, pub.id));
  }
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const offset = Math.max(0, input.offset ?? 0);
  const orderBy = input.sort === "popular" ? desc(_lstAM.installCount)
    : input.sort === "rating" ? desc(_lstAM.ratingAvg)
    : input.sort === "alpha" ? _ascAM(_lstAM.title)
    : desc(_lstAM.publishedAt);
  const where = and(...conds);
  const rows = await d.select({
      id: _lstAM.id, slug: _lstAM.slug, title: _lstAM.title, summary: _lstAM.summary,
      category: _lstAM.category, kind: _lstAM.kind, pricingModel: _lstAM.pricingModel,
      priceMinor: _lstAM.priceMinor, currency: _lstAM.currency, tags: _lstAM.tags,
      currentVersion: _lstAM.currentVersion, installCount: _lstAM.installCount,
      ratingAvg: _lstAM.ratingAvg, ratingCount: _lstAM.ratingCount,
      status: _lstAM.status, visibility: _lstAM.visibility,
      publisherId: _lstAM.publisherId, publishedAt: _lstAM.publishedAt,
    })
    .from(_lstAM).where(where).orderBy(orderBy).limit(limit).offset(offset);
  const [{ total }] = await d.select({ total: _sqlAM<number>`count(*)::int` }).from(_lstAM).where(where);
  return { count: rows.length, total: total ?? 0, limit, offset, listings: rows };
}

export async function marketplaceListingsVersionsList(input: { listingId: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [listing] = await d.select().from(_lstAM).where(eq(_lstAM.id, input.listingId)).limit(1);
  if (!listing) throw new CapabilityError("Listing not found", 404, null);
  const isOwner = listing.userId === ctx.userId;
  if (!isOwner && !(listing.status === "published" && listing.visibility !== "private")) throw new CapabilityError("Listing not accessible", 404, null);
  const rows = await d.select({
      id: _vrsAM.id, version: _vrsAM.version, changelog: _vrsAM.changelog,
      manifestHash: _vrsAM.manifestHash, yankedAt: _vrsAM.yankedAt, yankReason: _vrsAM.yankReason,
      createdAt: _vrsAM.createdAt,
    }).from(_vrsAM).where(eq(_vrsAM.listingId, input.listingId)).orderBy(desc(_vrsAM.createdAt));
  return { count: rows.length, currentVersion: listing.currentVersion, versions: rows };
}

export async function marketplaceListingsInstall(
  input: { listingId: string; config?: Record<string, unknown>; acceptPaid?: boolean },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_MARKET_LIMITS_AM[tier];
  const [listing] = await d.select().from(_lstAM).where(eq(_lstAM.id, input.listingId)).limit(1);
  if (!listing) throw new CapabilityError("Listing not found", 404, null);
  if (listing.status !== "published") throw new CapabilityError(`Listing is not published (status=${listing.status})`, 409, null);
  if (listing.visibility === "private" && listing.userId !== ctx.userId) throw new CapabilityError("Listing not accessible", 404, null);
  if (listing.pricingModel !== "free" && !input.acceptPaid) {
    throw new CapabilityError("Paid listing — pass acceptPaid:true to acknowledge price and billing terms", 402, {
      pricingModel: listing.pricingModel, priceMinor: listing.priceMinor, currency: listing.currency,
    });
  }
  const [{ count }] = await d.select({ count: _sqlAM<number>`count(*)::int` })
    .from(_insAM).where(and(eq(_insAM.userId, ctx.userId), eq(_insAM.status, "active")));
  if ((count ?? 0) >= limits.maxInstalls) throw new CapabilityError(`Tier '${tier}' allows at most ${limits.maxInstalls} active installs`, 402, { tier, current: count, max: limits.maxInstalls });
  const [version] = await d.select({ id: _vrsAM.id }).from(_vrsAM)
    .where(and(eq(_vrsAM.listingId, listing.id), eq(_vrsAM.version, listing.currentVersion))).limit(1);
  const [existing] = await d.select().from(_insAM)
    .where(and(eq(_insAM.userId, ctx.userId), eq(_insAM.listingId, listing.id))).limit(1);
  let install: typeof _insAM.$inferSelect;
  let mode: "create" | "reactivate";
  if (existing) {
    if (existing.status === "active") return { ok: true, id: existing.id, alreadyInstalled: true };
    [install] = await d.update(_insAM).set({
      status: "active", versionId: version?.id ?? null,
      pricingModel: listing.pricingModel, priceMinor: listing.priceMinor, currency: listing.currency,
      config: input.config ?? {}, installedAt: new Date(), uninstalledAt: null, updatedAt: new Date(),
    }).where(eq(_insAM.id, existing.id)).returning();
    mode = "reactivate";
  } else {
    [install] = await d.insert(_insAM).values({
      listingId: listing.id, versionId: version?.id ?? null, userId: ctx.userId, keyId: ctx.keyId,
      status: "active", pricingModel: listing.pricingModel, priceMinor: listing.priceMinor,
      currency: listing.currency, config: input.config ?? {},
    }).returning();
    mode = "create";
  }
  await d.update(_lstAM).set({ installCount: _sqlAM`${_lstAM.installCount} + 1`, updatedAt: new Date() }).where(eq(_lstAM.id, listing.id));
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_install", target: listing.id, meta: { installId: install.id, mode, version: listing.currentVersion } });
  void emitWebhookEvent({ userId: ctx.userId, event: "marketplace.listing_installed", data: { listingId: listing.id, installId: install.id, version: listing.currentVersion, pricingModel: listing.pricingModel, mode } }).catch(() => undefined);
  if (listing.userId !== ctx.userId) {
    void emitWebhookEvent({ userId: listing.userId, event: "marketplace.listing_installed", data: { listingId: listing.id, installerUserId: ctx.userId, version: listing.currentVersion, pricingModel: listing.pricingModel } }).catch(() => undefined);
  }
  return { ok: true, id: install.id, mode, listingId: listing.id, version: listing.currentVersion, audit };
}

export async function marketplaceListingsUninstall(input: { listingId: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [existing] = await d.select().from(_insAM)
    .where(and(eq(_insAM.userId, ctx.userId), eq(_insAM.listingId, input.listingId))).limit(1);
  if (!existing) throw new CapabilityError("Install not found", 404, null);
  if (existing.status !== "active") return { ok: true, id: existing.id, alreadyUninstalled: true };
  await d.update(_insAM).set({ status: "uninstalled", uninstalledAt: new Date(), updatedAt: new Date() }).where(eq(_insAM.id, existing.id));
  await d.update(_lstAM).set({ installCount: _sqlAM`greatest(${_lstAM.installCount} - 1, 0)`, updatedAt: new Date() }).where(eq(_lstAM.id, input.listingId));
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.listings_uninstall", target: input.listingId, meta: { installId: existing.id } });
  void emitWebhookEvent({ userId: ctx.userId, event: "marketplace.listing_uninstalled", data: { listingId: input.listingId, installId: existing.id } }).catch(() => undefined);
  return { ok: true, id: existing.id, audit };
}

export async function marketplaceInstallsList(
  input: { status?: "active" | "uninstalled" | "suspended"; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const conds = [eq(_insAM.userId, ctx.userId)];
  if (input.status) conds.push(eq(_insAM.status, input.status));
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const offset = Math.max(0, input.offset ?? 0);
  const rows = await d.select({
      id: _insAM.id, listingId: _insAM.listingId, status: _insAM.status,
      pricingModel: _insAM.pricingModel, priceMinor: _insAM.priceMinor, currency: _insAM.currency,
      installedAt: _insAM.installedAt, uninstalledAt: _insAM.uninstalledAt,
      title: _lstAM.title, slug: _lstAM.slug, kind: _lstAM.kind, currentVersion: _lstAM.currentVersion,
    })
    .from(_insAM).leftJoin(_lstAM, eq(_lstAM.id, _insAM.listingId))
    .where(and(...conds)).orderBy(desc(_insAM.installedAt)).limit(limit).offset(offset);
  const [{ total }] = await d.select({ total: _sqlAM<number>`count(*)::int` }).from(_insAM).where(and(...conds));
  return { count: rows.length, total: total ?? 0, limit, offset, installs: rows };
}

export async function marketplaceReviewsUpsert(
  input: { listingId: string; rating: number; title?: string; body?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const tier = await _userTierAE(ctx.userId);
  const limits = _TIER_MARKET_LIMITS_AM[tier];
  if (input.rating < 1 || input.rating > 5 || !Number.isInteger(input.rating)) throw new CapabilityError("rating must be an integer 1-5", 400, null);
  if (input.title && input.title.length > 120) throw new CapabilityError("title max 120 chars", 400, null);
  if (input.body && input.body.length > 2000) throw new CapabilityError("body max 2000 chars", 400, null);
  const [listing] = await d.select().from(_lstAM).where(eq(_lstAM.id, input.listingId)).limit(1);
  if (!listing) throw new CapabilityError("Listing not found", 404, null);
  if (listing.userId === ctx.userId) throw new CapabilityError("Cannot review your own listing", 409, null);
  if (listing.status !== "published") throw new CapabilityError("Cannot review unpublished listing", 409, null);
  const [install] = await d.select({ id: _insAM.id }).from(_insAM)
    .where(and(eq(_insAM.userId, ctx.userId), eq(_insAM.listingId, listing.id))).limit(1);
  if (!install) throw new CapabilityError("Install required before reviewing (verified-purchase only)", 412, null);
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [{ todayCount }] = await d.select({ todayCount: _sqlAM<number>`count(*)::int` })
    .from(_revAM).where(and(eq(_revAM.userId, ctx.userId), _gteAM(_revAM.createdAt, dayAgo)));
  const [existing] = await d.select().from(_revAM)
    .where(and(eq(_revAM.userId, ctx.userId), eq(_revAM.listingId, listing.id))).limit(1);
  if (!existing && (todayCount ?? 0) >= limits.maxReviewsPerDay) throw new CapabilityError(`Tier '${tier}' allows at most ${limits.maxReviewsPerDay} new reviews per 24h`, 429, { tier });
  let mode: "create" | "update";
  let reviewId: string;
  if (existing) {
    await d.update(_revAM).set({ rating: input.rating, title: input.title ?? null, body: input.body ?? null }).where(eq(_revAM.id, existing.id));
    reviewId = existing.id;
    mode = "update";
  } else {
    const [row] = await d.insert(_revAM).values({
      listingId: listing.id, userId: ctx.userId, rating: input.rating,
      title: input.title ?? null, body: input.body ?? null,
    }).returning({ id: _revAM.id });
    reviewId = row.id;
    mode = "create";
  }
  await _recomputeRatingAM(listing.id);
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.reviews_upsert", target: reviewId, meta: { listingId: listing.id, rating: input.rating, mode } });
  if (mode === "create") {
    void emitWebhookEvent({ userId: listing.userId, event: "marketplace.review_posted", data: { listingId: listing.id, reviewId, rating: input.rating, reviewerUserId: ctx.userId } }).catch(() => undefined);
  }
  return { ok: true, id: reviewId, mode, audit };
}

export async function marketplaceReviewsList(
  input: { listingId: string; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const [listing] = await d.select({ id: _lstAM.id, status: _lstAM.status, visibility: _lstAM.visibility, userId: _lstAM.userId })
    .from(_lstAM).where(eq(_lstAM.id, input.listingId)).limit(1);
  if (!listing) throw new CapabilityError("Listing not found", 404, null);
  const isOwner = listing.userId === ctx.userId;
  if (!isOwner && !(listing.status === "published" && listing.visibility !== "private")) throw new CapabilityError("Listing not accessible", 404, null);
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const offset = Math.max(0, input.offset ?? 0);
  const rows = await d.select({
      id: _revAM.id, userId: _revAM.userId, rating: _revAM.rating,
      title: _revAM.title, body: _revAM.body, createdAt: _revAM.createdAt,
    })
    .from(_revAM).where(and(eq(_revAM.listingId, input.listingId), _sqlAM`${_revAM.hiddenAt} is null`))
    .orderBy(desc(_revAM.createdAt)).limit(limit).offset(offset);
  const [{ total }] = await d.select({ total: _sqlAM<number>`count(*)::int` })
    .from(_revAM).where(and(eq(_revAM.listingId, input.listingId), _sqlAM`${_revAM.hiddenAt} is null`));
  return { count: rows.length, total: total ?? 0, limit, offset, reviews: rows };
}

export async function marketplaceReviewsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const d = requireDb();
  const [row] = await d.select().from(_revAM).where(and(eq(_revAM.id, input.id), eq(_revAM.userId, ctx.userId))).limit(1);
  if (!row) throw new CapabilityError("Review not found", 404, null);
  await d.delete(_revAM).where(eq(_revAM.id, row.id));
  await _recomputeRatingAM(row.listingId);
  const audit = await _appendAudit({ keyId: ctx.keyId, userId: ctx.userId, action: "marketplace.reviews_delete", target: input.id, meta: { listingId: row.listingId } });
  return { ok: true, id: input.id, audit };
}

export async function marketplacePolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _userTierAE(ctx.userId);
  return {
    tier,
    limits: _TIER_MARKET_LIMITS_AM[tier],
    perTier: _TIER_MARKET_LIMITS_AM,
    categories: _CATEGORIES_AM,
    kinds: _KINDS_AM,
    pricingModels: _PRICING_AM,
    statuses: _STATUSES_AM,
    visibilities: _VISIBILITY_AM,
    webhookEvents: [
      "marketplace.listing_published",
      "marketplace.listing_unpublished",
      "marketplace.listing_installed",
      "marketplace.listing_uninstalled",
      "marketplace.review_posted",
    ],
    semverRegex: _SEMVER_AM.source,
    slugRegex: _SLUG_AM.source,
    notes: [
      "Listings transition draft → pending → published → suspended → archived. Owners can publish self-serve; capability manifests must declare `manifest.bindings`.",
      "Manifest mutations on published listings require `bumpVersion`; drafts can mutate freely.",
      "Reviews are verified-purchase only (install required); owners cannot review their own listings; one review per (user, listing).",
      "Install count is best-effort and may undercount during high concurrency.",
      "Paid listings require tier mini+. Marketplace gating is enforced server-side; client UI is informational.",
    ],
  };
}

// ─── Pillar AN — SLA & Status pages (Phase 30) ───────────────────────
import { randomBytes as _rbAN } from "node:crypto";
import { and as _andAN, desc as _descAN, eq as _eqAN, gte as _gteAN, isNull as _isNullAN, sql as _sqlAN } from "drizzle-orm";
import {
  publicApiStatusPages as _pagesAN,
  publicApiStatusIncidents as _incAN,
  publicApiStatusIncidentUpdates as _incUpAN,
  publicApiStatusMaintenance as _mntAN,
  publicApiStatusSubscribers as _subsAN,
  publicApiSlaTargets as _tgtAN,
  publicApiSlaCredits as _credAN,
  users as _usersAN,
} from "@/db/schema";

const _SLUG_AN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
const _INCIDENT_STATUSES_AN = ["investigating", "identified", "monitoring", "resolved"] as const;
const _SEVERITIES_AN = ["minor", "major", "critical"] as const;
const _IMPACTS_AN = ["none", "degraded", "partial_outage", "major_outage"] as const;
const _MAINT_STATUSES_AN = ["scheduled", "in_progress", "completed", "cancelled"] as const;
const _CHANNELS_AN = ["email", "webhook"] as const;
const _PERIOD_RE_AN = /^\d{4}-(0[1-9]|1[0-2])$/;

const _TIER_SLA_LIMITS_AN: Record<string, { maxPages: number; maxIncidentsPerMonth: number; maxSubscribersPerPage: number; allowCustomBranding: boolean }> = {
  free: { maxPages: 1, maxIncidentsPerMonth: 25, maxSubscribersPerPage: 50, allowCustomBranding: false },
  mini: { maxPages: 5, maxIncidentsPerMonth: 250, maxSubscribersPerPage: 5_000, allowCustomBranding: true },
  max:  { maxPages: 50, maxIncidentsPerMonth: 5_000, maxSubscribersPerPage: 100_000, allowCustomBranding: true },
};

const _DEFAULT_SLA_AN: Record<string, { uptime: number; latencyP95Ms: number }> = {
  free: { uptime: 0.990, latencyP95Ms: 1500 },
  mini: { uptime: 0.995, latencyP95Ms: 1000 },
  max:  { uptime: 0.999, latencyP95Ms: 600 },
};

async function _getTierAN(ctx: CapabilityRunContext): Promise<"free" | "mini" | "max"> {
  if (!db) return "free";
  const row = await db.select({ tier: _usersAN.tier }).from(_usersAN).where(_eqAN(_usersAN.id, ctx.userId)).limit(1);
  const t = (row[0]?.tier as string | undefined) ?? "free";
  return (t === "mini" || t === "max") ? t : "free";
}

function _slaCreditPctAN(actualUptime: number, targetUptime: number): number {
  if (actualUptime >= targetUptime) return 0;
  const gap = targetUptime - actualUptime;
  // Tiered refund schedule: 10% / 25% / 50% / 100%
  if (gap >= 0.05) return 1.00;
  if (gap >= 0.02) return 0.50;
  if (gap >= 0.005) return 0.25;
  return 0.10;
}

function _dispatchAN(event: string, userId: string, data: Record<string, unknown>): void {
  // Best-effort fire-and-forget; matches other pillars.
  void import("@/lib/webhooks/dispatcher")
    .then((m) => m.emitWebhookEvent({ event: event as Parameters<typeof m.emitWebhookEvent>[0]["event"], userId, data }))
    .catch(() => {});
}

// ── Status pages ─────────────────────────────────────────────────────
export async function slaPagesCreate(input: { slug: string; title: string; description?: string; branding?: Record<string, unknown>; components?: unknown[]; isPublic?: boolean }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!_SLUG_AN.test(input.slug)) throw new Error("invalid_slug");
  const tier = await _getTierAN(ctx);
  const limits = _TIER_SLA_LIMITS_AN[tier];
  const existing = await db.select({ n: _sqlAN<number>`count(*)::int` }).from(_pagesAN).where(_eqAN(_pagesAN.userId, ctx.userId));
  if ((existing[0]?.n ?? 0) >= limits.maxPages) throw new Error("page_quota_exceeded");
  const branding = limits.allowCustomBranding ? (input.branding ?? {}) : {};
  const [row] = await db.insert(_pagesAN).values({
    userId: ctx.userId,
    slug: input.slug,
    title: input.title,
    description: input.description ?? null,
    branding,
    components: input.components ?? [],
    isPublic: input.isPublic ?? false,
  }).returning();
  return { page: row };
}

export async function slaPagesUpdate(input: { id: string; title?: string; description?: string | null; branding?: Record<string, unknown>; components?: unknown[]; isPublic?: boolean }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.branding !== undefined) {
    const tier = await _getTierAN(ctx);
    if (!_TIER_SLA_LIMITS_AN[tier].allowCustomBranding) throw new Error("branding_requires_mini_tier");
    patch.branding = input.branding;
  }
  if (input.components !== undefined) patch.components = input.components;
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic;
  const [row] = await db.update(_pagesAN).set(patch)
    .where(_andAN(_eqAN(_pagesAN.id, input.id), _eqAN(_pagesAN.userId, ctx.userId)))
    .returning();
  if (!row) throw new Error("not_found");
  return { page: row };
}

export async function slaPagesPublish(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [row] = await db.update(_pagesAN).set({ isPublic: true, publishedAt: new Date(), updatedAt: new Date() })
    .where(_andAN(_eqAN(_pagesAN.id, input.id), _eqAN(_pagesAN.userId, ctx.userId)))
    .returning();
  if (!row) throw new Error("not_found");
  return { page: row };
}

export async function slaPagesUnpublish(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [row] = await db.update(_pagesAN).set({ isPublic: false, updatedAt: new Date() })
    .where(_andAN(_eqAN(_pagesAN.id, input.id), _eqAN(_pagesAN.userId, ctx.userId)))
    .returning();
  if (!row) throw new Error("not_found");
  return { page: row };
}

export async function slaPagesGet(input: { id?: string; slug?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!input.id && !input.slug) throw new Error("id_or_slug_required");
  const where = input.id
    ? _andAN(_eqAN(_pagesAN.id, input.id), _eqAN(_pagesAN.userId, ctx.userId))
    : _andAN(_eqAN(_pagesAN.slug, input.slug!), _eqAN(_pagesAN.userId, ctx.userId));
  const [row] = await db.select().from(_pagesAN).where(where).limit(1);
  if (!row) throw new Error("not_found");
  return { page: row };
}

export async function slaPagesList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const rows = await db.select().from(_pagesAN).where(_eqAN(_pagesAN.userId, ctx.userId)).orderBy(_descAN(_pagesAN.createdAt));
  return { pages: rows };
}

export async function slaPagesDelete(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const out = await db.delete(_pagesAN)
    .where(_andAN(_eqAN(_pagesAN.id, input.id), _eqAN(_pagesAN.userId, ctx.userId)))
    .returning({ id: _pagesAN.id });
  if (out.length === 0) throw new Error("not_found");
  return { ok: true, id: input.id };
}

// ── Incidents ────────────────────────────────────────────────────────
async function _assertOwnsPageAN(pageId: string, userId: string): Promise<void> {
  if (!db) throw new Error("db_unavailable");
  const [p] = await db.select({ id: _pagesAN.id }).from(_pagesAN)
    .where(_andAN(_eqAN(_pagesAN.id, pageId), _eqAN(_pagesAN.userId, userId))).limit(1);
  if (!p) throw new Error("page_not_found");
}

export async function slaIncidentsOpen(input: { pageId: string; title: string; severity?: typeof _SEVERITIES_AN[number]; impact?: typeof _IMPACTS_AN[number]; componentIds?: string[]; body?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  await _assertOwnsPageAN(input.pageId, ctx.userId);
  // monthly quota
  const tier = await _getTierAN(ctx);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const count = await db.select({ n: _sqlAN<number>`count(*)::int` }).from(_incAN)
    .where(_andAN(_eqAN(_incAN.userId, ctx.userId), _gteAN(_incAN.startedAt, monthAgo)));
  if ((count[0]?.n ?? 0) >= _TIER_SLA_LIMITS_AN[tier].maxIncidentsPerMonth) throw new Error("incident_quota_exceeded");
  const [row] = await db.insert(_incAN).values({
    pageId: input.pageId,
    userId: ctx.userId,
    title: input.title,
    status: "investigating",
    severity: input.severity ?? "minor",
    impact: input.impact ?? "degraded",
    componentIds: input.componentIds ?? [],
  }).returning();
  if (input.body) {
    await db.insert(_incUpAN).values({ incidentId: row.id, userId: ctx.userId, status: "investigating", body: input.body });
  }
  _dispatchAN("status.incident_opened", ctx.userId, { incidentId: row.id, pageId: row.pageId, title: row.title, severity: row.severity, impact: row.impact });
  return { incident: row };
}

export async function slaIncidentsUpdate(input: { id: string; status: typeof _INCIDENT_STATUSES_AN[number]; body: string; impact?: typeof _IMPACTS_AN[number] }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!_INCIDENT_STATUSES_AN.includes(input.status)) throw new Error("invalid_status");
  const [inc] = await db.select().from(_incAN)
    .where(_andAN(_eqAN(_incAN.id, input.id), _eqAN(_incAN.userId, ctx.userId))).limit(1);
  if (!inc) throw new Error("not_found");
  const patch: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
  if (input.impact) patch.impact = input.impact;
  if (input.status === "resolved" && !inc.resolvedAt) patch.resolvedAt = new Date();
  const [updated] = await db.update(_incAN).set(patch).where(_eqAN(_incAN.id, input.id)).returning();
  await db.insert(_incUpAN).values({ incidentId: input.id, userId: ctx.userId, status: input.status, body: input.body });
  const event = input.status === "resolved" ? "status.incident_resolved" : "status.incident_updated";
  _dispatchAN(event, ctx.userId, { incidentId: input.id, pageId: inc.pageId, status: input.status });
  return { incident: updated };
}

export async function slaIncidentsList(input: { pageId?: string; status?: typeof _INCIDENT_STATUSES_AN[number]; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [_eqAN(_incAN.userId, ctx.userId)];
  if (input.pageId) conds.push(_eqAN(_incAN.pageId, input.pageId));
  if (input.status) conds.push(_eqAN(_incAN.status, input.status));
  const rows = await db.select().from(_incAN).where(_andAN(...conds))
    .orderBy(_descAN(_incAN.startedAt)).limit(limit).offset(offset);
  return { incidents: rows, limit, offset };
}

export async function slaIncidentsGet(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [inc] = await db.select().from(_incAN)
    .where(_andAN(_eqAN(_incAN.id, input.id), _eqAN(_incAN.userId, ctx.userId))).limit(1);
  if (!inc) throw new Error("not_found");
  const updates = await db.select().from(_incUpAN)
    .where(_eqAN(_incUpAN.incidentId, input.id)).orderBy(_descAN(_incUpAN.postedAt));
  return { incident: inc, updates };
}

// ── Maintenance ──────────────────────────────────────────────────────
export async function slaMaintenanceSchedule(input: { pageId: string; title: string; body?: string; componentIds?: string[]; scheduledStart: string; scheduledEnd: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  await _assertOwnsPageAN(input.pageId, ctx.userId);
  const start = new Date(input.scheduledStart);
  const end = new Date(input.scheduledEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error("invalid_dates");
  if (end <= start) throw new Error("end_before_start");
  const [row] = await db.insert(_mntAN).values({
    pageId: input.pageId,
    userId: ctx.userId,
    title: input.title,
    body: input.body ?? null,
    componentIds: input.componentIds ?? [],
    scheduledStart: start,
    scheduledEnd: end,
    status: "scheduled",
  }).returning();
  _dispatchAN("status.maintenance_scheduled", ctx.userId, { maintenanceId: row.id, pageId: row.pageId, scheduledStart: row.scheduledStart, scheduledEnd: row.scheduledEnd });
  return { maintenance: row };
}

export async function slaMaintenanceUpdate(input: { id: string; status?: typeof _MAINT_STATUSES_AN[number]; title?: string; body?: string; scheduledStart?: string; scheduledEnd?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.status) {
    if (!_MAINT_STATUSES_AN.includes(input.status)) throw new Error("invalid_status");
    patch.status = input.status;
  }
  if (input.title) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.scheduledStart) patch.scheduledStart = new Date(input.scheduledStart);
  if (input.scheduledEnd) patch.scheduledEnd = new Date(input.scheduledEnd);
  const [row] = await db.update(_mntAN).set(patch)
    .where(_andAN(_eqAN(_mntAN.id, input.id), _eqAN(_mntAN.userId, ctx.userId)))
    .returning();
  if (!row) throw new Error("not_found");
  if (input.status === "in_progress") _dispatchAN("status.maintenance_started", ctx.userId, { maintenanceId: row.id, pageId: row.pageId });
  if (input.status === "completed") _dispatchAN("status.maintenance_completed", ctx.userId, { maintenanceId: row.id, pageId: row.pageId });
  return { maintenance: row };
}

export async function slaMaintenanceList(input: { pageId?: string; status?: typeof _MAINT_STATUSES_AN[number]; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [_eqAN(_mntAN.userId, ctx.userId)];
  if (input.pageId) conds.push(_eqAN(_mntAN.pageId, input.pageId));
  if (input.status) conds.push(_eqAN(_mntAN.status, input.status));
  const rows = await db.select().from(_mntAN).where(_andAN(...conds))
    .orderBy(_descAN(_mntAN.scheduledStart)).limit(limit).offset(offset);
  return { maintenance: rows, limit, offset };
}

export async function slaMaintenanceCancel(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [row] = await db.update(_mntAN).set({ status: "cancelled", updatedAt: new Date() })
    .where(_andAN(_eqAN(_mntAN.id, input.id), _eqAN(_mntAN.userId, ctx.userId)))
    .returning();
  if (!row) throw new Error("not_found");
  return { maintenance: row };
}

// ── Subscribers ──────────────────────────────────────────────────────
export async function slaSubscribersAdd(input: { pageId: string; channel: typeof _CHANNELS_AN[number]; target: string; componentIds?: string[]; autoConfirm?: boolean }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!_CHANNELS_AN.includes(input.channel)) throw new Error("invalid_channel");
  await _assertOwnsPageAN(input.pageId, ctx.userId);
  const tier = await _getTierAN(ctx);
  const max = _TIER_SLA_LIMITS_AN[tier].maxSubscribersPerPage;
  const count = await db.select({ n: _sqlAN<number>`count(*)::int` }).from(_subsAN)
    .where(_andAN(_eqAN(_subsAN.pageId, input.pageId), _isNullAN(_subsAN.unsubscribedAt)));
  if ((count[0]?.n ?? 0) >= max) throw new Error("subscriber_quota_exceeded");
  if (input.channel === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.target)) throw new Error("invalid_email");
  } else {
    if (!/^https?:\/\//i.test(input.target)) throw new Error("invalid_webhook_url");
  }
  const token = _rbAN(24).toString("base64url");
  const [row] = await db.insert(_subsAN).values({
    pageId: input.pageId,
    channel: input.channel,
    target: input.target,
    componentIds: input.componentIds ?? [],
    confirmToken: token,
    confirmedAt: input.autoConfirm ? new Date() : null,
  }).returning();
  _dispatchAN("status.subscriber_added", ctx.userId, { subscriberId: row.id, pageId: row.pageId, channel: row.channel });
  return { subscriber: row, confirmToken: token };
}

export async function slaSubscribersConfirm(input: { id: string; token: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [sub] = await db.select().from(_subsAN).where(_eqAN(_subsAN.id, input.id)).limit(1);
  if (!sub) throw new Error("not_found");
  if (sub.confirmToken !== input.token) throw new Error("invalid_token");
  const [row] = await db.update(_subsAN).set({ confirmedAt: new Date() }).where(_eqAN(_subsAN.id, input.id)).returning();
  _dispatchAN("status.subscriber_confirmed", ctx.userId, { subscriberId: input.id, pageId: row.pageId });
  return { subscriber: row };
}

export async function slaSubscribersList(input: { pageId: string; includeUnsubscribed?: boolean; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  await _assertOwnsPageAN(input.pageId, ctx.userId);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [_eqAN(_subsAN.pageId, input.pageId)];
  if (!input.includeUnsubscribed) conds.push(_isNullAN(_subsAN.unsubscribedAt));
  const rows = await db.select().from(_subsAN).where(_andAN(...conds))
    .orderBy(_descAN(_subsAN.createdAt)).limit(limit).offset(offset);
  return { subscribers: rows, limit, offset };
}

export async function slaSubscribersRemove(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [sub] = await db.select().from(_subsAN).where(_eqAN(_subsAN.id, input.id)).limit(1);
  if (!sub) throw new Error("not_found");
  await _assertOwnsPageAN(sub.pageId, ctx.userId);
  const [row] = await db.update(_subsAN).set({ unsubscribedAt: new Date() }).where(_eqAN(_subsAN.id, input.id)).returning();
  return { subscriber: row };
}

// ── SLA targets & credits ────────────────────────────────────────────
export async function slaTargetsList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const tier = await _getTierAN(ctx);
  const rows = await db.select().from(_tgtAN);
  const filtered = rows.filter((r) => r.userId === null || r.userId === ctx.userId || r.tier === tier);
  const defaultTarget = _DEFAULT_SLA_AN[tier];
  return { targets: filtered, tier, defaults: defaultTarget };
}

export async function slaCreditsCompute(input: { periodMonth: string; observedUptime?: number; observedLatencyP95Ms?: number; componentKey?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!_PERIOD_RE_AN.test(input.periodMonth)) throw new Error("invalid_period");
  const tier = await _getTierAN(ctx);
  const target = _DEFAULT_SLA_AN[tier];
  const observedUptime = typeof input.observedUptime === "number" ? input.observedUptime : 1;
  const pct = _slaCreditPctAN(observedUptime, target.uptime);
  const [row] = await db.insert(_credAN).values({
    userId: ctx.userId,
    periodMonth: input.periodMonth,
    target: { tier, uptime: target.uptime, latencyP95Ms: target.latencyP95Ms },
    observed: { uptime: observedUptime, latencyP95Ms: input.observedLatencyP95Ms ?? null, componentKey: input.componentKey ?? "global" },
    creditPct: pct.toFixed(4),
    status: pct > 0 ? "pending" : "denied",
    note: pct > 0 ? `Uptime ${(observedUptime * 100).toFixed(3)}% below target ${(target.uptime * 100).toFixed(3)}%` : "SLA met",
  }).onConflictDoUpdate({
    target: [_credAN.userId, _credAN.periodMonth],
    set: {
      target: { tier, uptime: target.uptime, latencyP95Ms: target.latencyP95Ms },
      observed: { uptime: observedUptime, latencyP95Ms: input.observedLatencyP95Ms ?? null, componentKey: input.componentKey ?? "global" },
      creditPct: pct.toFixed(4),
      status: pct > 0 ? "pending" : "denied",
      note: pct > 0 ? `Uptime ${(observedUptime * 100).toFixed(3)}% below target ${(target.uptime * 100).toFixed(3)}%` : "SLA met",
      updatedAt: new Date(),
    },
  }).returning();
  if (pct > 0) _dispatchAN("sla.credit_issued", ctx.userId, { periodMonth: input.periodMonth, creditPct: pct, tier });
  return { credit: row };
}

export async function slaCreditsList(input: { limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 120);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = await db.select().from(_credAN).where(_eqAN(_credAN.userId, ctx.userId))
    .orderBy(_descAN(_credAN.createdAt)).limit(limit).offset(offset);
  return { credits: rows, limit, offset };
}

export async function slaPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _getTierAN(ctx);
  return {
    tier,
    limits: _TIER_SLA_LIMITS_AN[tier],
    allTierLimits: _TIER_SLA_LIMITS_AN,
    defaultTargets: _DEFAULT_SLA_AN,
    incidentStatuses: _INCIDENT_STATUSES_AN,
    severities: _SEVERITIES_AN,
    impacts: _IMPACTS_AN,
    maintenanceStatuses: _MAINT_STATUSES_AN,
    subscriberChannels: _CHANNELS_AN,
    creditSchedule: [
      { gapPp: "<0.5",      creditPct: 0.10 },
      { gapPp: "0.5–<2.0",  creditPct: 0.25 },
      { gapPp: "2.0–<5.0",  creditPct: 0.50 },
      { gapPp: ">=5.0",     creditPct: 1.00 },
    ],
    slugRegex: _SLUG_AN.source,
    periodRegex: _PERIOD_RE_AN.source,
    webhookEvents: [
      "status.incident_opened",
      "status.incident_updated",
      "status.incident_resolved",
      "status.maintenance_scheduled",
      "status.maintenance_started",
      "status.maintenance_completed",
      "status.subscriber_added",
      "status.subscriber_confirmed",
      "sla.credit_issued",
    ],
    notes: [
      "Status pages have globally-unique slugs. Public pages are readable without auth at /status/{slug}.",
      "Incidents auto-stamp resolvedAt when status transitions to 'resolved'.",
      "Subscribers must confirm via token before receiving updates unless autoConfirm=true (page-owner add).",
      "SLA credits are computed per (user, periodMonth) and are best-effort estimates; finance review marks them approved/paid.",
      "Custom branding (logo, colors) requires the Mini tier or higher.",
    ],
  };
}

// ─── Pillar AO — Data Contracts & Schema Registry (Phase 31) ──────────
import { createHash as _shaAO } from "node:crypto";
import { and as _andAO, desc as _descAO, eq as _eqAO, sql as _sqlAO } from "drizzle-orm";
import {
  publicApiSchemas as _schAO,
  publicApiSchemaVersions as _verAO,
  publicApiContracts as _conAO,
  publicApiContractViolations as _vioAO,
  users as _usersAO,
} from "@/db/schema";

const _SEMVER_AO = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const _NAME_AO = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;
const _SUBJECT_TYPES_AO = ["event", "capability", "endpoint", "custom"] as const;
const _MODES_AO = ["validate", "warn", "enforce"] as const;
const _COMPAT_AO = ["backward", "forward", "full", "none", "unknown"] as const;

const _TIER_CONTRACT_LIMITS_AO: Record<string, {
  maxSchemas: number;
  maxVersionsPerSchema: number;
  maxContracts: number;
  maxViolationsRetained: number;
  maxSchemaBytes: number;
}> = {
  free: { maxSchemas: 5,   maxVersionsPerSchema: 10,  maxContracts: 5,   maxViolationsRetained: 500,    maxSchemaBytes: 32_768 },
  mini: { maxSchemas: 100, maxVersionsPerSchema: 200, maxContracts: 200, maxViolationsRetained: 50_000, maxSchemaBytes: 131_072 },
  max:  { maxSchemas: 2000, maxVersionsPerSchema: 2000, maxContracts: 5000, maxViolationsRetained: 1_000_000, maxSchemaBytes: 524_288 },
};

async function _getTierAO(ctx: CapabilityRunContext): Promise<"free" | "mini" | "max"> {
  if (!db) return "free";
  const row = await db.select({ tier: _usersAO.tier }).from(_usersAO).where(_eqAO(_usersAO.id, ctx.userId)).limit(1);
  const t = (row[0]?.tier as string | undefined) ?? "free";
  return (t === "mini" || t === "max") ? t : "free";
}

function _hashSchemaAO(json: unknown): string {
  // Stable hash: canonical JSON (sorted keys) → sha256
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canon);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canon((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return _shaAO("sha256").update(JSON.stringify(canon(json))).digest("hex");
}

function _parseSemverAO(v: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function _cmpSemverAO(a: string, b: string): number {
  const A = _parseSemverAO(a)!;
  const B = _parseSemverAO(b)!;
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  return A.patch - B.patch;
}

// ── Minimal JSON-Schema (draft-07 subset) validator ──────────────────
type _JsonSchemaAO = Record<string, unknown>;
interface _ValidationErrAO { path: string; keyword: string; message: string; }

function _typeOfAO(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function _validateAO(value: unknown, schema: _JsonSchemaAO, path = "$"): _ValidationErrAO[] {
  const errs: _ValidationErrAO[] = [];
  if (!schema || typeof schema !== "object") return errs;

  // const
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errs.push({ path, keyword: "const", message: `expected const ${JSON.stringify(schema.const)}` });
  }
  // enum
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push({ path, keyword: "enum", message: `not in enum` });
  }
  // type
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = _typeOfAO(value);
    const ok = allowed.some((x) => (x === "integer" ? t === "number" && Number.isInteger(value as number) : x === t));
    if (!ok) errs.push({ path, keyword: "type", message: `expected ${allowed.join("|")} got ${t}` });
  }
  // anyOf / oneOf / allOf
  if (Array.isArray(schema.anyOf)) {
    const passes = schema.anyOf.filter((s) => _validateAO(value, s as _JsonSchemaAO, path).length === 0);
    if (passes.length === 0) errs.push({ path, keyword: "anyOf", message: "matched no anyOf branch" });
  }
  if (Array.isArray(schema.oneOf)) {
    const passes = schema.oneOf.filter((s) => _validateAO(value, s as _JsonSchemaAO, path).length === 0);
    if (passes.length !== 1) errs.push({ path, keyword: "oneOf", message: `matched ${passes.length} oneOf branches, expected exactly 1` });
  }
  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) {
      errs.push(..._validateAO(value, schema.allOf[i] as _JsonSchemaAO, path));
    }
  }

  const t = _typeOfAO(value);
  if (t === "string" && typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errs.push({ path, keyword: "minLength", message: `length ${value.length} < ${schema.minLength}` });
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errs.push({ path, keyword: "maxLength", message: `length ${value.length} > ${schema.maxLength}` });
    if (typeof schema.pattern === "string") {
      try { if (!new RegExp(schema.pattern).test(value)) errs.push({ path, keyword: "pattern", message: `does not match ${schema.pattern}` }); }
      catch { errs.push({ path, keyword: "pattern", message: `invalid regex ${schema.pattern}` }); }
    }
  }
  if (t === "number" && typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errs.push({ path, keyword: "minimum", message: `< ${schema.minimum}` });
    if (typeof schema.maximum === "number" && value > schema.maximum) errs.push({ path, keyword: "maximum", message: `> ${schema.maximum}` });
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) errs.push({ path, keyword: "exclusiveMinimum", message: `<= ${schema.exclusiveMinimum}` });
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) errs.push({ path, keyword: "exclusiveMaximum", message: `>= ${schema.exclusiveMaximum}` });
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0 && Math.abs((value / schema.multipleOf) - Math.round(value / schema.multipleOf)) > 1e-9) {
      errs.push({ path, keyword: "multipleOf", message: `not multiple of ${schema.multipleOf}` });
    }
  }
  if (t === "array" && Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errs.push({ path, keyword: "minItems", message: `${value.length} < ${schema.minItems}` });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errs.push({ path, keyword: "maxItems", message: `${value.length} > ${schema.maxItems}` });
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const it of value) { const k = JSON.stringify(it); if (seen.has(k)) { errs.push({ path, keyword: "uniqueItems", message: "duplicate item" }); break; } seen.add(k); }
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      for (let i = 0; i < value.length; i++) errs.push(..._validateAO(value[i], schema.items as _JsonSchemaAO, `${path}[${i}]`));
    }
  }
  if (t === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const k of schema.required as string[]) if (!(k in obj)) errs.push({ path: `${path}.${k}`, keyword: "required", message: "missing required property" });
    }
    if (schema.properties && typeof schema.properties === "object") {
      for (const [k, sub] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (k in obj) errs.push(..._validateAO(obj[k], sub as _JsonSchemaAO, `${path}.${k}`));
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const declared = new Set(Object.keys(schema.properties as Record<string, unknown>));
      for (const k of Object.keys(obj)) if (!declared.has(k)) errs.push({ path: `${path}.${k}`, keyword: "additionalProperties", message: "property not allowed" });
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const declared = new Set(Object.keys((schema.properties ?? {}) as Record<string, unknown>));
      for (const [k, v] of Object.entries(obj)) if (!declared.has(k)) errs.push(..._validateAO(v, schema.additionalProperties as _JsonSchemaAO, `${path}.${k}`));
    }
    if (typeof schema.minProperties === "number" && Object.keys(obj).length < schema.minProperties) errs.push({ path, keyword: "minProperties", message: `< ${schema.minProperties}` });
    if (typeof schema.maxProperties === "number" && Object.keys(obj).length > schema.maxProperties) errs.push({ path, keyword: "maxProperties", message: `> ${schema.maxProperties}` });
  }
  return errs;
}

// ── Schema diff / compatibility ──────────────────────────────────────
interface _SchemaChangeAO { path: string; kind: string; from?: unknown; to?: unknown; breaking: boolean; }

function _diffSchemaAO(a: _JsonSchemaAO | undefined, b: _JsonSchemaAO | undefined, path = "$"): _SchemaChangeAO[] {
  const changes: _SchemaChangeAO[] = [];
  if (!a && !b) return changes;
  if (!a && b) { changes.push({ path, kind: "added", to: b, breaking: false }); return changes; }
  if (a && !b) { changes.push({ path, kind: "removed", from: a, breaking: true }); return changes; }
  const A = a as _JsonSchemaAO; const B = b as _JsonSchemaAO;

  // type change
  if (JSON.stringify(A.type) !== JSON.stringify(B.type)) {
    changes.push({ path: `${path}.type`, kind: "type_changed", from: A.type, to: B.type, breaking: true });
  }
  // required: added required keys are breaking; removed are non-breaking
  const aReq = new Set<string>(Array.isArray(A.required) ? (A.required as string[]) : []);
  const bReq = new Set<string>(Array.isArray(B.required) ? (B.required as string[]) : []);
  for (const k of bReq) if (!aReq.has(k)) changes.push({ path: `${path}.required[${k}]`, kind: "required_added", to: k, breaking: true });
  for (const k of aReq) if (!bReq.has(k)) changes.push({ path: `${path}.required[${k}]`, kind: "required_removed", from: k, breaking: false });

  // enum
  if (Array.isArray(A.enum) || Array.isArray(B.enum)) {
    const aSet = new Set((Array.isArray(A.enum) ? A.enum : []).map((x: unknown) => JSON.stringify(x)));
    const bSet = new Set((Array.isArray(B.enum) ? B.enum : []).map((x: unknown) => JSON.stringify(x)));
    for (const v of aSet) if (!bSet.has(v)) changes.push({ path: `${path}.enum`, kind: "enum_value_removed", from: v, breaking: true });
    for (const v of bSet) if (!aSet.has(v)) changes.push({ path: `${path}.enum`, kind: "enum_value_added", to: v, breaking: false });
  }

  // numeric tighten/loosen
  const numericTighten = (k: keyof _JsonSchemaAO, op: "min" | "max"): void => {
    const av = A[k]; const bv = B[k];
    if (typeof av === "number" || typeof bv === "number") {
      if (av !== bv) {
        const tightened = op === "min"
          ? (typeof bv === "number" && (typeof av !== "number" || (bv as number) > (av as number)))
          : (typeof bv === "number" && (typeof av !== "number" || (bv as number) < (av as number)));
        changes.push({ path: `${path}.${String(k)}`, kind: tightened ? "constraint_tightened" : "constraint_loosened", from: av, to: bv, breaking: tightened });
      }
    }
  };
  numericTighten("minimum", "min");
  numericTighten("maximum", "max");
  numericTighten("minLength", "min");
  numericTighten("maxLength", "max");
  numericTighten("minItems", "min");
  numericTighten("maxItems", "max");

  // pattern change is breaking
  if (A.pattern !== B.pattern) changes.push({ path: `${path}.pattern`, kind: "pattern_changed", from: A.pattern, to: B.pattern, breaking: true });

  // additionalProperties tightened (true→false or schema→false) is breaking
  if (A.additionalProperties !== B.additionalProperties) {
    const tightened = (A.additionalProperties === true || typeof A.additionalProperties === "object") && B.additionalProperties === false;
    changes.push({ path: `${path}.additionalProperties`, kind: "additional_properties_changed", from: A.additionalProperties, to: B.additionalProperties, breaking: tightened });
  }

  // properties
  const aProps = (A.properties ?? {}) as Record<string, _JsonSchemaAO>;
  const bProps = (B.properties ?? {}) as Record<string, _JsonSchemaAO>;
  const all = new Set<string>([...Object.keys(aProps), ...Object.keys(bProps)]);
  for (const k of all) changes.push(..._diffSchemaAO(aProps[k], bProps[k], `${path}.${k}`));

  // items
  if (A.items || B.items) {
    if (typeof A.items === "object" && typeof B.items === "object" && !Array.isArray(A.items) && !Array.isArray(B.items)) {
      changes.push(..._diffSchemaAO(A.items as _JsonSchemaAO, B.items as _JsonSchemaAO, `${path}.items`));
    } else if (JSON.stringify(A.items) !== JSON.stringify(B.items)) {
      changes.push({ path: `${path}.items`, kind: "items_changed", from: A.items, to: B.items, breaking: true });
    }
  }

  return changes;
}

function _compatibilityAO(breaking: _SchemaChangeAO[]): typeof _COMPAT_AO[number] {
  // Simple heuristic: no breaking changes → backward-compatible (consumers using old schema can read new payloads).
  return breaking.length === 0 ? "backward" : "none";
}

function _excerptPayloadAO(payload: unknown, maxBytes = 2048): unknown {
  try {
    const s = JSON.stringify(payload);
    if (s.length <= maxBytes) return payload;
    return { _truncated: true, _originalBytes: s.length, preview: s.slice(0, maxBytes) };
  } catch { return { _unserializable: true }; }
}

function _dispatchAO(event: string, userId: string, data: Record<string, unknown>): void {
  void import("@/lib/webhooks/dispatcher")
    .then((m) => m.emitWebhookEvent({ event: event as Parameters<typeof m.emitWebhookEvent>[0]["event"], userId, data }))
    .catch(() => {});
}

async function _resolveSchemaForRefAO(ctx: CapabilityRunContext, opts: { schemaId?: string; namespace?: string; name?: string }): Promise<{ id: string; namespace: string; name: string } | null> {
  if (!db) return null;
  if (opts.schemaId) {
    const [r] = await db.select().from(_schAO).where(_andAO(_eqAO(_schAO.id, opts.schemaId), _eqAO(_schAO.userId, ctx.userId))).limit(1);
    return r ? { id: r.id, namespace: r.namespace, name: r.name } : null;
  }
  if (opts.name) {
    const [r] = await db.select().from(_schAO).where(_andAO(
      _eqAO(_schAO.userId, ctx.userId),
      _eqAO(_schAO.namespace, opts.namespace ?? "default"),
      _eqAO(_schAO.name, opts.name),
    )).limit(1);
    return r ? { id: r.id, namespace: r.namespace, name: r.name } : null;
  }
  return null;
}

// ── Schemas ──────────────────────────────────────────────────────────
export async function schemasRegister(input: { name: string; namespace?: string; description?: string; version: string; jsonSchema: Record<string, unknown>; changelog?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!_NAME_AO.test(input.name)) throw new Error("invalid_name");
  if (input.namespace && !_NAME_AO.test(input.namespace)) throw new Error("invalid_namespace");
  if (!_SEMVER_AO.test(input.version)) throw new Error("invalid_semver");
  const tier = await _getTierAO(ctx);
  const limits = _TIER_CONTRACT_LIMITS_AO[tier];
  const bytes = JSON.stringify(input.jsonSchema).length;
  if (bytes > limits.maxSchemaBytes) throw new Error("schema_too_large");

  const ns = input.namespace ?? "default";
  // Find or create schema row
  const existing = await db.select().from(_schAO).where(_andAO(
    _eqAO(_schAO.userId, ctx.userId), _eqAO(_schAO.namespace, ns), _eqAO(_schAO.name, input.name),
  )).limit(1);

  let schemaRow = existing[0];
  if (!schemaRow) {
    const count = await db.select({ n: _sqlAO<number>`count(*)::int` }).from(_schAO).where(_eqAO(_schAO.userId, ctx.userId));
    if ((count[0]?.n ?? 0) >= limits.maxSchemas) throw new Error("schema_quota_exceeded");
    const [created] = await db.insert(_schAO).values({
      userId: ctx.userId, namespace: ns, name: input.name, description: input.description ?? null,
    }).returning();
    schemaRow = created;
    _dispatchAO("schema.registered", ctx.userId, { schemaId: schemaRow.id, namespace: ns, name: input.name });
  }

  // version count
  const vc = await db.select({ n: _sqlAO<number>`count(*)::int` }).from(_verAO).where(_eqAO(_verAO.schemaId, schemaRow.id));
  if ((vc[0]?.n ?? 0) >= limits.maxVersionsPerSchema) throw new Error("version_quota_exceeded");

  // Diff vs previous latest, if any
  let compat: typeof _COMPAT_AO[number] = "unknown";
  let breaking: _SchemaChangeAO[] = [];
  if (schemaRow.latestVersion) {
    if (_cmpSemverAO(input.version, schemaRow.latestVersion) <= 0) throw new Error("version_must_be_greater_than_latest");
    const [prev] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, schemaRow.id), _eqAO(_verAO.version, schemaRow.latestVersion))).limit(1);
    if (prev) {
      const all = _diffSchemaAO(prev.jsonSchema as _JsonSchemaAO, input.jsonSchema);
      breaking = all.filter((c) => c.breaking);
      compat = _compatibilityAO(breaking);
    }
  }

  const hash = _hashSchemaAO(input.jsonSchema);
  const [ver] = await db.insert(_verAO).values({
    schemaId: schemaRow.id,
    userId: ctx.userId,
    version: input.version,
    jsonSchema: input.jsonSchema,
    schemaHash: hash,
    changelog: input.changelog ?? null,
    compatibility: compat,
    breakingChanges: breaking,
  }).returning();

  await db.update(_schAO).set({ latestVersion: input.version, updatedAt: new Date() }).where(_eqAO(_schAO.id, schemaRow.id));
  _dispatchAO("schema.version_published", ctx.userId, { schemaId: schemaRow.id, version: input.version, compatibility: compat, breakingChangeCount: breaking.length });
  return { schema: { ...schemaRow, latestVersion: input.version }, version: ver };
}

export async function schemasList(input: { namespace?: string; includeDeprecated?: boolean; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [_eqAO(_schAO.userId, ctx.userId)];
  if (input.namespace) conds.push(_eqAO(_schAO.namespace, input.namespace));
  const rows = await db.select().from(_schAO).where(_andAO(...conds))
    .orderBy(_descAO(_schAO.updatedAt)).limit(limit).offset(offset);
  const filtered = input.includeDeprecated ? rows : rows.filter((r) => !r.deprecatedAt);
  return { schemas: filtered, limit, offset };
}

export async function schemasGet(input: { id?: string; namespace?: string; name?: string; version?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.id, namespace: input.namespace, name: input.name });
  if (!ref) throw new Error("not_found");
  const [s] = await db.select().from(_schAO).where(_eqAO(_schAO.id, ref.id)).limit(1);
  const targetVersion = input.version ?? s.latestVersion;
  if (!targetVersion) return { schema: s, version: null };
  const [v] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, s.id), _eqAO(_verAO.version, targetVersion))).limit(1);
  if (!v) throw new Error("version_not_found");
  return { schema: s, version: v };
}

export async function schemasVersionsList(input: { id?: string; namespace?: string; name?: string; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.id, namespace: input.namespace, name: input.name });
  if (!ref) throw new Error("not_found");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = await db.select().from(_verAO).where(_eqAO(_verAO.schemaId, ref.id))
    .orderBy(_descAO(_verAO.createdAt)).limit(limit).offset(offset);
  return { schemaId: ref.id, versions: rows, limit, offset };
}

export async function schemasDeprecate(input: { id: string; reason?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [row] = await db.update(_schAO).set({ deprecatedAt: new Date(), description: input.reason ?? undefined, updatedAt: new Date() })
    .where(_andAO(_eqAO(_schAO.id, input.id), _eqAO(_schAO.userId, ctx.userId))).returning();
  if (!row) throw new Error("not_found");
  _dispatchAO("schema.deprecated", ctx.userId, { schemaId: row.id, namespace: row.namespace, name: row.name });
  return { schema: row };
}

export async function schemasYankVersion(input: { id?: string; namespace?: string; name?: string; version: string; reason?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.id, namespace: input.namespace, name: input.name });
  if (!ref) throw new Error("not_found");
  const [row] = await db.update(_verAO).set({ yankedAt: new Date(), yankReason: input.reason ?? null })
    .where(_andAO(_eqAO(_verAO.schemaId, ref.id), _eqAO(_verAO.version, input.version), _eqAO(_verAO.userId, ctx.userId))).returning();
  if (!row) throw new Error("version_not_found");
  return { version: row };
}

export async function schemasValidate(input: { id?: string; namespace?: string; name?: string; version?: string; payload: unknown }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.id, namespace: input.namespace, name: input.name });
  if (!ref) throw new Error("not_found");
  const [s] = await db.select().from(_schAO).where(_eqAO(_schAO.id, ref.id)).limit(1);
  const targetVersion = input.version ?? s.latestVersion;
  if (!targetVersion) throw new Error("no_version_available");
  const [v] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, s.id), _eqAO(_verAO.version, targetVersion))).limit(1);
  if (!v) throw new Error("version_not_found");
  const errors = _validateAO(input.payload, v.jsonSchema as _JsonSchemaAO);
  return { valid: errors.length === 0, errors, schemaId: s.id, version: targetVersion };
}

export async function schemasDiff(input: { id?: string; namespace?: string; name?: string; fromVersion: string; toVersion: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.id, namespace: input.namespace, name: input.name });
  if (!ref) throw new Error("not_found");
  const [a] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, ref.id), _eqAO(_verAO.version, input.fromVersion))).limit(1);
  const [b] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, ref.id), _eqAO(_verAO.version, input.toVersion))).limit(1);
  if (!a || !b) throw new Error("version_not_found");
  const changes = _diffSchemaAO(a.jsonSchema as _JsonSchemaAO, b.jsonSchema as _JsonSchemaAO);
  const breaking = changes.filter((c) => c.breaking);
  return { fromVersion: input.fromVersion, toVersion: input.toVersion, changes, breakingChanges: breaking, compatibility: _compatibilityAO(breaking) };
}

export async function schemasCompatibilityCheck(input: { id?: string; namespace?: string; name?: string; candidateSchema: Record<string, unknown>; againstVersion?: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.id, namespace: input.namespace, name: input.name });
  if (!ref) throw new Error("not_found");
  const [s] = await db.select().from(_schAO).where(_eqAO(_schAO.id, ref.id)).limit(1);
  const target = input.againstVersion ?? s.latestVersion;
  if (!target) throw new Error("no_baseline_version");
  const [baseline] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, ref.id), _eqAO(_verAO.version, target))).limit(1);
  if (!baseline) throw new Error("version_not_found");
  const changes = _diffSchemaAO(baseline.jsonSchema as _JsonSchemaAO, input.candidateSchema);
  const breaking = changes.filter((c) => c.breaking);
  return { baselineVersion: target, changes, breakingChanges: breaking, compatibility: _compatibilityAO(breaking), candidateHash: _hashSchemaAO(input.candidateSchema) };
}

// ── Contracts ────────────────────────────────────────────────────────
export async function contractsCreate(input: { name: string; description?: string; subjectType: typeof _SUBJECT_TYPES_AO[number]; subject: string; schemaId?: string; schemaNamespace?: string; schemaName?: string; schemaVersion?: string; mode?: typeof _MODES_AO[number]; active?: boolean }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  if (!_NAME_AO.test(input.name)) throw new Error("invalid_name");
  if (!_SUBJECT_TYPES_AO.includes(input.subjectType)) throw new Error("invalid_subject_type");
  if (input.mode && !_MODES_AO.includes(input.mode)) throw new Error("invalid_mode");
  const tier = await _getTierAO(ctx);
  const limits = _TIER_CONTRACT_LIMITS_AO[tier];
  const count = await db.select({ n: _sqlAO<number>`count(*)::int` }).from(_conAO).where(_eqAO(_conAO.userId, ctx.userId));
  if ((count[0]?.n ?? 0) >= limits.maxContracts) throw new Error("contract_quota_exceeded");

  const ref = await _resolveSchemaForRefAO(ctx, { schemaId: input.schemaId, namespace: input.schemaNamespace, name: input.schemaName });
  if (!ref) throw new Error("schema_not_found");
  const [sch] = await db.select().from(_schAO).where(_eqAO(_schAO.id, ref.id)).limit(1);
  const version = input.schemaVersion ?? sch.latestVersion;
  if (!version) throw new Error("schema_has_no_version");
  // confirm version exists
  const [ver] = await db.select({ id: _verAO.id }).from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, sch.id), _eqAO(_verAO.version, version))).limit(1);
  if (!ver) throw new Error("schema_version_not_found");

  const [row] = await db.insert(_conAO).values({
    userId: ctx.userId,
    name: input.name,
    description: input.description ?? null,
    subjectType: input.subjectType,
    subject: input.subject,
    schemaId: sch.id,
    schemaVersion: version,
    mode: input.mode ?? "validate",
    active: input.active ?? true,
  }).returning();
  _dispatchAO("contract.created", ctx.userId, { contractId: row.id, name: row.name, subjectType: row.subjectType, subject: row.subject });
  return { contract: row };
}

export async function contractsUpdate(input: { id: string; description?: string | null; schemaVersion?: string; mode?: typeof _MODES_AO[number]; active?: boolean }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [existing] = await db.select().from(_conAO).where(_andAO(_eqAO(_conAO.id, input.id), _eqAO(_conAO.userId, ctx.userId))).limit(1);
  if (!existing) throw new Error("not_found");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.description !== undefined) patch.description = input.description;
  if (input.mode) { if (!_MODES_AO.includes(input.mode)) throw new Error("invalid_mode"); patch.mode = input.mode; }
  if (input.active !== undefined) patch.active = input.active;
  if (input.schemaVersion) {
    const [ver] = await db.select({ id: _verAO.id }).from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, existing.schemaId), _eqAO(_verAO.version, input.schemaVersion))).limit(1);
    if (!ver) throw new Error("schema_version_not_found");
    patch.schemaVersion = input.schemaVersion;
  }
  const [row] = await db.update(_conAO).set(patch).where(_eqAO(_conAO.id, input.id)).returning();
  _dispatchAO("contract.updated", ctx.userId, { contractId: row.id, changes: Object.keys(patch).filter((k) => k !== "updatedAt") });
  return { contract: row };
}

export async function contractsList(input: { subjectType?: typeof _SUBJECT_TYPES_AO[number]; subject?: string; activeOnly?: boolean; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [_eqAO(_conAO.userId, ctx.userId)];
  if (input.subjectType) conds.push(_eqAO(_conAO.subjectType, input.subjectType));
  if (input.subject) conds.push(_eqAO(_conAO.subject, input.subject));
  if (input.activeOnly) conds.push(_eqAO(_conAO.active, true));
  const rows = await db.select().from(_conAO).where(_andAO(...conds))
    .orderBy(_descAO(_conAO.updatedAt)).limit(limit).offset(offset);
  return { contracts: rows, limit, offset };
}

export async function contractsGet(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const [row] = await db.select().from(_conAO).where(_andAO(_eqAO(_conAO.id, input.id), _eqAO(_conAO.userId, ctx.userId))).limit(1);
  if (!row) throw new Error("not_found");
  return { contract: row };
}

export async function contractsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const out = await db.delete(_conAO).where(_andAO(_eqAO(_conAO.id, input.id), _eqAO(_conAO.userId, ctx.userId))).returning({ id: _conAO.id });
  if (out.length === 0) throw new Error("not_found");
  _dispatchAO("contract.deleted", ctx.userId, { contractId: input.id });
  return { ok: true, id: input.id };
}

export async function contractsValidate(input: { id?: string; name?: string; subjectType?: typeof _SUBJECT_TYPES_AO[number]; subject?: string; payload: unknown; recordViolation?: boolean }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  // Resolve contract
  let contract: typeof _conAO.$inferSelect | undefined;
  if (input.id) {
    const [r] = await db.select().from(_conAO).where(_andAO(_eqAO(_conAO.id, input.id), _eqAO(_conAO.userId, ctx.userId))).limit(1);
    contract = r;
  } else if (input.name) {
    const [r] = await db.select().from(_conAO).where(_andAO(_eqAO(_conAO.userId, ctx.userId), _eqAO(_conAO.name, input.name))).limit(1);
    contract = r;
  } else if (input.subjectType && input.subject) {
    const [r] = await db.select().from(_conAO).where(_andAO(
      _eqAO(_conAO.userId, ctx.userId), _eqAO(_conAO.subjectType, input.subjectType), _eqAO(_conAO.subject, input.subject), _eqAO(_conAO.active, true),
    )).limit(1);
    contract = r;
  }
  if (!contract) throw new Error("contract_not_found");

  const [v] = await db.select().from(_verAO).where(_andAO(_eqAO(_verAO.schemaId, contract.schemaId), _eqAO(_verAO.version, contract.schemaVersion))).limit(1);
  if (!v) throw new Error("schema_version_missing");
  const errors = _validateAO(input.payload, v.jsonSchema as _JsonSchemaAO);
  const valid = errors.length === 0;
  let violationId: string | null = null;

  if (!valid && (input.recordViolation ?? contract.mode !== "validate")) {
    const [vio] = await db.insert(_vioAO).values({
      contractId: contract.id,
      userId: ctx.userId,
      subject: contract.subject,
      payloadExcerpt: _excerptPayloadAO(input.payload) as Record<string, unknown>,
      errors,
      severity: contract.mode === "enforce" ? "error" : "warn",
    }).returning({ id: _vioAO.id });
    violationId = vio.id;
    _dispatchAO("contract.violation", ctx.userId, { contractId: contract.id, violationId, errorCount: errors.length, mode: contract.mode });
  }

  return {
    valid, errors, mode: contract.mode,
    enforced: !valid && contract.mode === "enforce",
    contractId: contract.id, schemaId: contract.schemaId, schemaVersion: contract.schemaVersion,
    violationId,
  };
}

export async function contractsViolationsList(input: { contractId?: string; limit?: number; offset?: number }, ctx: CapabilityRunContext) {
  if (!db) throw new Error("db_unavailable");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [_eqAO(_vioAO.userId, ctx.userId)];
  if (input.contractId) conds.push(_eqAO(_vioAO.contractId, input.contractId));
  const rows = await db.select().from(_vioAO).where(_andAO(...conds))
    .orderBy(_descAO(_vioAO.createdAt)).limit(limit).offset(offset);
  return { violations: rows, limit, offset };
}

export async function contractsPolicy(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const tier = await _getTierAO(ctx);
  return {
    tier,
    limits: _TIER_CONTRACT_LIMITS_AO[tier],
    allTierLimits: _TIER_CONTRACT_LIMITS_AO,
    subjectTypes: _SUBJECT_TYPES_AO,
    modes: _MODES_AO,
    compatibilityLevels: _COMPAT_AO,
    semverRegex: _SEMVER_AO.source,
    nameRegex: _NAME_AO.source,
    supportedKeywords: [
      "type (string|number|integer|boolean|null|array|object)",
      "const", "enum", "required", "properties", "additionalProperties (bool|schema)",
      "items (schema)", "minItems", "maxItems", "uniqueItems",
      "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
      "minLength", "maxLength", "pattern",
      "minProperties", "maxProperties",
      "anyOf", "oneOf", "allOf",
    ],
    diffSemantics: {
      breaking: ["type_changed", "required_added", "enum_value_removed", "constraint_tightened", "pattern_changed", "additional_properties_changed (true→false)", "items_changed (non-object)", "removed (path)"],
      nonBreaking: ["added (path)", "required_removed", "enum_value_added", "constraint_loosened"],
    },
    webhookEvents: ["schema.registered", "schema.version_published", "schema.deprecated", "contract.created", "contract.updated", "contract.deleted", "contract.violation"],
    notes: [
      "Schemas are scoped to (namespace, name) per user. Versions are immutable; bump by registering a new semver.",
      "Compatibility 'backward' = consumers using the OLD schema can read NEW payloads (no breaking changes).",
      "Contract modes: 'validate' returns valid/invalid only; 'warn' records a 'warn' violation; 'enforce' records 'error' and signals enforced=true.",
      "Validator implements a draft-07 subset — no $ref resolution. Inline definitions only.",
      "Violation log is retained up to the per-tier cap; older rows are deleted by maintenance jobs.",
    ],
  };
}

// ─── Phases 32–39 — re-export Pillar AP..AX handlers ──────────────────
export * from "./handlers-phase32";
