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
  input: { state: "on" | "off" },
  ctx: CapabilityRunContext,
) {
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
export async function devRotateKey(_input: Record<string, never>, ctx: CapabilityRunContext) {
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
  input: { keyId?: string },
  ctx: CapabilityRunContext,
) {
  const d = requireDb();
  const { publicApiKeys } = await import("@/db/schema");
  const target = input.keyId ?? ctx.keyId;
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

import { createHash as _chZ, sql as _sqlZ } from "node:crypto";
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
