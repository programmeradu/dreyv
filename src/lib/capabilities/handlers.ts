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
import { agentApiKeys, agentDeliverables, agentPayments, agentTreasuryWatchers, agentTxProposals, monitors, notifications, publicApiWebhooks, webhookDeliveries } from "@/db/schema";
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
  if (!input.signature || input.signature.length < 32) {
    throw new CapabilityError("signature is required (base58)", 400, null);
  }
  const status = await fetchSignatureStatus(input.signature);
  if (!status) {
    return {
      signature: input.signature,
      found: false,
      verifiedAt: new Date().toISOString(),
      note: "Signature not visible to this RPC node within transaction history window.",
    };
  }
  return {
    signature: input.signature,
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
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callLovableAI(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new CapabilityError("LOVABLE_API_KEY not configured", 503, null);
  const res = await fetch(LOVABLE_AI_URL, {
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
  });
  if (res.status === 429) throw new CapabilityError("Lovable AI rate-limited", 429, null);
  if (res.status === 402) throw new CapabilityError("Lovable AI credits exhausted", 402, null);
  if (!res.ok) throw new CapabilityError(`Lovable AI failed: ${res.status}`, 502, null);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
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
  let md: string;
  try {
    md = await markdown({ url: input.url });
  } catch (e: any) {
    throw new CapabilityError(`URL fetch failed: ${e?.message ?? "unknown"}`, 502, null);
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
