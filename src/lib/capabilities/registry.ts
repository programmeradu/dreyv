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
export type Pillar = "identity" | "portfolio" | "market" | "execution" | "forensics" | "tax" | "foresight" | "agentic" | "economy" | "reasoning" | "knowledge" | "governance" | "defi" | "developer" | "safety" | "compliance" | "notifications";
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

  // ─── Pillar K — Outbound Webhooks (Phase 5) ──────────────────────────
  // Gated under read:portfolio so existing dk_live_… keys work; handlers
  // strictly scope every read/write to ctx.userId. Signing secret is
  // returned only on create + rotate_secret — never on list/get.
  {
    id: "webhooks.list",
    mcpName: "dreyv_webhooks_list",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List my webhooks",
    description: "All webhook subscriptions owned by the API-key owner. signingSecret is redacted.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.webhooksList(i, c),
  },
  {
    id: "webhooks.create",
    mcpName: "dreyv_webhooks_create",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Create a webhook",
    description:
      "Registers an HTTPS endpoint to receive signed events. Returns signingSecret ONCE — store it now. Events are HMAC-SHA256 signed over `${t}.${rawBody}` and delivered with up to 3 retries (immediate, +2s, +8s).",
    inputSchema: z.object({
      label: z.string().min(1).max(120),
      targetUrl: z.string().url(),
      events: z.array(z.string().min(1)).min(1).describe("Event names or ['*'] for all"),
    }),
    handler: (i, c) => caps.webhooksCreate(i, c),
  },
  {
    id: "webhooks.update",
    mcpName: "dreyv_webhooks_update",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Update a webhook (label / url / events / active)",
    description: "Partial update. Pass only fields you want to change. Re-validates HTTPS + event names.",
    inputSchema: z.object({
      id: z.string().uuid(),
      label: z.string().min(1).max(120).optional(),
      targetUrl: z.string().url().optional(),
      events: z.array(z.string().min(1)).min(1).optional(),
      active: z.boolean().optional(),
    }),
    handler: (i, c) => caps.webhooksUpdate(i, c),
  },
  {
    id: "webhooks.rotate_secret",
    mcpName: "dreyv_webhooks_rotate_secret",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Rotate webhook signing secret",
    description: "Generates a new signingSecret for the webhook. The old secret is invalidated immediately. New secret returned once.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.webhooksRotateSecret(i, c),
  },
  {
    id: "webhooks.delete",
    mcpName: "dreyv_webhooks_delete",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Delete a webhook",
    description: "Hard-deletes a webhook and cascades its delivery history.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.webhooksDelete(i, c),
  },
  {
    id: "webhooks.deliveries",
    mcpName: "dreyv_webhooks_deliveries",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Recent webhook deliveries",
    description: "Per-attempt delivery log: event, payload, http status, response body (first 4KiB), latency, error. Filter by webhookId / status.",
    inputSchema: z.object({
      webhookId: z.string().uuid().optional(),
      status: z.enum(["ok", "failed", "pending"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: (i, c) => caps.webhooksDeliveries(i, c),
  },
  {
    id: "webhooks.replay",
    mcpName: "dreyv_webhooks_replay",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Replay a past delivery",
    description: "Re-fans the same event payload through the dispatcher (still signed, still retries). Original deliveryId is recorded as `_replay_of` in the data envelope.",
    inputSchema: z.object({ deliveryId: z.string().uuid() }),
    handler: (i, c) => caps.webhooksReplay(i, c),
  },
  {
    id: "webhooks.test",
    mcpName: "dreyv_webhooks_test",
    pillar: "agentic",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Send a test event",
    description: "Fires `test.ping` (or any subscribed event) to a single webhook. Useful for verifying signature verification end-to-end before going live.",
    inputSchema: z.object({
      id: z.string().uuid(),
      event: z.string().optional(),
    }),
    handler: (i, c) => caps.webhooksTest(i, c),
  },

  // ─── Pillar L — Signed Intents & Execution Receipts (Phase 6) ───────
  // Compile an intent into a wallet-signable plan, submit the signature,
  // verify on-chain. Server NEVER signs; Solana RPC is required (no fallback).
  // Gated under read:portfolio so existing dk_live_… keys work; all rows
  // strictly scoped to ctx.userId.
  {
    id: "intents.compile",
    mcpName: "dreyv_intents_compile",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Compile a signable intent",
    description:
      "Builds an ExecutorPlan (Jupiter swap / Marinade stake / Kamino+MarginFi yield / SPL transfer / rebalance) and persists it as a queued intent. The caller signs locally and submits the signature via intents.submit. Returns the unsigned plan + warnings + estimated fee.",
    inputSchema: z.object({
      op: z.enum(["swap", "stake", "unstake", "deposit_yield", "withdraw", "rebalance", "transfer"]),
      params: z.record(z.string(), z.unknown()).default({}),
      chain: z.literal("solana").default("solana"),
      routing: z.enum(["wallet", "multisig"]).optional(),
      multisigVault: z.string().optional(),
      ttlMinutes: z.number().int().min(1).max(1440).optional(),
      riskLevel: z.enum(["low", "medium", "high"]).optional(),
    }),
    handler: (i, c) => caps.intentsCompile(i, c),
  },
  {
    id: "intents.submit",
    mcpName: "dreyv_intents_submit",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Record a broadcast signature for an intent",
    description:
      "After your wallet signs and broadcasts the plan, POST the resulting base58 transaction signature here. We mark the intent submitted and start tracking on-chain status for receipts.get.",
    inputSchema: z.object({
      id: z.string().uuid(),
      signature: z.string().min(32).max(128),
    }),
    handler: (i, c) => caps.intentsSubmit(i, c),
  },
  {
    id: "intents.status",
    mcpName: "dreyv_intents_status",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Get current state of one intent",
    description: "Returns the persisted intent row (status, signature, timestamps, plan) without an on-chain lookup.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.intentsStatus(i, c),
  },
  {
    id: "intents.list",
    mcpName: "dreyv_intents_list",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List your intents",
    description: "Lists intents owned by the API-key holder. Filter by status.",
    inputSchema: z.object({
      status: z.enum(["queued", "approved", "submitted", "confirmed", "failed", "rejected", "expired"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: (i, c) => caps.intentsList(i, c),
  },
  {
    id: "intents.cancel",
    mcpName: "dreyv_intents_cancel",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Cancel a queued intent",
    description: "Marks the intent rejected. Fails if the intent has already been submitted on-chain — chain-level cancellation is the caller's responsibility.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.intentsCancel(i, c),
  },
  {
    id: "receipts.get",
    mcpName: "dreyv_receipts_get",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Get execution receipt for an intent",
    description:
      "Returns the intent row PLUS a live Solana RPC lookup of the broadcast signature. Auto-promotes the intent to 'confirmed' when the RPC reports confirmed/finalized, or to 'failed' when it reports an error. 503 if RPC is unreachable — no fallback.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.receiptsGet(i, c),
  },
  {
    id: "receipts.verify",
    mcpName: "dreyv_receipts_verify",
    pillar: "execution",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Verify any Solana signature on-chain",
    description: "Calls getSignatureStatuses on the configured Solana RPC. Returns slot, confirmationStatus, confirmations, and err. No persistence required.",
    inputSchema: z.object({
      signature: z.string().min(32).max(128),
      chain: z.literal("solana").default("solana"),
    }),
    handler: (i, c) => caps.receiptsVerify(i, c),
  },

  // ─── Pillar M — Agent Economy mutators (Phase 7) ────────────────────
  // Drive checkout / pay / deliverables / wallet through a single dk_ key.
  // Internally calls the dak_-protected x402 routes with a CRON_SECRET-
  // backed trust header. Settles real USDC on Solana mainnet — no stubs.
  // Gated under pay:x402 (existing scope) BUT mapped also to read:portfolio
  // so current keys can drive it without re-mint.
  {
    id: "economy.skus_extended",
    mcpName: "dreyv_economy_skus_extended",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List all purchasable SKUs",
    description: "Full SKU catalog with name, description, USD price, and fulfilment hint. Use the SKU id with economy.checkout / economy.pay.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.economySkusExtended(i, c),
  },
  {
    id: "economy.checkout",
    mcpName: "dreyv_economy_checkout",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Quote an x402 checkout",
    description:
      "Returns the 402-style quote for a SKU: USDC-on-Solana settlement details plus any card rails (Stripe / Paystack) available. The caller chooses a rail; this endpoint never debits the agent wallet on its own — use economy.pay for autonomous settlement.",
    inputSchema: z.object({
      sku: z.string().min(1).max(200),
      rail: z.enum(["solana", "stripe", "paystack"]).optional(),
      chain: z.literal("solana").optional(),
      asset: z.enum(["usdc", "usdt"]).optional(),
    }),
    handler: (i, c) => caps.economyCheckout(i, c),
  },
  {
    id: "economy.pay",
    mcpName: "dreyv_economy_pay",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Autonomously settle + fulfil a SKU",
    description:
      "End-to-end: mints invoice, settles USDC from your hosted agent wallet, records the deliverable, emails the API-key owner. Returns the receipt token PLUS a permanent deliverable id. Returns 402 with funding instructions when underfunded, 409 when treasury wallet is ambiguous.",
    inputSchema: z.object({
      sku: z.string().min(1).max(200),
      target_wallet: z.string().min(32).max(44).optional(),
    }),
    handler: (i, c) => caps.economyPay(i, c),
  },
  {
    id: "economy.deliverables.list",
    mcpName: "dreyv_economy_deliverables_list",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "List my deliverables",
    description: "All deliverables produced by economy.pay for this account, most recent first. Filter by kind.",
    inputSchema: z.object({
      kind: z.enum(["snapshot", "report", "subscription"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: (i, c) => caps.economyDeliverablesList(i, c),
  },
  {
    id: "economy.deliverables.get",
    mcpName: "dreyv_economy_deliverables_get",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Get one deliverable (full payload)",
    description: "Returns the full deliverable row including payload + PDF URL + email delivery status.",
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: (i, c) => caps.economyDeliverablesGet(i, c),
  },
  {
    id: "economy.wallet.address",
    mcpName: "dreyv_economy_wallet_address",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "write",
    status: "stable",
    title: "Get (or provision) hosted agent wallet address",
    description: "Returns the Solana address of the API-key owner's hosted agent wallet, provisioning one on first call. Includes USDC mint + a Solana Pay URI for funding the SOL float.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.economyWalletAddress(i, c),
  },
  {
    id: "economy.wallet.balance",
    mcpName: "dreyv_economy_wallet_balance",
    pillar: "economy",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Live agent wallet balance",
    description: "Live USDC + SOL balance from Solana RPC. 502 if RPC unreachable — no fallback.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.economyWalletBalance(i, c),
  },

  // ─── Pillar N — Reasoning & Knowledge ──────────────────────────────
  {
    id: "reasoning.ask",
    mcpName: "dreyv_reasoning_ask",
    pillar: "reasoning",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Ask the Dreyv reasoning model a question",
    description:
      "One-shot LLM call grounded against optional context and/or the caller's knowledge memory. Returns answer + sources. Uses Lovable AI Gateway; surfaces 429/402 on rate-limit / credit exhaustion.",
    inputSchema: z.object({
      question: z.string().min(1).max(4000),
      context: z.string().max(16000).optional(),
      ground_with_memory: z.boolean().optional(),
      model: z.string().optional(),
    }),
    handler: (i, c) => caps.reasoningAsk(i, c),
  },
  {
    id: "reasoning.summarize",
    mcpName: "dreyv_reasoning_summarize",
    pillar: "reasoning",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Summarize arbitrary text",
    description: "Compresses up to ~16k chars into bullets / paragraph / tldr, capped by max_words.",
    inputSchema: z.object({
      text: z.string().min(20).max(16000),
      style: z.enum(["bullets", "paragraph", "tldr"]).optional(),
      max_words: z.number().int().min(20).max(500).optional(),
    }),
    handler: (i, c) => caps.reasoningSummarize(i, c),
  },
  {
    id: "reasoning.clarify",
    mcpName: "dreyv_reasoning_clarify",
    pillar: "reasoning",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Generate clarifying questions for a vague intent",
    description: "Given a fuzzy agent intent, returns targeted chip/radio questions an orchestrator can render to a user before execution.",
    inputSchema: z.object({
      intent: z.string().min(3).max(1500),
      max_questions: z.number().int().min(1).max(5).optional(),
    }),
    handler: (i, c) => caps.reasoningClarify(i, c),
  },
  {
    id: "reasoning.research",
    mcpName: "dreyv_reasoning_research",
    pillar: "reasoning",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Multi-source web research (Tavily + Jina + Firecrawl)",
    description: "Runs Dreyv's KnowledgeBase study pipeline — returns summary, sources, and raw content. Set depth='deep' for full 20k content + strict 404 when no sources found.",
    inputSchema: z.object({
      query: z.string().min(2).max(500),
      depth: z.enum(["shallow", "deep"]).optional(),
    }),
    handler: (i, c) => caps.reasoningResearch(i, c),
  },
  {
    id: "knowledge.read_url",
    mcpName: "dreyv_knowledge_read_url",
    pillar: "knowledge",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Fetch a URL as markdown (Cloudflare browser)",
    description: "Renders any public URL to markdown via Cloudflare's headless browser. 502 if upstream fails — no fabrication.",
    inputSchema: z.object({
      url: z.string().url(),
      max_chars: z.number().int().min(500).max(30000).optional(),
    }),
    handler: (i, c) => caps.knowledgeReadUrl(i, c),
  },
  {
    id: "knowledge.recall",
    mcpName: "dreyv_knowledge_recall",
    pillar: "knowledge",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Search the caller's knowledge memory",
    description: "ILIKE search across title/summary/url/tags in the user-scoped knowledge_entries store.",
    inputSchema: z.object({
      query: z.string().min(1).max(300),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    handler: (i, c) => caps.knowledgeRecall(i, c),
  },
  {
    id: "knowledge.store",
    mcpName: "dreyv_knowledge_store",
    pillar: "knowledge",
    scope: "write:intent",
    sideEffects: "write",
    status: "stable",
    title: "Persist a knowledge entry for later recall",
    description: "Stores a titled markdown entry (cap 50KB) scoped to the calling API key's owner. Surface again via knowledge.recall or reasoning.ask{ground_with_memory:true}.",
    inputSchema: z.object({
      title: z.string().min(1).max(300),
      content: z.string().min(1).max(50000),
      summary: z.string().max(2000).optional(),
      sourceUrl: z.string().url().optional(),
      tags: z.array(z.string().min(1).max(60)).max(20).optional(),
    }),
    handler: (i, c) => caps.knowledgeStore(i, c),
  },
  // ─── Pillar P — Governance & Multisig (Phase 9) ─────────────────────
  {
    id: "governance.proposals",
    mcpName: "dreyv_governance_proposals",
    pillar: "governance",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Live Squads proposals for a vault",
    description: "Fetches live proposal state from the Solana RPC via Dreyv's cached Squads proxy. 10s server cache. 502 if RPC unreachable.",
    inputSchema: z.object({
      vault: Address,
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: (i, c) => caps.governanceProposalsLive(i, c),
  },
  {
    id: "governance.proposals_cached",
    mcpName: "dreyv_governance_proposals_cached",
    pillar: "governance",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "DB-mirrored Squads proposals (fast, no RPC)",
    description: "Reads the vault_proposals mirror — no RPC hit. Use governance.sync to refresh from chain.",
    inputSchema: z.object({
      vault: Address,
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: (i, c) => caps.governanceProposalsCached(i, c),
  },
  {
    id: "governance.sync",
    mcpName: "dreyv_governance_sync",
    pillar: "governance",
    scope: "write:watchers",
    sideEffects: "write",
    status: "stable",
    title: "Refresh the proposals mirror from chain",
    description: "Pulls live Squads state and upserts into vault_proposals. Caller must belong to a team that owns the vault (or vault must be unattached).",
    inputSchema: z.object({ vaultAddress: Address }),
    handler: (i, c) => caps.governanceSync(i, c),
  },
  {
    id: "governance.vote_tx",
    mcpName: "dreyv_governance_vote_tx",
    pillar: "governance",
    scope: "write:intent",
    sideEffects: "simulate",
    status: "stable",
    title: "Build an unsigned Approve/Reject/Cancel/Execute tx",
    description: "Returns a base64 serialized Solana tx for the named member to sign and broadcast. Never holds keys — the wallet executes the vote/execute against the Squads program.",
    inputSchema: z.object({
      multisig: Address,
      transactionIndex: z.number().int().min(1),
      action: z.enum(["Approve", "Reject", "Cancel", "Execute"]),
      member: Address,
    }),
    handler: (i, c) => caps.governanceVoteTx(i, c),
  },
  // ─── Pillar Q — DeFi primitives (Phase 10) ──────────────────────────
  {
    id: "defi.swap_quote",
    mcpName: "dreyv_defi_swap_quote",
    pillar: "defi",
    scope: "read:market",
    sideEffects: "read",
    status: "stable",
    title: "Jupiter route quote",
    description: "Full Jupiter v1 route quote with route plan, price impact, and slippage. Pass the returned quoteResponse into defi.swap_tx to build the unsigned tx.",
    inputSchema: z.object({
      inputMint: Address,
      outputMint: Address,
      amount: z.string().regex(/^\d+$/).describe("Amount in input token's minor units (lamports / atoms)"),
      slippageBps: z.number().int().min(1).max(10000).optional(),
      onlyDirectRoutes: z.boolean().optional(),
    }),
    handler: (i, c) => caps.defiSwapQuote(i, c),
  },
  {
    id: "defi.swap_tx",
    mcpName: "dreyv_defi_swap_tx",
    pillar: "defi",
    scope: "write:intent",
    sideEffects: "simulate",
    status: "stable",
    title: "Build an unsigned Jupiter swap tx",
    description: "Given a quoteResponse from defi.swap_quote, returns a base64 serialized swap tx for the user to sign. Never holds keys.",
    inputSchema: z.object({
      quoteResponse: z.record(z.string(), z.unknown()),
      userPublicKey: Address,
      wrapAndUnwrapSol: z.boolean().optional(),
      asLegacyTransaction: z.boolean().optional(),
    }),
    handler: (i, c) => caps.defiSwapTx(i, c),
  },
  {
    id: "defi.stake_sol_tx",
    mcpName: "dreyv_defi_stake_sol_tx",
    pillar: "defi",
    scope: "write:intent",
    sideEffects: "simulate",
    status: "stable",
    title: "Build an unsigned Marinade SOL→mSOL stake tx",
    description: "Returns a base64 serialized legacy Solana tx that deposits SOL to Marinade for mSOL. Caller signs with the named userPublicKey.",
    inputSchema: z.object({
      userPublicKey: Address,
      amountLamports: z.number().int().positive().describe("Lamports to stake (1 SOL = 1_000_000_000)"),
    }),
    handler: (i, c) => caps.defiStakeSolTx(i, c),
  },

  // ─── Pillar R — Developer & Metering (Phase 10) ─────────────────────
  {
    id: "developer.key_info",
    mcpName: "dreyv_developer_key_info",
    pillar: "developer",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Inspect the calling API key",
    description: "Returns label, env, prefix, scopes, rate-limit, and last-used timestamp for the key making the call. Key secret is never returned.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.devKeyInfo(i, c),
  },
  {
    id: "developer.usage",
    mcpName: "dreyv_developer_usage",
    pillar: "developer",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Usage summary for the calling key",
    description: "Aggregates capability calls, errors, latency, and credit spend over the last N hours (max 720) grouped by capability + status + transport.",
    inputSchema: z.object({
      window_hours: z.number().int().min(1).max(720).optional(),
    }),
    handler: (i, c) => caps.devUsageSummary(i, c),
  },
  {
    id: "developer.capabilities",
    mcpName: "dreyv_developer_capabilities",
    pillar: "developer",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Discover all capabilities (self-describing surface)",
    description: "Returns the full registry — id, mcpName, pillar, scope, sideEffects, title, description. Optionally filter by pillar or scope. Use this to bootstrap an agent's tool list dynamically.",
    inputSchema: z.object({
      pillar: z.string().optional(),
      scope: z.string().optional(),
    }),
    handler: (i, c) => caps.devCapabilitiesList(i, c),
  },

  // ─── Pillar S — Safety & Policy (Phase 11) ──────────────────────────
  {
    id: "safety.policy",
    mcpName: "dreyv_safety_policy",
    pillar: "safety",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Inspect this key's policy (kill switch, allowlists, scopes, rate-limit)",
    description: "Returns the active policy snapshot for the calling key: kill-switch state, capability/origin/IP allowlists, scopes, rate-limit, and revocation status.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.safetyPolicy(i, c),
  },
  {
    id: "safety.kill_switch",
    mcpName: "dreyv_safety_kill_switch",
    pillar: "safety",
    scope: "agent:delegate",
    sideEffects: "write",
    status: "stable",
    title: "Engage or release the per-key kill switch",
    description: "Instantly disables (state='on') or re-enables (state='off') every capability for this key. The change applies on the next request — no propagation delay. Audit-logged.",
    inputSchema: z.object({ state: z.enum(["on", "off"]) }),
    handler: (i, c) => caps.safetyKillSwitch(i, c),
  },
  {
    id: "safety.allowlist_set",
    mcpName: "dreyv_safety_allowlist_set",
    pillar: "safety",
    scope: "agent:delegate",
    sideEffects: "write",
    status: "stable",
    title: "Set the IP, origin, or capability allowlist for this key",
    description: "Replaces (not appends) the named allowlist. Pass [] to clear and reopen that dimension. IPv4 + /N CIDR for 'ip'; host[:port] for 'origin'; registered capability ids for 'capability'. Max 64 entries.",
    inputSchema: z.object({
      kind: z.enum(["ip", "origin", "capability"]),
      values: z.array(z.string().min(1).max(256)).max(64),
    }),
    handler: (i, c) => caps.safetyAllowlistSet(i, c),
  },
  {
    id: "safety.audit_log",
    mcpName: "dreyv_safety_audit_log",
    pillar: "safety",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Tamper-evident audit log for this key",
    description: "Returns the hash-chained audit entries (most recent first) for kill-switch flips, allowlist changes, attestations, rotations, and revocations. Includes chain validity flag.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }),
    handler: (i, c) => caps.safetyAuditLog(i, c),
  },
  {
    id: "safety.rate_status",
    mcpName: "dreyv_safety_rate_status",
    pillar: "safety",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Current rate-limit window usage",
    description: "Reports configured RPM, usage in the last 60s (from the metering table), and remaining capacity for this key.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.safetyRateStatus(i, c),
  },
  {
    id: "safety.attest",
    mcpName: "dreyv_safety_attest",
    pillar: "safety",
    scope: "agent:delegate",
    sideEffects: "write",
    status: "stable",
    title: "Mint a signed JWT attestation for downstream verifiers",
    description: "Produces a short-lived HS256 JWT that downstream services (or another agent) can verify against the Dreyv shared secret. Carries pseudonymous subject, key prefix, scopes, env, and arbitrary extra claims. TTL 30–3600s.",
    inputSchema: z.object({
      audience: z.string().min(1).max(200),
      ttlSec: z.number().int().min(30).max(3600).optional(),
      claims: z.record(z.unknown()).optional(),
    }),
    handler: (i, c) => caps.safetyAttest(i, c),
  },

  // ─── Developer — key lifecycle (Phase 11) ───────────────────────────
  {
    id: "developer.rotate_key",
    mcpName: "dreyv_developer_rotate_key",
    pillar: "developer",
    scope: "agent:delegate",
    sideEffects: "write",
    status: "stable",
    title: "Rotate the calling key — mint a new secret, revoke the old",
    description: "Atomically mints a new key with the same scopes/label/rate-limit, then revokes the current key. The new full secret is returned ONCE in the response — store it immediately.",
    inputSchema: z.object({}).strict(),
    handler: (i, c) => caps.devRotateKey(i, c),
  },
  {
    id: "developer.revoke_key",
    mcpName: "dreyv_developer_revoke_key",
    pillar: "developer",
    scope: "agent:delegate",
    sideEffects: "write",
    status: "stable",
    title: "Revoke a key by id (defaults to the calling key)",
    description: "Hard-revokes a key owned by the same user. After revocation, the key returns 401 on every transport. Idempotent.",
    inputSchema: z.object({ keyId: z.string().uuid().optional() }),
    handler: (i, c) => caps.devRevokeKey(i, c),
  },

  // ─── Pillar T — Compliance & Reporting (Phase 12) ────────────────────
  {
    id: "compliance.screen_address",
    mcpName: "dreyv_compliance_screen_address",
    pillar: "compliance",
    scope: "read:forensics",
    sideEffects: "read",
    status: "stable",
    title: "Sanctions / pattern screen for a single address",
    description: "Checks an address against the configured OFAC SDN-style denylist (DREYV_OFAC_SDN_ADDRESSES) and obvious zero/burn patterns. Returns ok=true with no hits, or ok=false with the hit reasons and source. List version is a SHA-256 prefix so callers can detect changes.",
    inputSchema: z.object({ address: Address, chain: Chain }),
    handler: (i, c) => caps.complianceScreenAddress(i, c),
  },
  {
    id: "compliance.travel_rule",
    mcpName: "dreyv_compliance_travel_rule",
    pillar: "compliance",
    scope: "agent:delegate",
    sideEffects: "simulate",
    status: "preview",
    title: "Build an IVMS101-lite Travel Rule envelope",
    description: "Deterministic transform: takes originator + beneficiary + transfer details and returns a canonical IVMS101-lite envelope plus its SHA-256 digest. Caller transmits to the counterparty VASP. No data is persisted by Dreyv.",
    inputSchema: z.object({
      originator: z.object({
        name: z.string().min(1).max(200),
        address: Address,
        vaspId: z.string().max(200).optional(),
        country: z.string().length(2).optional(),
      }),
      beneficiary: z.object({
        name: z.string().min(1).max(200),
        address: Address,
        vaspId: z.string().max(200).optional(),
        country: z.string().length(2).optional(),
      }),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      asset: z.string().min(1).max(32),
      chain: Chain,
      purpose: z.string().max(500).optional(),
    }),
    handler: (i, c) => caps.complianceTravelRule(i, c),
  },
  {
    id: "compliance.proof_of_reserves",
    mcpName: "dreyv_compliance_proof_of_reserves",
    pillar: "compliance",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Signed proof-of-reserves snapshot for an address",
    description: "Fetches live holdings for the address, computes a SHA-256 commitment over the canonical snapshot JSON, and mints an HS256 JWT (1h TTL) carrying the commitment so downstream verifiers can attest the figure was produced by Dreyv at a specific time.",
    inputSchema: z.object({ address: Address, chain: Chain }),
    handler: (i, c) => caps.complianceProofOfReserves(i, c),
  },
  {
    id: "reporting.export",
    mcpName: "dreyv_reporting_export",
    pillar: "compliance",
    scope: "read:portfolio",
    sideEffects: "read",
    status: "stable",
    title: "Export holdings or PnL as CSV or JSON (inline, signed by hash)",
    description: "Pulls live holdings or PnL lots for the address, serializes to CSV or JSON, returns the base64-encoded body, byte length, content-type, and SHA-256 — sufficient for the agent to write the file and verify integrity without a second round-trip.",
    inputSchema: z.object({
      kind: z.enum(["holdings", "pnl"]),
      format: z.enum(["csv", "json"]),
      address: Address,
      chain: Chain,
      method: z.enum(["fifo", "lifo", "hifo"]).optional(),
    }),
    handler: (i, c) => caps.reportingExport(i, c),
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
