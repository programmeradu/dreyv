/**
 * Unified event shapes emitted by every data feed client and consumed by
 * the agent bus / scanner loops. Keep these stable — Inngest functions and
 * Durable Objects pattern-match on `kind`.
 */

export type Chain =
  | "solana"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "polygon"
  | "bsc"
  | "off-chain";

export interface BaseEvent {
  /** ISO timestamp the event was observed. */
  observedAt: string;
  /** Source feed id, e.g. "helius", "pyth", "defillama". */
  source: string;
  /** Optional correlation id (e.g. webhook delivery id). */
  correlationId?: string;
}

/** Realtime market price / quote update. */
export interface MarketEvent extends BaseEvent {
  kind: "market";
  symbol: string;
  mint?: string;
  chain: Chain;
  priceUsd: number;
  /** % change over a window if known. */
  changePct?: number;
  windowSec?: number;
}

/** On-chain action — wallet tx, swap, transfer, governance vote, etc. */
export interface ChainEvent extends BaseEvent {
  kind: "chain";
  chain: Chain;
  signatureOrHash: string;
  walletAddress?: string;
  type:
    | "transfer"
    | "swap"
    | "stake"
    | "unstake"
    | "vote"
    | "mint"
    | "burn"
    | "approve"
    | "unknown";
  amountUsd?: number;
  raw?: unknown;
}

/** A yield / pool / vault opportunity snapshot. */
export interface YieldEvent extends BaseEvent {
  kind: "yield";
  protocol: string;
  chain: Chain;
  poolId: string;
  asset: string;
  apy: number;
  tvlUsd: number;
  riskScore?: number; // 0-100, higher = riskier
}

/** Off-chain market intel (unlocks, narratives, social, funding). */
export interface IntelEvent extends BaseEvent {
  kind: "intel";
  topic:
    | "token_unlock"
    | "narrative"
    | "social"
    | "funding_rate"
    | "governance"
    | "news"
    | "other";
  symbol?: string;
  summary: string;
  url?: string;
  weight?: number; // arbitrary 0-1 importance
  payload?: Record<string, unknown>;
}

export type DreyvEvent = MarketEvent | ChainEvent | YieldEvent | IntelEvent;

/** Common contract every feed client implements. */
export interface DataFeed<TInput = unknown> {
  id: string;
  /** Returns one or more normalized events for the given input. */
  fetch(input: TInput): Promise<DreyvEvent[]>;
  /** True when the feed has the env it needs to actually run. */
  isReady(): boolean;
}
