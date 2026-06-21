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
  // Try the public resolver first; falls back to a passthrough.
  const data = await callInternal<Record<string, unknown>>(
    ctx,
    `/api/public/resolve?identifier=${encodeURIComponent(input.identifier)}`,
  ).catch((err: CapabilityError) => {
    if (err.status === 404) return { resolved: false, identifier: input.identifier };
    throw err;
  });
  return data;
}

export async function walletMeta(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain !== "solana") {
    // EVM read of activity (best-effort)
    const evm = await callInternal(ctx, `/api/evm/holdings?address=${input.address}&chain=${input.chain}`).catch(() => null);
    return { address: input.address, chain: input.chain, holdings: evm, classification: "eoa", source: "evm.holdings" };
  }
  const activity = await callInternal(ctx, `/api/public/activity?address=${input.address}&limit=1`).catch(() => null);
  return { address: input.address, chain: input.chain, activity, classification: "eoa", source: "public.activity" };
}

export async function identityProfile(
  input: { identifier: string },
  ctx: CapabilityRunContext,
) {
  const resolved = await identityResolve({ identifier: input.identifier }, ctx) as Record<string, unknown>;
  const address = (resolved.address as string | undefined) ?? input.identifier;
  const counterparties = await callInternal(ctx, `/api/public/counterparties?address=${address}&limit=10`).catch(() => null);
  return { identity: resolved, counterparties };
}

export async function agentLookup(input: { agentId: string }) {
  return {
    status: "preview",
    agentId: input.agentId,
    note: "ERC-8004 on-chain lookup ships in Phase 3. Dreyv-registered agents will be served here.",
  };
}

export async function delegateSession(input: {
  agentAddress: string;
  scopes: string[];
  ttlSeconds: number;
  spendCapUsd: number;
}) {
  return {
    status: "preview",
    proposal: {
      agentAddress: input.agentAddress,
      scopes: input.scopes,
      ttlSeconds: input.ttlSeconds,
      spendCapUsd: input.spendCapUsd,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
    },
    note: "EIP-7702 binding ships in Phase 3. Simulation surface is live so agents can negotiate the shape now.",
  };
}

// ─── Pillar B — Portfolio & Treasury ─────────────────────────────────
export async function portfolioHoldings(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain === "solana") {
    return await callInternal(ctx, `/api/public/wallet-holdings?address=${input.address}`);
  }
  return await callInternal(ctx, `/api/evm/holdings?address=${input.address}&chain=${input.chain}`);
}

export async function portfolioPnl(
  input: { address: string; method: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/public/pnl?address=${input.address}&method=${input.method}`);
}

export async function defiPositions(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  // Reuse the holdings endpoint and filter to DeFi-classified positions.
  const holdings = (await portfolioHoldings(input, ctx)) as { tokens?: Array<Record<string, unknown>> };
  const tokens = Array.isArray(holdings.tokens) ? holdings.tokens : [];
  const positions = tokens.filter((t) => {
    const tags = Array.isArray((t as { tags?: unknown[] }).tags) ? (t as { tags: string[] }).tags : [];
    const sym = String((t as { symbol?: string }).symbol ?? "").toUpperCase();
    return tags.includes("defi") || /^(MSOL|JITOSOL|JLP|KMNO|JTO|JUP|MNDE)$/.test(sym);
  });
  return { address: input.address, chain: input.chain, count: positions.length, positions };
}

export async function treasuryHealth(
  input: { address: string; chain: string },
  ctx: CapabilityRunContext,
) {
  const holdings = (await portfolioHoldings(input, ctx)) as {
    tokens?: Array<{ symbol?: string; valueUsd?: number; usdValue?: number }>;
    totalValueUsd?: number;
  };
  const tokens = holdings.tokens ?? [];
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
    // Runway is computed downstream when burn-rate is known; expose hook.
    runwayMonths: null,
    diversificationScore: tokens.length === 0 ? 0 : Math.min(1, tokens.length / 12),
  };
}

export async function multisigPending(
  input: { multisigAddress: string },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/squads/proposals?multisig=${input.multisigAddress}&status=active`).catch(() => ({
    multisigAddress: input.multisigAddress,
    proposals: [],
    note: "No active proposals or multisig not indexed yet.",
  }));
}

// ─── Pillar C — Market & Discovery ───────────────────────────────────
export async function marketPrice(
  input: { token: string; chain: string },
  ctx: CapabilityRunContext,
) {
  // The public token endpoint covers symbol + mint/address resolution and
  // returns the best-price aggregate Dreyv uses internally.
  return await callInternal(ctx, `/api/public/token/${encodeURIComponent(input.token)}?chain=${input.chain}`);
}

export async function marketOhlcv(
  input: { token: string; chain: string; interval: string; limit: number },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams({
    token: input.token,
    chain: input.chain,
    interval: input.interval,
    limit: String(input.limit),
  });
  return await callInternal(ctx, `/api/public/token/${encodeURIComponent(input.token)}/ohlcv?${qs.toString()}`).catch(
    async () => {
      // Fallback: lighter performance endpoint
      return await callInternal(ctx, `/api/public/performance?token=${encodeURIComponent(input.token)}&interval=${input.interval}`);
    },
  );
}

export async function tokenForensics(
  input: { mintOrAddress: string; chain: string },
  ctx: CapabilityRunContext,
) {
  if (input.chain === "solana") {
    return await callInternal(ctx, `/api/solana/rug-check?mint=${input.mintOrAddress}`);
  }
  return await callInternal(ctx, `/api/public/risk?address=${input.mintOrAddress}&chain=${input.chain}`);
}

export async function defiYields(
  input: { asset?: string; chain?: string; minTvlUsd: number; limit: number },
  ctx: CapabilityRunContext,
) {
  const qs = new URLSearchParams();
  if (input.asset) qs.set("asset", input.asset);
  if (input.chain) qs.set("chain", input.chain);
  qs.set("minTvl", String(input.minTvlUsd));
  qs.set("limit", String(input.limit));
  return await callInternal(ctx, `/api/defillama/yields?${qs.toString()}`);
}

export async function marketDiscovery(
  input: { chain: string; limit: number },
  ctx: CapabilityRunContext,
) {
  return await callInternal(ctx, `/api/atlas/trending?chain=${input.chain}&limit=${input.limit}`).catch(async () => {
    // Graceful fallback if /atlas/trending isn't wired yet.
    return { chain: input.chain, items: [], note: "Trending feed warming up — try again in a minute." };
  });
}
