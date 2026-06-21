/**
 * Dreyv Public Capability Registry (Phase 1).
 *
 * Single source of truth for the public Web3 API + MCP surface. Each entry
 * declares one capability with a Zod input schema, a scope, side-effect class,
 * and a handler. REST routes (/api/v1/*) and the MCP server (/api/mcp) are
 * generated from this map — no drift between transports.
 *
 * This is distinct from src/lib/agents/capabilities (the internal DACS planner
 * registry). That one stays for the in-app agent; this one is the external
 * developer surface.
 */

import { z } from "zod";
import type { ApiScope } from "@/lib/api-keys/public-keys";
import * as caps from "./handlers";

export type SideEffect = "read" | "simulate" | "write";
export type Pillar = "identity" | "portfolio" | "market" | "execution" | "forensics" | "tax" | "foresight" | "agentic" | "economy";
export type Status = "stable" | "preview";

export interface PublicCapability<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** dot.path id, also the REST path: /api/v1/{id.replace(/\./g, '/')} */
  id: string;
  /** snake_case alias used as the MCP tool name. */
  mcpName: string;
  pillar: Pillar;
  scope: ApiScope;
  sideEffects: SideEffect;
  status: Status;
  title: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, ctx: CapabilityRunContext) => Promise<unknown>;
  /** Credits charged per successful call. 0 = free in Phase 1. */
  cost?: number;
}

export interface CapabilityRunContext {
  userId: string;
  keyId: string;
  origin: string;
  transport: "rest" | "mcp";
}

const Address = z.string().min(2).max(128);
const Chain = z.enum(["solana", "ethereum", "base", "arbitrum", "optimism", "polygon"]).default("solana");

export const CAPABILITIES: PublicCapability[] = [
  // ─── Pillar A — Identity & Resolution ─────────────────────────────────
  {
    id: "identity.resolve",
    mcpName: "dreyv_identity_resolve",
    pillar: "identity",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Resolve any Web3 name to an address",
    description:
      "Resolves ENS, SNS (.sol), Basenames, Lens, Farcaster handles, raw addresses — returns canonical address + reverse-resolved name + namespace.",
    inputSchema: z.object({
      identifier: z.string().min(1).describe("e.g. 'vitalik.eth', 'toly.sol', '0xabc…', '@dwr.eth'"),
    }),
    handler: (i, c) => caps.identityResolve(i, c),
  },
  {
    id: "identity.wallet_meta",
    mcpName: "dreyv_identity_wallet_meta",
    pillar: "identity",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Wallet metadata (first-seen, activity, classification)",
    description: "Returns wallet first-seen timestamp, dormancy, tx count, and best-guess classification (EOA / contract / CEX / bridge).",
    inputSchema: z.object({
      address: Address,
      chain: Chain,
    }),
    handler: (i, c) => caps.walletMeta(i, c),
  },
  {
    id: "identity.profile",
    mcpName: "dreyv_identity_profile",
    pillar: "identity",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Merged on-chain + social entity profile",
    description: "Combines resolved names, wallet meta, and known counterparty labels into one profile object.",
    inputSchema: z.object({ identifier: z.string().min(1) }),
    handler: (i, c) => caps.identityProfile(i, c),
  },
  // NOTE: identity.agent_lookup and identity.delegate_session were removed —
  // they had no real upstream (ERC-8004 and EIP-7702 land in Phase 3).
  // Per the no-fallbacks rule: a capability ships only when it returns real data.


  // ─── Pillar B — Portfolio & Treasury ──────────────────────────────────
  {
    id: "portfolio.holdings",
    mcpName: "dreyv_portfolio_holdings",
    pillar: "portfolio",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Unified multi-chain holdings",
    description: "All token holdings for a wallet on the requested chain, with USD prices and metadata.",
    inputSchema: z.object({
      address: Address,
      chain: Chain,
    }),
    handler: (i, c) => caps.portfolioHoldings(i, c),
  },
  {
    id: "portfolio.pnl",
    mcpName: "dreyv_portfolio_pnl",
    pillar: "portfolio",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "PnL & cost basis",
    description: "Realized + unrealized PnL with FIFO/LIFO/HIFO accounting.",
    inputSchema: z.object({
      address: Address,
      method: z.enum(["fifo", "lifo", "hifo"]).default("fifo"),
    }),
    handler: (i, c) => caps.portfolioPnl(i, c),
  },
  {
    id: "portfolio.defi_positions",
    mcpName: "dreyv_portfolio_defi_positions",
    pillar: "portfolio",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "DeFi positions across protocols",
    description: "Active DeFi positions (Kamino, Marinade, Jito, etc.) with TVL, APY, and risk score.",
    inputSchema: z.object({ address: Address, chain: Chain }),
    handler: (i, c) => caps.defiPositions(i, c),
  },
  {
    id: "treasury.health",
    mcpName: "dreyv_treasury_health",
    pillar: "portfolio",
    scope: "read:treasury",
    sideEffects: "read",
    status: "stable",
    title: "Treasury health summary",
    description: "Runway, diversification, concentration risk, and stablecoin ratio for a treasury wallet.",
    inputSchema: z.object({ address: Address, chain: Chain }),
    handler: (i, c) => caps.treasuryHealth(i, c),
  },
  {
    id: "treasury.multisig_pending",
    mcpName: "dreyv_treasury_multisig_pending",
    pillar: "portfolio",
    scope: "read:treasury",
    sideEffects: "read",
    status: "stable",
    title: "Pending multisig proposals",
    description: "Pending Squads (Solana) proposals for a multisig address. Safe (EVM) lands in Phase 2.",
    inputSchema: z.object({ multisigAddress: Address }),
    handler: (i, c) => caps.multisigPending(i, c),
  },

  // ─── Pillar C — Market & Discovery ────────────────────────────────────
  {
    id: "market.price",
    mcpName: "dreyv_market_price",
    pillar: "market",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Best-price oracle with confidence",
    description: "Returns USD price aggregated from Pyth → Jupiter → CoinGecko with source attribution.",
    inputSchema: z.object({
      token: z.string().describe("Symbol (SOL, ETH, USDC) or address/mint"),
      chain: Chain,
    }),
    handler: (i, c) => caps.marketPrice(i, c),
  },
  {
    id: "market.ohlcv",
    mcpName: "dreyv_market_ohlcv",
    pillar: "market",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "OHLCV candles",
    description: "Open/high/low/close/volume candles for a token over a window.",
    inputSchema: z.object({
      token: z.string(),
      chain: Chain,
      interval: z.enum(["5m", "15m", "1h", "4h", "1d"]).default("1h"),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    handler: (i, c) => caps.marketOhlcv(i, c),
  },
  {
    id: "market.token_forensics",
    mcpName: "dreyv_market_token_forensics",
    pillar: "market",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Token forensics (rug, mint/freeze, holder concentration)",
    description: "Rug-check signals, mint/freeze authorities, top-holder concentration, LP lock status.",
    inputSchema: z.object({ mintOrAddress: z.string(), chain: Chain }),
    handler: (i, c) => caps.tokenForensics(i, c),
  },
  {
    id: "market.defi_yields",
    mcpName: "dreyv_market_defi_yields",
    pillar: "market",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "DeFi yield opportunities",
    description: "DefiLlama yields filtered by asset, chain, min-TVL — annotated with Dreyv risk score.",
    inputSchema: z.object({
      asset: z.string().optional(),
      chain: Chain.optional(),
      minTvlUsd: z.number().nonnegative().default(1_000_000),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    handler: (i, c) => caps.defiYields(i, c),
  },
  // NOTE: market.discovery was removed — /api/atlas/trending is not built yet.
  // Per the no-fallbacks rule: it ships when there is a real trending feed.

  // ─── Pillar C — Market signals (Atlas) ───────────────────────────────
  {
    id: "market.trending",
    mcpName: "dreyv_market_trending",
    pillar: "market",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Trending tokens",
    description:
      "Real-time trending tokens. Solana = Jupiter trending; EVM = Moralis trending. Includes symbol, mint/address, icon, and (when available) 24h volume + price change.",
    inputSchema: z.object({
      chain: Chain,
      limit: z.number().int().min(1).max(20).default(8),
    }),
    handler: (i, c) => caps.marketTrending(i, c),
  },
  {
    id: "market.price_history",
    mcpName: "dreyv_market_price_history",
    pillar: "market",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Historical token price",
    description:
      "Historical USD price for a Solana token (symbol or mint), N days ago. Sourced via Birdeye → DexScreener → CoinGecko fallback chain at the upstream layer.",
    inputSchema: z.object({
      token: z.string().min(1).describe("Symbol (SOL, BONK) or Solana mint"),
      daysAgo: z.number().int().min(1).max(365).default(30),
    }),
    handler: (i, c) => caps.marketPriceHistory(i, c),
  },

  // ─── Pillar D — Execution: Swap / Bridge / Gas ───────────────────────
  {
    id: "swap.quote_solana",
    mcpName: "dreyv_swap_quote_solana",
    pillar: "execution",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Jupiter swap quote (Solana)",
    description:
      "Best-route swap quote on Solana via Jupiter. Accepts symbols (SOL, USDC) or raw mints. Returns price, route plan, price impact, fees.",
    inputSchema: z.object({
      inputMint: z.string().min(1),
      outputMint: z.string().min(1),
      amount: z.union([z.string(), z.number()]).transform((v) => String(v)).describe("Atomic units of inputMint"),
      slippageBps: z.number().int().min(0).max(10_000).optional(),
      onlyDirectRoutes: z.boolean().optional(),
    }),
    handler: (i, c) => caps.swapQuoteSolana(i, c),
  },
  {
    id: "swap.build_solana",
    mcpName: "dreyv_swap_build_solana",
    pillar: "execution",
    scope: "write:simulate",
    sideEffects: "simulate",
    status: "stable",
    title: "Build unsigned Jupiter swap transaction (Solana)",
    description:
      "Takes a Jupiter `quoteResponse` plus the user's public key and returns the serialized unsigned swap transaction. The caller signs and submits — Dreyv never holds keys.",
    inputSchema: z.object({
      quoteResponse: z.unknown(),
      userPublicKey: z.string().min(32).max(64),
      wrapAndUnwrapSol: z.boolean().optional(),
    }),
    handler: (i, c) => caps.swapBuildSolana(i, c),
  },
  {
    id: "swap.quote_evm",
    mcpName: "dreyv_swap_quote_evm",
    pillar: "execution",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "EVM swap quote (0x v2 Allowance Holder)",
    description:
      "Best-execution swap quote on EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon) via 0x v2. Symbols resolved per-chain; addresses pass through.",
    inputSchema: z.object({
      sellToken: z.string().min(1),
      buyToken: z.string().min(1),
      sellAmount: z.union([z.string(), z.number()]).transform((v) => String(v)).describe("Atomic units of sellToken"),
      chainId: z.number().int().describe("1=ETH, 8453=Base, 42161=Arbitrum, 10=Optimism, 137=Polygon"),
    }),
    handler: (i, c) => caps.swapQuoteEvm(i, c),
  },
  {
    id: "bridge.quote",
    mcpName: "dreyv_bridge_quote",
    pillar: "execution",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Cross-chain bridge quote (Rango)",
    description:
      "Cross-chain swap/bridge quote between EVM chains. Symbols accepted (ETH, USDC, etc.). Returns route, ETA, fees, output amount.",
    inputSchema: z.object({
      fromChain: z.enum(["ethereum", "arbitrum", "base", "polygon", "bsc"]),
      toChain: z.enum(["ethereum", "arbitrum", "base", "polygon", "bsc"]),
      fromToken: z.string().min(1),
      toToken: z.string().min(1).optional(),
      fromAmount: z.union([z.string(), z.number()]).transform((v) => String(v)),
    }),
    handler: (i, c) => caps.bridgeQuote(i, c),
  },
  {
    id: "gas.estimate",
    mcpName: "dreyv_gas_estimate",
    pillar: "execution",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "EVM gas estimate (EIP-1559 fee history)",
    description:
      "Live EIP-1559 base fee + priority fee percentiles for an EVM chain, computed from recent block fee history.",
    inputSchema: z.object({
      chain: z.enum(["ethereum", "arbitrum", "base", "polygon", "optimism"]),
      blocks: z.number().int().min(4).max(50).optional(),
    }),
    handler: (i, c) => caps.gasEstimate(i, c),
  },

  // ─── Pillar E — Risk & Forensics ─────────────────────────────────────
  {
    id: "risk.wallet",
    mcpName: "dreyv_risk_wallet",
    pillar: "forensics",
    scope: "read:forensics",
    sideEffects: "read",
    status: "stable",
    title: "Wallet risk profile (Solana)",
    description:
      "Composite wallet-level risk signals: dust exposure, sanctioned-counterparty hits, concentration, dormant/active state, scam-token holdings.",
    inputSchema: z.object({ address: Address }),
    handler: (i, c) => caps.riskWallet(i, c),
  },
  {
    id: "risk.edge_insights",
    mcpName: "dreyv_risk_edge_insights",
    pillar: "forensics",
    scope: "read:forensics",
    sideEffects: "read",
    status: "stable",
    title: "Dreyv Edge Insights",
    description:
      "Differentiator forensics for a wallet: fee waste, idle capital, dust reclaim, lost opportunities, DCA patterns, counterparty mix, next-best-move with $ impact.",
    inputSchema: z.object({ address: Address }),
    handler: (i, c) => caps.riskEdgeInsights(i, c),
  },
  {
    id: "wallet.narrative",
    mcpName: "dreyv_wallet_narrative",
    pillar: "forensics",
    scope: "read:forensics",
    sideEffects: "read",
    status: "stable",
    title: "AI narrative summary of a wallet",
    description:
      "Human-readable narrative explaining what a wallet is doing — composition, recent behavior, risk posture, suggested next step. Streamed at upstream; aggregated here.",
    inputSchema: z.object({ address: Address }),
    handler: (i, c) => caps.walletNarrative(i, c),
  },

  // ─── Pillar F — Tax & Accounting ─────────────────────────────────────
  {
    id: "tax.analyze",
    mcpName: "dreyv_tax_analyze",
    pillar: "tax",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Tax-aware portfolio analysis",
    description:
      "Capital gains (short/long), wash-sale risk detection, tax-loss harvesting opportunities, and projected tax impact of rebalance trades. POST with holdings, optional rebalance trades, and transaction history.",
    inputSchema: z.object({
      holdings: z.array(z.unknown()).min(1),
      rebalanceTrades: z.array(z.unknown()).optional(),
      userTransactionHistory: z.array(z.unknown()).optional(),
    }),
    handler: (i, c) => caps.taxAnalyze(i, c),
  },

  // ─── Pillar G — Foresight (Dreyv signature) ──────────────────────────
  {
    id: "foresight.simulate",
    mcpName: "dreyv_foresight_simulate",
    pillar: "foresight",
    scope: "write:simulate",
    sideEffects: "simulate",
    status: "stable",
    title: "Monte Carlo treasury foresight",
    description:
      "Runs N stochastic projection paths (Box-Muller noise) over a portfolio + what-if variables, returns P10/P50/P90 bands, depletion probability, median depletion month, and risk flags. Optional realized drift/vol priors anchor on actual treasury behavior.",
    inputSchema: z.object({
      portfolio: z.array(z.unknown()).min(1),
      variables: z.array(z.unknown()),
      timeframeMonths: z.number().int().min(1).max(120),
      granularity: z.enum(["weekly", "monthly"]).optional(),
      paths: z.number().int().min(10).max(2000).optional(),
      seed: z.number().int().optional(),
      priors: z
        .object({
          driftPctPerDay: z.number().optional(),
          volPctPerDay: z.number().optional(),
        })
        .optional(),
    }),
    handler: (i, c) => caps.foresightSimulate(i, c),
  },

  // ─── Pillar H — Agentic Delegation (Phase 3) ─────────────────────────
  {
    id: "agentic.delegation_request_solana",
    mcpName: "dreyv_agentic_delegation_request_solana",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "simulate",
    status: "stable",
    title: "Request Solana SPL token delegation (unsigned tx)",
    description:
      "Builds an unsigned SPL Token `Approve` instruction that, once signed by the user, lets a Dreyv delegate wallet pull up to `amount` of a token for `expiryDays`. Powers autonomous DCA and recurring agent actions without custodial keys.",
    inputSchema: z.object({
      walletAddress: Address,
      tokenMint: z.string().min(32).max(64),
      amount: z.number().positive(),
      expiryDays: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]),
    }),
    handler: (i, c) => caps.delegationRequestSolana(i, c),
  },
  {
    id: "agentic.delegation_status",
    mcpName: "dreyv_agentic_delegation_status",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Active delegations for a wallet",
    description:
      "Returns active SPL token delegations for a Solana wallet, grouped by token, with remaining amount and earliest expiry.",
    inputSchema: z.object({ walletAddress: Address }),
    handler: (i, c) => caps.delegationStatus(i, c),
  },

  // ─── Pillar I — x402 Economy primitives (Phase 3) ────────────────────
  {
    id: "economy.x402_catalog",
    mcpName: "dreyv_economy_x402_catalog",
    pillar: "economy",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "x402 capability advertisement",
    description: "Returns Dreyv's /.well-known/x402 — networks, accepted assets, protected routes, facilitator.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.economyX402Catalog(i, c),
  },
  {
    id: "economy.acp_catalog",
    mcpName: "dreyv_economy_acp_catalog",
    pillar: "economy",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Agentic Commerce Protocol discovery",
    description: "Returns Dreyv's /.well-known/acp.json — the ACP service catalog (marketplace, subscriptions, payments).",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.economyAcpCatalog(i, c),
  },
  {
    id: "economy.skus",
    mcpName: "dreyv_economy_skus",
    pillar: "economy",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "x402 SKU catalog",
    description:
      "Lists every Dreyv SKU an autonomous agent can purchase over x402 (price USD, fulfilment hint) plus the endpoints and auth required.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.economySkus(i, c),
  },

  // ─── Pillar J — Watchers, Monitors, Notifications (Phase 4) ──────────
  // DB-backed and strictly scoped to the API-key owner. Gated under
  // read:portfolio so the user's existing dk_live_… key works without
  // re-mint; in production these should require write:watchers /
  // read:notifications. Handlers enforce userId ownership regardless.
  {
    id: "watchers.list",
    mcpName: "dreyv_watchers_list",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List my treasury watchers",
    description: "All treasury watchers owned by the API-key owner, with chain, address, label, last-scan, and last-snapshot deltas.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.watchersList(i, c),
  },
  {
    id: "watchers.create",
    mcpName: "dreyv_watchers_create",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Create a treasury watcher",
    description: "Registers a wallet (Solana or EVM) for Dreyv's cadence sweepers. Deltas land in the inbox and via webhook (when configured).",
    inputSchema: z.object({
      chain: z.enum(["solana", "ethereum", "base", "arbitrum", "polygon", "bsc"]),
      address: Address,
      label: z.string().max(120).optional(),
    }),
    handler: (i, c) => caps.watchersCreate(i, c),
  },
  {
    id: "watchers.delete",
    mcpName: "dreyv_watchers_delete",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Deactivate a treasury watcher",
    description: "Soft-deletes a watcher by id (sets active=false). Scoped to the API-key owner.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.watchersDelete(i, c),
  },
  {
    id: "monitors.list",
    mcpName: "dreyv_monitors_list",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List my monitors",
    description: "All price / balance / APY / risk monitors owned by the API-key owner.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.monitorsList(i, c),
  },
  {
    id: "monitors.create",
    mcpName: "dreyv_monitors_create",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Create a monitor",
    description: "Creates a price / balance / APY / risk monitor. Evaluated by /api/monitors/evaluate on the Dreyv cron.",
    inputSchema: z.object({
      walletAddress: Address,
      type: z.enum(["price", "balance", "apy", "risk"]),
      target: z.string().min(1).max(120).describe("Token symbol, mint, or metric name"),
      operator: z.enum(["above", "below", "equals", "changes"]),
      conditionValue: z.number(),
      active: z.boolean().optional(),
    }),
    handler: (i, c) => caps.monitorsCreate(i, c),
  },
  {
    id: "monitors.delete",
    mcpName: "dreyv_monitors_delete",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Deactivate a monitor",
    description: "Soft-deletes a monitor by numeric id. Scoped to the API-key owner.",
    inputSchema: z.object({ id: z.number().int().positive() }),
    handler: (i, c) => caps.monitorsDelete(i, c),
  },
  {
    id: "notifications.list",
    mcpName: "dreyv_notifications_list",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List my notifications",
    description: "Returns notifications for the API-key owner with unread count. Filter by `unreadOnly` and cap by `limit` (max 100).",
    inputSchema: z.object({
      unreadOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    handler: (i, c) => caps.notificationsList(i, c),
  },
  {
    id: "notifications.mark_read",
    mcpName: "dreyv_notifications_mark_read",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Mark notifications read",
    description: "Marks specific notification ids as read, or all unread for the owner when `all: true`.",
    inputSchema: z
      .object({
        ids: z.array(z.number().int().positive()).optional(),
        all: z.boolean().optional(),
      })
      .refine((v) => v.all === true || (Array.isArray(v.ids) && v.ids.length > 0), {
        message: "Provide either `all: true` or a non-empty `ids` array",
      }),
    handler: (i, c) => caps.notificationsMarkRead(i, c),
  },
];

const byId = new Map(CAPABILITIES.map((c) => [c.id, c]));
const byMcpName = new Map(CAPABILITIES.map((c) => [c.mcpName, c]));

export function getCapabilityById(id: string): PublicCapability | undefined {
  return byId.get(id);
}

export function getCapabilityByMcpName(name: string): PublicCapability | undefined {
  return byMcpName.get(name);
}

export function listPublicCapabilities(): PublicCapability[] {
  return CAPABILITIES;
}

/** REST path slug, e.g. "portfolio.holdings" → "portfolio/holdings". */
export function restPathFor(cap: PublicCapability): string {
  return cap.id.replace(/\./g, "/");
}

export function findCapabilityByRestPath(slug: string[]): PublicCapability | undefined {
  const id = slug.join(".");
  return byId.get(id);
}
