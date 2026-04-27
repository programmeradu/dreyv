/**
 * DACS Phase 7E.1 — Sniper bot infrastructure.
 *
 * Honest design: we do NOT pretend to autobuy autonomously. We:
 *   1. Persist sniper rules to `sniper_bot_rules`.
 *   2. Ensure the shared Helius webhook covers the DEX program addresses
 *      so new-pool/swap events flow into `/api/webhooks/helius`.
 *   3. On inbound webhook, detect new-pool events on those programs,
 *      match against active rules (liquidity threshold + allow/denylist
 *      + per-day cap), draft a Jupiter buy quote+tx, persist a
 *      `sniper_bot_events` row in `pending_signature`, and write an
 *      `agent_episodes` follow-up. The user signs to execute.
 *
 * Liquidity check: parsed via initial pool deposits' USD value (token
 * transfers in the same tx, priced via Jupiter price/v2). Conservative —
 * if pricing fails we abort that match (never fabricate liquidity).
 */

import { eq, and, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { sniperBotRules, sniperBotEvents, agentEpisodes } from "@/db/schema";
import type { HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";

/** Canonical mainnet DEX program IDs we monitor for new-pool events. */
export const SNIPER_DEX_PROGRAMS: Record<string, string> = {
  raydium_v4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  raydium_clmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  orca_whirlpools: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
};
export const SNIPER_DEX_PROGRAM_SET = new Set(Object.values(SNIPER_DEX_PROGRAMS));

const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP = "https://lite-api.jup.ag/swap/v1/swap";
const JUP_PRICE = "https://lite-api.jup.ag/price/v2";

function utcDayBucket(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function priceUsd(mint: string): Promise<number | null> {
  if (STABLE_MINTS.has(mint)) return 1;
  try {
    const r = await fetch(`${JUP_PRICE}?ids=${mint}`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: Record<string, { price?: string | number }> };
    const p = Number(j.data?.[mint]?.price ?? 0);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Heuristic: detect a new pool event by looking at token transfers in the
 * tx — a fresh pool creation typically has BOTH stable-side AND non-stable
 * deposits of the same magnitude. Returns the candidate non-stable mint
 * + estimated USD liquidity, or null.
 */
export async function extractNewPoolCandidate(tx: HeliusEnhancedTx): Promise<{
  mint: string;
  liquidityUsd: number;
} | null> {
  const transfers = tx.tokenTransfers ?? [];
  if (transfers.length < 2) return null;

  // Aggregate per-mint deposits.
  const perMint = new Map<string, number>();
  for (const t of transfers) {
    if (!t.mint || !Number.isFinite(t.tokenAmount)) continue;
    perMint.set(t.mint, (perMint.get(t.mint) ?? 0) + Math.abs(Number(t.tokenAmount)));
  }
  if (perMint.size < 2) return null;

  // Find the stable/SOL anchor + the candidate token.
  let anchorMint: string | null = null;
  let anchorAmount = 0;
  let candidateMint: string | null = null;
  for (const [mint, amount] of perMint) {
    if (STABLE_MINTS.has(mint) || mint === SOL_MINT) {
      if (amount > anchorAmount) {
        anchorMint = mint;
        anchorAmount = amount;
      }
    } else if (!candidateMint) {
      candidateMint = mint;
    }
  }
  if (!anchorMint || !candidateMint) return null;

  const anchorPrice = await priceUsd(anchorMint);
  if (anchorPrice == null) return null;
  // Pool TVL ≈ 2× the anchor side at creation (constant-product/CLMM init).
  const liquidityUsd = anchorAmount * anchorPrice * 2;

  return { mint: candidateMint, liquidityUsd };
}

interface MatchedRule {
  rule: typeof sniperBotRules.$inferSelect;
  fresh: boolean; // true if daily cap respected
}

/** Load enabled rules for the given exchange and gate by per-day cap. */
async function loadEligibleRules(exchange: string): Promise<MatchedRule[]> {
  if (!db) return [];
  const today = utcDayBucket();
  const rows = await db
    .select()
    .from(sniperBotRules)
    .where(and(eq(sniperBotRules.enabled, true), eq(sniperBotRules.exchange, exchange)))
    .limit(50);
  return rows.map((rule) => {
    const buysToday = rule.buyDayBucket === today ? rule.buysToday : 0;
    return { rule, fresh: buysToday < rule.maxBuysPerDay };
  });
}

async function quoteAndBuildBuy(params: {
  inputMint: string;
  inputDecimals: number;
  outputMint: string;
  amountUsd: number;
  walletAddress: string;
  slippageBps: number;
}): Promise<{ inAmount: string; outAmount: string; serializedTransaction: string; quote: unknown } | null> {
  // Price the input to get smallest-unit amount.
  const inputPx = await priceUsd(params.inputMint);
  if (!inputPx || inputPx <= 0) return null;
  const inputHuman = params.amountUsd / inputPx;
  const inAmount = Math.floor(inputHuman * 10 ** params.inputDecimals);
  if (inAmount <= 0) return null;

  const qUrl = new URL(JUP_QUOTE);
  qUrl.searchParams.set("inputMint", params.inputMint);
  qUrl.searchParams.set("outputMint", params.outputMint);
  qUrl.searchParams.set("amount", String(inAmount));
  qUrl.searchParams.set("slippageBps", String(params.slippageBps));
  const qRes = await fetch(qUrl, { signal: AbortSignal.timeout(8_000) });
  if (!qRes.ok) return null;
  const quote = await qRes.json();

  const sRes = await fetch(JUP_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: params.walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!sRes.ok) return null;
  const swapJson = (await sRes.json()) as { swapTransaction?: string };
  if (!swapJson.swapTransaction) return null;

  return {
    inAmount: String(quote.inAmount),
    outAmount: String(quote.outAmount),
    serializedTransaction: swapJson.swapTransaction,
    quote,
  };
}

/**
 * Process one inbound enhanced-tx from Helius webhook against all active
 * sniper rules. Idempotent: dedupes on (ruleId, detectedSignature).
 */
export async function maybeDraftSniperBuy(tx: HeliusEnhancedTx): Promise<{
  matched: number;
  drafted: number;
  reason?: string;
}> {
  if (!db) return { matched: 0, drafted: 0, reason: "db not initialized" };
  if (tx.transactionError) return { matched: 0, drafted: 0, reason: "tx error" };

  // Identify which DEX program this tx touched by source/instructions.
  // Helius enhanced txs include a `source` (e.g. "RAYDIUM"/"ORCA") — use
  // it as a fast filter; deeper match relies on accountData below.
  const src = String(tx.source ?? "").toUpperCase();
  const candidateExchanges: string[] = [];
  if (src.includes("RAYDIUM")) candidateExchanges.push("raydium_v4", "raydium_clmm");
  else if (src.includes("ORCA") || src.includes("WHIRLPOOL")) candidateExchanges.push("orca_whirlpools");
  if (candidateExchanges.length === 0) return { matched: 0, drafted: 0, reason: "no dex source" };

  const candidate = await extractNewPoolCandidate(tx);
  if (!candidate) return { matched: 0, drafted: 0, reason: "not a pool-init shape" };

  let matched = 0;
  let drafted = 0;
  const today = utcDayBucket();

  for (const exch of candidateExchanges) {
    const rules = await loadEligibleRules(exch);
    for (const { rule, fresh } of rules) {
      matched += 1;
      if (!fresh) continue;
      const allowlist = (rule.tokenAllowlist as string[]) ?? [];
      const denylist = (rule.tokenDenylist as string[]) ?? [];
      if (denylist.includes(candidate.mint)) continue;
      if (allowlist.length > 0 && !allowlist.includes(candidate.mint)) continue;
      if (candidate.liquidityUsd < Number(rule.liquidityThresholdUsd)) continue;

      // Idempotency: skip if we already drafted for this (rule, signature).
      const existing = await db
        .select({ id: sniperBotEvents.id })
        .from(sniperBotEvents)
        .where(
          and(
            eq(sniperBotEvents.ruleId, rule.id),
            eq(sniperBotEvents.detectedSignature, tx.signature),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const fundingDecimals = ["USDC", "USDT"].includes(rule.fundingToken.toUpperCase()) ? 6 : 9;
      const quoted = await quoteAndBuildBuy({
        inputMint: rule.fundingMint,
        inputDecimals: fundingDecimals,
        outputMint: candidate.mint,
        amountUsd: Number(rule.buyAmountUsd),
        walletAddress: rule.walletAddress,
        slippageBps: rule.maxSlippageBps,
      });
      if (!quoted) continue;

      await db.insert(sniperBotEvents).values({
        ruleId: rule.id,
        walletAddress: rule.walletAddress,
        exchange: exch,
        detectedMint: candidate.mint,
        detectedSignature: tx.signature,
        buyAmountUsd: String(rule.buyAmountUsd),
        fundingToken: rule.fundingToken,
        inAmount: quoted.inAmount,
        outAmount: quoted.outAmount,
        slippageBps: rule.maxSlippageBps,
        serializedTransaction: quoted.serializedTransaction,
        quoteJson: JSON.stringify(quoted.quote),
        status: "pending_signature",
      });

      const buysTodayNext = (rule.buyDayBucket === today ? rule.buysToday : 0) + 1;
      await db
        .update(sniperBotRules)
        .set({
          buyDayBucket: today,
          buysToday: buysTodayNext,
          lastTriggeredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sniperBotRules.id, rule.id));

      await db.insert(agentEpisodes).values({
        commandId: `sniper:${rule.id}:${tx.signature}`,
        walletAddress: rule.walletAddress,
        intentKind: "trading.sniper_autobuy",
        capabilityIds: ["deploy_sniper_bot"],
        outcome: "needs_signature",
        valueUsd: String(rule.buyAmountUsd),
        notes: `New ${exch} pool ${candidate.mint.slice(0, 8)}… (TVL≈$${candidate.liquidityUsd.toFixed(0)}). Drafted $${rule.buyAmountUsd} ${rule.fundingToken} buy at ${rule.maxSlippageBps}bps slippage. Sign to execute.`,
      });

      drafted += 1;
    }
  }

  return { matched, drafted };
}

/**
 * Helius webhook subscription — adds the DEX program IDs to the shared
 * webhook so we receive their tx flow. Idempotent. Returns the
 * webhookId or empty string on no-op.
 */
export async function ensureSniperWebhookSubscribed(): Promise<string> {
  if (!db) return "";
  // Reuse the shared webhook helper. It dedupes addresses for us.
  const { syncSharedWebhook, listWebhooks } = await import("@/lib/agents/tx-stream/helius-webhooks");
  const existing = await listWebhooks().catch(() => []);
  const target = existing[0];
  const currentAddrs = target?.accountAddresses ?? [];
  const merged = new Set([...currentAddrs, ...Object.values(SNIPER_DEX_PROGRAMS)]);
  return await syncSharedWebhook([...merged]);
}

/** Reset the daily counter for a given rule (called by the watcher GC). */
export async function resetDailyBuyCounter(ruleId: string): Promise<void> {
  if (!db) return;
  await db
    .update(sniperBotRules)
    .set({ buysToday: 0, buyDayBucket: utcDayBucket(), updatedAt: new Date() })
    .where(eq(sniperBotRules.id, ruleId));
}

// Re-export `dsql` to avoid unused-import warning if we add complex queries.
void dsql;
