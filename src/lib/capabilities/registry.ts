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
