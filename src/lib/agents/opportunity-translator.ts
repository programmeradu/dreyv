/**
 * Opportunity translator.
 *
 * Converts low-level on-chain `ChainEvent`s (Helius webhook, Jito MEV, etc.)
 * into high-signal `agent.opportunity.surfaced` events that the brain router
 * (`brains/functions.ts → OpportunityRouter`) can triage + escalate.
 *
 * Heuristics here are intentionally conservative — we'd rather drop noise
 * than overwhelm the deep-reasoning brain (which costs Gemini tokens).
 *
 * The triage brain (`groq-triage.ts`) gets a final say with `drop | watch | escalate`.
 */
import type { ChainEvent } from "@/lib/datafeeds/normalize";
import { publish } from "@/lib/agents/bus";

export interface ChainOpportunity {
  reason: string;
  observedAt: string;
  signature?: string;
  walletAddress?: string;
  chain: string;
  type: string;
  amountUsd?: number;
  raw?: unknown;
}

const LARGE_TX_USD = 5_000;
const WHALE_TX_USD = 100_000;

/** Return null if the event isn't worth surfacing. */
export function chainEventToOpportunity(evt: ChainEvent): ChainOpportunity | null {
  const amt = typeof evt.amountUsd === "number" ? evt.amountUsd : 0;
  const t = evt.type;

  // Material swaps / transfers
  if ((t === "swap" || t === "transfer") && amt >= LARGE_TX_USD) {
    return {
      reason:
        amt >= WHALE_TX_USD
          ? `whale_${t}_${Math.round(amt / 1000)}k_usd`
          : `large_${t}_${Math.round(amt / 1000)}k_usd`,
      observedAt: evt.observedAt,
      signature: evt.signatureOrHash,
      walletAddress: evt.walletAddress,
      chain: evt.chain,
      type: t,
      amountUsd: amt,
      raw: evt.raw,
    };
  }

  // Governance vote — always surface (low frequency, high signal)
  if (t === "vote") {
    return {
      reason: "governance_vote_observed",
      observedAt: evt.observedAt,
      signature: evt.signatureOrHash,
      walletAddress: evt.walletAddress,
      chain: evt.chain,
      type: t,
      amountUsd: amt || undefined,
      raw: evt.raw,
    };
  }

  // Stake / unstake — surface if >$1k
  if ((t === "stake" || t === "unstake") && amt >= 1000) {
    return {
      reason: `${t}_${Math.round(amt / 1000)}k_usd`,
      observedAt: evt.observedAt,
      signature: evt.signatureOrHash,
      walletAddress: evt.walletAddress,
      chain: evt.chain,
      type: t,
      amountUsd: amt,
      raw: evt.raw,
    };
  }

  // Mint / burn — surface large only
  if ((t === "mint" || t === "burn") && amt >= 50_000) {
    return {
      reason: `large_${t}_${Math.round(amt / 1000)}k_usd`,
      observedAt: evt.observedAt,
      signature: evt.signatureOrHash,
      walletAddress: evt.walletAddress,
      chain: evt.chain,
      type: t,
      amountUsd: amt,
      raw: evt.raw,
    };
  }

  return null;
}

/** Surface to the agent bus. Fire-and-forget; never throws. */
export async function surfaceChainOpportunity(evt: ChainEvent): Promise<boolean> {
  const opp = chainEventToOpportunity(evt);
  if (!opp) return false;
  try {
    const res = await publish({ name: "agent.opportunity.surfaced", data: opp });
    return res.delivered;
  } catch (e: any) {
    console.warn("[opportunity-translator] surface failed:", e?.message);
    return false;
  }
}
