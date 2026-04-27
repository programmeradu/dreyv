/**
 * DACS — conditional trigger evaluator.
 *
 * Each subagent may carry a `trigger` jsonb spec. When present, the ticker
 * evaluates it BEFORE dispatching the child command. If the condition does
 * not hold, the tick is skipped (subagent stays active, next_run_at advances,
 * no work submitted).
 *
 * Four kinds, all share `op` + numeric `threshold` semantics where applicable:
 *
 *   1. price       — { kind:"price", symbol, op, value }                 e.g. SOL < 140
 *                    Uses CoinGecko `simple/price` (no key, public).
 *
 *   2. wallet      — { kind:"wallet", token, op, value }                 e.g. USDC < 10000
 *                    Uses Helius getTokenAccountsByOwner via HeliusClient.
 *
 *   3. news        — { kind:"news", query, op:"contains"|"any" }         e.g. "depeg USDC"
 *                    Uses TavilyClient quick search (last 24h).
 *
 *   4. handoff     — { kind:"handoff", specialist, riskLevel? }          e.g. risk_sentinel→critical
 *                    Reads dacs_handoffs for any matching report newer than last_eval_at.
 *
 * Any unknown / invalid spec returns { fired: true, reason: "no_trigger" }
 * so subagents without a trigger keep firing every tick (legacy behavior).
 */

import { db } from "@/db";
import { dacsHandoffs } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { coingeckoFeed } from "@/lib/datafeeds/coingecko";
import { TavilyClient } from "@/lib/tavily";
import { HeliusClient } from "@/lib/helius";

export type TriggerOp = "lt" | "gt" | "lte" | "gte" | "eq" | "contains" | "any";

export interface TriggerSpec {
  kind: "price" | "wallet" | "news" | "handoff";
  op?: TriggerOp;
  // price
  symbol?: string;          // CoinGecko id, e.g. "solana", "usd-coin"
  // wallet
  token?: string;           // SPL mint OR symbol the helius client recognises
  walletAddress?: string;   // override the subagent's wallet
  // news
  query?: string;
  // handoff
  specialist?: string;      // dacs_handoffs.specialist filter
  riskLevel?: string;       // optional report severity match
  // shared
  value?: number | string;
}

export interface TriggerEvalResult {
  fired: boolean;
  /** Human-readable reason (shown in subagent UI / inbox). */
  reason: string;
  /** Last observed value, for UI history. */
  lastValue?: number | string | null;
  evaluatedAt: number;
}

const NOT_FIRED = (reason: string, lastValue?: number | string | null): TriggerEvalResult => ({
  fired: false,
  reason,
  lastValue: lastValue ?? null,
  evaluatedAt: Date.now(),
});

const FIRED = (reason: string, lastValue?: number | string | null): TriggerEvalResult => ({
  fired: true,
  reason,
  lastValue: lastValue ?? null,
  evaluatedAt: Date.now(),
});

function compare(actual: number, op: TriggerOp, threshold: number): boolean {
  switch (op) {
    case "lt":  return actual < threshold;
    case "gt":  return actual > threshold;
    case "lte": return actual <= threshold;
    case "gte": return actual >= threshold;
    case "eq":  return actual === threshold;
    default:    return false;
  }
}

// ─── Price ────────────────────────────────────────────────────────────
async function evalPrice(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const symbol = String(spec.symbol ?? "").toLowerCase();
  const op = spec.op ?? "lt";
  const threshold = Number(spec.value);
  if (!symbol || !Number.isFinite(threshold)) {
    return NOT_FIRED("price_trigger_invalid_spec");
  }
  try {
    const events = await coingeckoFeed.fetch({ ids: [symbol] });
    const ev = events.find((e) => e.kind === "market" && e.symbol.toLowerCase() === symbol.toUpperCase().toLowerCase());
    const price =
      ev && ev.kind === "market" && typeof ev.priceUsd === "number"
        ? ev.priceUsd
        : null;
    if (price == null) return NOT_FIRED("price_unavailable");
    if (compare(price, op, threshold)) {
      return FIRED(`${symbol} ${op} ${threshold} (now ${price})`, price);
    }
    return NOT_FIRED(`${symbol}=${price} not ${op} ${threshold}`, price);
  } catch (err) {
    return NOT_FIRED(`price_eval_error:${(err as Error).message}`);
  }
}

// ─── Wallet / treasury ────────────────────────────────────────────────
async function evalWallet(spec: TriggerSpec, fallbackWallet: string | null): Promise<TriggerEvalResult> {
  const wallet = spec.walletAddress || fallbackWallet;
  const token = String(spec.token ?? "").trim();
  const op = spec.op ?? "lt";
  const threshold = Number(spec.value);
  if (!wallet || !token || !Number.isFinite(threshold)) {
    return NOT_FIRED("wallet_trigger_invalid_spec");
  }
  try {
    const helius = new HeliusClient();
    const portfolio = await helius.getPortfolio(wallet).catch(() => null);
    if (!portfolio) return NOT_FIRED("wallet_unavailable");
    const match = portfolio.find(
      (a) =>
        (a.symbol || "").toLowerCase() === token.toLowerCase() ||
        (a.mint || "") === token,
    );
    const balance = match ? Number(match.uiAmount ?? 0) : 0;
    if (compare(balance, op, threshold)) {
      return FIRED(`${token} balance ${op} ${threshold} (now ${balance})`, balance);
    }
    return NOT_FIRED(`${token}=${balance} not ${op} ${threshold}`, balance);
  } catch (err) {
    return NOT_FIRED(`wallet_eval_error:${(err as Error).message}`);
  }
}

// ─── News / sentiment ─────────────────────────────────────────────────
async function evalNews(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const query = String(spec.query ?? "").trim();
  if (!query) return NOT_FIRED("news_trigger_invalid_spec");
  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return NOT_FIRED("tavily_unavailable");
    const tavily = new TavilyClient(apiKey);
    // Quick search — tight topic, last 24h. We treat presence of any result
    // mentioning the query as "fired".
    const results = await tavily
      .search({ query, max_results: 5, search_depth: "basic" })
      .catch(() => null);
    const hits = Array.isArray(results) ? results.length : 0;
    if (spec.op === "any" || hits > 0) {
      const top = Array.isArray(results) && results[0]?.title ? String(results[0].title) : `${hits} hits`;
      return hits > 0 ? FIRED(`news match: ${top}`, hits) : NOT_FIRED("no news hits", 0);
    }
    return NOT_FIRED("no news hits", hits);
  } catch (err) {
    return NOT_FIRED(`news_eval_error:${(err as Error).message}`);
  }
}

// ─── Cross-agent handoff ──────────────────────────────────────────────
async function evalHandoff(
  spec: TriggerSpec,
  fallbackWallet: string | null,
  since: Date | null,
): Promise<TriggerEvalResult> {
  const specialist = String(spec.specialist ?? "").trim();
  if (!specialist || !db) return NOT_FIRED("handoff_trigger_invalid_spec");
  try {
    const sinceTs = since ?? new Date(Date.now() - 24 * 3600 * 1000);
    const conds = [eq(dacsHandoffs.specialist, specialist), gt(dacsHandoffs.createdAt, sinceTs)];
    if (fallbackWallet) conds.push(eq(dacsHandoffs.walletAddress, fallbackWallet));
    const rows = await db
      .select({ id: dacsHandoffs.id, riskLevel: dacsHandoffs.riskLevel })
      .from(dacsHandoffs)
      .where(and(...conds))
      .limit(5);
    if (rows.length === 0) return NOT_FIRED("no recent handoffs", 0);
    if (spec.riskLevel) {
      const match = rows.find((r) => (r.riskLevel || "").toLowerCase() === spec.riskLevel!.toLowerCase());
      if (!match) return NOT_FIRED(`no ${specialist} handoff at risk=${spec.riskLevel}`, rows.length);
      return FIRED(`${specialist} reported ${spec.riskLevel}`, rows.length);
    }
    return FIRED(`${specialist} reported ${rows.length} time(s)`, rows.length);
  } catch (err) {
    return NOT_FIRED(`handoff_eval_error:${(err as Error).message}`);
  }
}

/**
 * Public entry — evaluate a trigger spec for a subagent tick.
 *
 * @param spec        the trigger jsonb (may be null)
 * @param walletAddr  the subagent's wallet (used as fallback for wallet/handoff)
 * @param since       last_eval_at (used by handoff to scope new reports)
 */
export async function evaluateTrigger(
  spec: TriggerSpec | null | undefined,
  walletAddr: string | null,
  since: Date | null,
): Promise<TriggerEvalResult> {
  // No trigger configured → fire every tick (legacy interval-only behavior).
  if (!spec || typeof spec !== "object" || !spec.kind) {
    return FIRED("no_trigger");
  }
  switch (spec.kind) {
    case "price":   return evalPrice(spec);
    case "wallet":  return evalWallet(spec, walletAddr);
    case "news":    return evalNews(spec);
    case "handoff": return evalHandoff(spec, walletAddr, since);
    default:
      return NOT_FIRED(`unknown_trigger_kind:${spec.kind}`);
  }
}
