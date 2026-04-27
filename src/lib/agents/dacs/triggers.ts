/**
 * DACS — conditional trigger evaluator (v2).
 *
 * Each subagent may carry a `trigger` jsonb spec. When present, the ticker
 * evaluates it BEFORE dispatching the child command. If the condition does
 * not hold, the tick is skipped (subagent stays active, next_run_at advances,
 * no work submitted).
 *
 * Supported kinds:
 *
 *   1. price        — { kind:"price", symbol, op, value }
 *                     CoinGecko spot price vs threshold.
 *
 *   2. price_change — { kind:"price_change", symbol, op, value, windowMinutes }
 *                     % change over a sliding window. Uses CoinGecko
 *                     market_chart for the lookback baseline.
 *
 *   3. wallet       — { kind:"wallet", token, op, value }
 *                     Helius getAssetsByOwner balance vs threshold.
 *
 *   4. tx           — { kind:"tx", op:"gt"|"gte"|"any", value? }
 *                     New on-chain signatures for the wallet since last_eval_at
 *                     (polled via Helius RPC getSignaturesForAddress).
 *
 *   5. yield        — { kind:"yield", pool, op, value }
 *                     DefiLlama /yields APY for a given pool id vs threshold.
 *
 *   6. unlock       — { kind:"unlock", symbol, op:"lte", value }  // days
 *                     Fires when a token has an upcoming unlock within N days.
 *
 *   7. sentiment    — { kind:"sentiment", symbol, op, value }     // 0..100
 *                     LunarCrush galaxy_score vs threshold.
 *
 *   8. news         — { kind:"news", query, op:"contains"|"any" }
 *                     Tavily search (24h). Falls back to Firecrawl /search
 *                     if Tavily key missing or call fails.
 *
 *   9. handoff      — { kind:"handoff", specialist, riskLevel? }
 *                     Cross-agent: new dacs_handoffs from a specialist.
 *
 *  10. all / any    — { kind:"all"|"any", children: TriggerSpec[] }
 *                     Compound boolean composition (AND / OR). Children are
 *                     evaluated sequentially; "any" short-circuits on first
 *                     fired child, "all" short-circuits on first non-fired.
 *
 * Any unknown / invalid spec returns { fired: false, reason }. A null/missing
 * spec fires every tick (legacy interval-only behavior).
 */

import { db } from "@/db";
import { dacsHandoffs } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { coingeckoFeed } from "@/lib/datafeeds/coingecko";
import { TavilyClient } from "@/lib/tavily";
import { HeliusClient } from "@/lib/helius";
import { FirecrawlClient } from "@/lib/firecrawl";
import { lunarCrushFeed } from "@/lib/datafeeds/lunarcrush";
import { tokenUnlocksFeed } from "@/lib/datafeeds/tokenunlocks";

export type TriggerOp = "lt" | "gt" | "lte" | "gte" | "eq" | "contains" | "any";

export type TriggerKind =
  | "price"
  | "price_change"
  | "wallet"
  | "tx"
  | "yield"
  | "unlock"
  | "sentiment"
  | "news"
  | "handoff"
  | "all"
  | "any";

export interface TriggerSpec {
  kind: TriggerKind;
  op?: TriggerOp;
  // price / price_change / sentiment / unlock
  symbol?: string;
  windowMinutes?: number;        // price_change window
  // wallet / tx
  token?: string;
  walletAddress?: string;
  // yield
  pool?: string;                 // DefiLlama pool id
  // news
  query?: string;
  // handoff
  specialist?: string;
  riskLevel?: string;
  // shared
  value?: number | string;
  // composite
  children?: TriggerSpec[];
}

export interface TriggerEvalResult {
  fired: boolean;
  reason: string;
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
  if (!symbol || !Number.isFinite(threshold)) return NOT_FIRED("price_trigger_invalid_spec");
  try {
    const events = await coingeckoFeed.fetch({ ids: [symbol] });
    const ev = events.find((e) => e.kind === "market");
    const price = ev && ev.kind === "market" && typeof ev.priceUsd === "number" ? ev.priceUsd : null;
    if (price == null) return NOT_FIRED("price_unavailable");
    if (compare(price, op, threshold)) return FIRED(`${symbol} ${op} ${threshold} (now ${price})`, price);
    return NOT_FIRED(`${symbol}=${price} not ${op} ${threshold}`, price);
  } catch (err) {
    return NOT_FIRED(`price_eval_error:${(err as Error).message}`);
  }
}

// ─── Price rate-of-change ─────────────────────────────────────────────
async function evalPriceChange(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const symbol = String(spec.symbol ?? "").toLowerCase();
  const op = spec.op ?? "lt";
  const threshold = Number(spec.value);            // % change, e.g. -5 for "drops 5%"
  const windowMinutes = Math.max(5, Number(spec.windowMinutes ?? 60));
  if (!symbol || !Number.isFinite(threshold)) return NOT_FIRED("price_change_invalid_spec");
  try {
    const days = Math.max(1, Math.ceil(windowMinutes / (60 * 24)));
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NOT_FIRED(`coingecko_${res.status}`);
    const json = (await res.json()) as { prices?: Array<[number, number]> };
    const series = json?.prices ?? [];
    if (series.length < 2) return NOT_FIRED("price_change_no_series");
    const now = series[series.length - 1][1];
    const cutoff = Date.now() - windowMinutes * 60_000;
    const baselinePoint = [...series].reverse().find(([t]) => t <= cutoff) ?? series[0];
    const baseline = baselinePoint[1];
    const pct = baseline ? ((now - baseline) / baseline) * 100 : 0;
    if (compare(pct, op, threshold)) {
      return FIRED(`${symbol} Δ${pct.toFixed(2)}% over ${windowMinutes}m ${op} ${threshold}%`, pct);
    }
    return NOT_FIRED(`${symbol} Δ${pct.toFixed(2)}% not ${op} ${threshold}%`, pct);
  } catch (err) {
    return NOT_FIRED(`price_change_error:${(err as Error).message}`);
  }
}

// ─── Wallet / treasury ────────────────────────────────────────────────
async function evalWallet(spec: TriggerSpec, fallbackWallet: string | null): Promise<TriggerEvalResult> {
  const wallet = spec.walletAddress || fallbackWallet;
  const token = String(spec.token ?? "").trim();
  const op = spec.op ?? "lt";
  const threshold = Number(spec.value);
  if (!wallet || !token || !Number.isFinite(threshold)) return NOT_FIRED("wallet_trigger_invalid_spec");
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return NOT_FIRED("helius_unavailable");
  try {
    const helius = new HeliusClient(apiKey);
    const portfolio = await helius
      .getAssetsByOwner(wallet)
      .catch(() => [] as Array<{ mint: string; symbol: string; amount: number }>);
    const match = portfolio.find(
      (a: { mint: string; symbol: string }) =>
        (a.symbol || "").toLowerCase() === token.toLowerCase() || (a.mint || "") === token,
    );
    const balance = match ? Number((match as { amount?: number }).amount ?? 0) : 0;
    if (compare(balance, op, threshold)) return FIRED(`${token} balance ${op} ${threshold} (now ${balance})`, balance);
    return NOT_FIRED(`${token}=${balance} not ${op} ${threshold}`, balance);
  } catch (err) {
    return NOT_FIRED(`wallet_eval_error:${(err as Error).message}`);
  }
}

// ─── Tx stream (new on-chain activity) ────────────────────────────────
async function evalTx(
  spec: TriggerSpec,
  fallbackWallet: string | null,
  since: Date | null,
): Promise<TriggerEvalResult> {
  const wallet = spec.walletAddress || fallbackWallet;
  if (!wallet) return NOT_FIRED("tx_trigger_no_wallet");
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return NOT_FIRED("helius_unavailable");
  const op = spec.op ?? "any";
  const threshold = Number(spec.value ?? 1);
  const sinceMs = since ? since.getTime() : Date.now() - 60 * 60 * 1000;
  try {
    const rpc = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "trig-tx",
        method: "getSignaturesForAddress",
        params: [wallet, { limit: 25 }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return NOT_FIRED(`helius_rpc_${res.status}`);
    const json = (await res.json()) as { result?: Array<{ blockTime?: number }> };
    const sigs = json?.result ?? [];
    const fresh = sigs.filter((s) => (s.blockTime ?? 0) * 1000 > sinceMs).length;
    if (op === "any" ? fresh > 0 : compare(fresh, op, threshold)) {
      return FIRED(`${fresh} new tx since ${new Date(sinceMs).toISOString()}`, fresh);
    }
    return NOT_FIRED(`only ${fresh} new tx (need ${op} ${threshold})`, fresh);
  } catch (err) {
    return NOT_FIRED(`tx_eval_error:${(err as Error).message}`);
  }
}

// ─── Yield (DefiLlama pool APY) ───────────────────────────────────────
async function evalYield(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const pool = String(spec.pool ?? "").trim();
  const op = spec.op ?? "gte";
  const threshold = Number(spec.value);
  if (!pool || !Number.isFinite(threshold)) return NOT_FIRED("yield_trigger_invalid_spec");
  try {
    const res = await fetch(`https://yields.llama.fi/chart/${encodeURIComponent(pool)}`, { cache: "no-store" });
    if (!res.ok) {
      // fallback: pull whole pools list
      const all = await fetch("https://yields.llama.fi/pools", { cache: "no-store" });
      if (!all.ok) return NOT_FIRED(`defillama_${res.status}`);
      const j = (await all.json()) as { data?: Array<{ pool: string; apy?: number }> };
      const row = (j?.data ?? []).find((p) => p.pool === pool);
      const apy = row?.apy ?? null;
      if (apy == null) return NOT_FIRED("yield_pool_not_found");
      return compare(apy, op, threshold)
        ? FIRED(`pool ${pool} APY ${apy.toFixed(2)}% ${op} ${threshold}%`, apy)
        : NOT_FIRED(`pool ${pool} APY ${apy.toFixed(2)}% not ${op} ${threshold}%`, apy);
    }
    const json = (await res.json()) as { data?: Array<{ apy?: number }> };
    const series = json?.data ?? [];
    const apy = series.length ? Number(series[series.length - 1].apy ?? 0) : null;
    if (apy == null) return NOT_FIRED("yield_no_data");
    return compare(apy, op, threshold)
      ? FIRED(`pool ${pool} APY ${apy.toFixed(2)}% ${op} ${threshold}%`, apy)
      : NOT_FIRED(`pool ${pool} APY ${apy.toFixed(2)}% not ${op} ${threshold}%`, apy);
  } catch (err) {
    return NOT_FIRED(`yield_eval_error:${(err as Error).message}`);
  }
}

// ─── Token unlock proximity ───────────────────────────────────────────
async function evalUnlock(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const symbol = String(spec.symbol ?? "").toUpperCase();
  const op = spec.op ?? "lte";
  const days = Number(spec.value);
  if (!symbol || !Number.isFinite(days)) return NOT_FIRED("unlock_trigger_invalid_spec");
  try {
    const events = await tokenUnlocksFeed.fetch({ withinDays: Math.max(1, days * 2) });
    const hit = events.find((e) => e.kind === "intel" && (e.symbol || "").toUpperCase() === symbol);
    if (!hit || hit.kind !== "intel") return NOT_FIRED(`no upcoming unlock for ${symbol}`);
    const at = (hit.payload as { unlockAt?: string })?.unlockAt;
    const daysOut = at ? Math.round((new Date(at).getTime() - Date.now()) / 86_400_000) : Number.POSITIVE_INFINITY;
    return compare(daysOut, op, days)
      ? FIRED(`${symbol} unlocks in ${daysOut}d (${op} ${days})`, daysOut)
      : NOT_FIRED(`${symbol} unlocks in ${daysOut}d not ${op} ${days}`, daysOut);
  } catch (err) {
    return NOT_FIRED(`unlock_eval_error:${(err as Error).message}`);
  }
}

// ─── Sentiment (LunarCrush galaxy_score) ──────────────────────────────
async function evalSentiment(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const symbol = String(spec.symbol ?? "").toUpperCase();
  const op = spec.op ?? "lt";
  const threshold = Number(spec.value);
  if (!symbol || !Number.isFinite(threshold)) return NOT_FIRED("sentiment_trigger_invalid_spec");
  if (!lunarCrushFeed.isReady?.()) return NOT_FIRED("lunarcrush_unavailable");
  try {
    const events = await lunarCrushFeed.fetch({ symbols: [symbol], limit: 5 });
    const hit = events.find((e) => e.kind === "intel" && (e.symbol || "").toUpperCase() === symbol);
    const score = hit && hit.kind === "intel" ? Number((hit.payload as { galaxy_score?: number })?.galaxy_score ?? 0) : null;
    if (score == null) return NOT_FIRED(`no sentiment for ${symbol}`);
    return compare(score, op, threshold)
      ? FIRED(`${symbol} galaxy=${score} ${op} ${threshold}`, score)
      : NOT_FIRED(`${symbol} galaxy=${score} not ${op} ${threshold}`, score);
  } catch (err) {
    return NOT_FIRED(`sentiment_eval_error:${(err as Error).message}`);
  }
}

// ─── News (Tavily → Firecrawl fallback) ───────────────────────────────
async function evalNews(spec: TriggerSpec): Promise<TriggerEvalResult> {
  const query = String(spec.query ?? "").trim();
  if (!query) return NOT_FIRED("news_trigger_invalid_spec");

  // 1. Tavily primary
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const tavily = new TavilyClient(tavilyKey);
      const results = await tavily.search(query, "basic").catch(() => null);
      const hits = Array.isArray(results) ? results.length : 0;
      if (hits > 0) {
        const top = results![0]?.title ? String(results![0].title) : `${hits} hits`;
        return FIRED(`news (tavily): ${top}`, hits);
      }
    } catch {
      /* fall through to firecrawl */
    }
  }

  // 2. Firecrawl fallback — gives Dreyv broader research context
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!fcKey) return NOT_FIRED(tavilyKey ? "news_no_hits" : "no_research_provider");
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 5, tbs: "qdr:d" }),
    });
    if (!res.ok) return NOT_FIRED(`firecrawl_${res.status}`);
    const json = (await res.json()) as { data?: Array<{ title?: string; url?: string }> };
    const hits = json?.data?.length ?? 0;
    if (hits > 0) {
      const top = json!.data![0]?.title || json!.data![0]?.url || `${hits} hits`;
      return FIRED(`news (firecrawl): ${top}`, hits);
    }
    return NOT_FIRED("no news hits", 0);
  } catch (err) {
    return NOT_FIRED(`firecrawl_error:${(err as Error).message}`);
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
      .select({ id: dacsHandoffs.id, status: dacsHandoffs.status })
      .from(dacsHandoffs)
      .where(and(...conds))
      .limit(5);
    if (rows.length === 0) return NOT_FIRED("no recent handoffs", 0);
    if (spec.riskLevel) {
      const match = rows.find((r) => (r.status || "").toLowerCase() === spec.riskLevel!.toLowerCase());
      if (!match) return NOT_FIRED(`no ${specialist} handoff at status=${spec.riskLevel}`, rows.length);
      return FIRED(`${specialist} reported status=${spec.riskLevel}`, rows.length);
    }
    return FIRED(`${specialist} reported ${rows.length} time(s)`, rows.length);
  } catch (err) {
    return NOT_FIRED(`handoff_eval_error:${(err as Error).message}`);
  }
}

// ─── Composite (AND / OR) ─────────────────────────────────────────────
async function evalComposite(
  spec: TriggerSpec,
  walletAddr: string | null,
  since: Date | null,
): Promise<TriggerEvalResult> {
  const children = Array.isArray(spec.children) ? spec.children : [];
  if (children.length === 0) return NOT_FIRED("composite_no_children");
  const reasons: string[] = [];
  if (spec.kind === "any") {
    for (const c of children) {
      const r = await evaluateTrigger(c, walletAddr, since);
      reasons.push(`${c.kind}:${r.fired ? "✓" : "✗"} ${r.reason}`);
      if (r.fired) return FIRED(`any → ${reasons.join(" | ")}`, r.lastValue);
    }
    return NOT_FIRED(`any → ${reasons.join(" | ")}`);
  }
  // "all"
  for (const c of children) {
    const r = await evaluateTrigger(c, walletAddr, since);
    reasons.push(`${c.kind}:${r.fired ? "✓" : "✗"} ${r.reason}`);
    if (!r.fired) return NOT_FIRED(`all → ${reasons.join(" | ")}`);
  }
  return FIRED(`all → ${reasons.join(" | ")}`);
}

/**
 * Public entry — evaluate a trigger spec for a subagent tick.
 */
export async function evaluateTrigger(
  spec: TriggerSpec | null | undefined,
  walletAddr: string | null,
  since: Date | null,
): Promise<TriggerEvalResult> {
  if (!spec || typeof spec !== "object" || !spec.kind) return FIRED("no_trigger");
  switch (spec.kind) {
    case "price":         return evalPrice(spec);
    case "price_change":  return evalPriceChange(spec);
    case "wallet":        return evalWallet(spec, walletAddr);
    case "tx":            return evalTx(spec, walletAddr, since);
    case "yield":         return evalYield(spec);
    case "unlock":        return evalUnlock(spec);
    case "sentiment":     return evalSentiment(spec);
    case "news":          return evalNews(spec);
    case "handoff":       return evalHandoff(spec, walletAddr, since);
    case "all":
    case "any":           return evalComposite(spec, walletAddr, since);
    default:              return NOT_FIRED(`unknown_trigger_kind:${spec.kind}`);
  }
}
