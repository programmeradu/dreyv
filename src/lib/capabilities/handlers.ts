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
import { agentTreasuryWatchers, agentTxProposals, monitors, notifications, publicApiWebhooks, webhookDeliveries } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ALL_WEBHOOK_EVENTS,
  emitWebhookEvent,
  generateSigningSecret,
  type WebhookEventName,
} from "@/lib/webhooks/dispatcher";
import { buildPlanForAction } from "@/lib/agents/brains/executor-plans";

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


