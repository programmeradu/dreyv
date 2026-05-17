/**
 * Rule-based archetype classifier for any wallet.
 * Pure function — no I/O. Returns one of a fixed set of labels.
 */

export type Archetype =
  | "DAO Treasury"
  | "Market Maker"
  | "Active Trader"
  | "Long-term Holder"
  | "Retail"
  | "Sniper"
  | "Bridge Hot Wallet"
  | "CEX Deposit"
  | "New Wallet";

export interface ArchetypeSignals {
  ageDays: number | null;
  isMultisig: boolean;
  signerCount: number;
  totalUsd: number;
  pctSolUsdc: number; // 0..1
  pctLst: number;
  pctUnverified: number;
  swapRatio: number; // swaps / total tx
  txCount30d: number;
  uniqueCounterparties: number;
  cexFlowRatio: number; // (in+out to CEX hot wallets) / total tx
  avgTxUsd: number;
}

export function classifyArchetype(s: ArchetypeSignals): { archetype: Archetype; confidence: number } {
  // Order matters — most specific first.
  if (s.ageDays !== null && s.ageDays < 7 && s.txCount30d < 5) {
    return { archetype: "New Wallet", confidence: 0.9 };
  }
  if (s.isMultisig && s.totalUsd > 100_000 && s.pctSolUsdc > 0.5) {
    return { archetype: "DAO Treasury", confidence: 0.85 };
  }
  if (s.isMultisig) {
    return { archetype: "DAO Treasury", confidence: 0.7 };
  }
  if (s.cexFlowRatio > 0.6 && s.uniqueCounterparties < 8) {
    return { archetype: "CEX Deposit", confidence: 0.8 };
  }
  if (s.swapRatio > 0.5 && s.txCount30d > 200 && s.avgTxUsd > 5_000) {
    return { archetype: "Market Maker", confidence: 0.75 };
  }
  if (s.swapRatio > 0.4 && s.txCount30d > 50) {
    return { archetype: "Active Trader", confidence: 0.7 };
  }
  if (s.pctUnverified > 0.5 && s.ageDays !== null && s.ageDays < 30 && s.txCount30d > 20) {
    return { archetype: "Sniper", confidence: 0.7 };
  }
  if (s.ageDays !== null && s.ageDays > 180 && s.txCount30d < 10 && s.pctSolUsdc + s.pctLst > 0.7) {
    return { archetype: "Long-term Holder", confidence: 0.7 };
  }
  if (s.uniqueCounterparties > 50 && s.txCount30d > 500) {
    return { archetype: "Bridge Hot Wallet", confidence: 0.6 };
  }
  return { archetype: "Retail", confidence: 0.5 };
}
