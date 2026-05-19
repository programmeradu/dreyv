/**
 * Build the feature pack for a Solana wallet — the single object every
 * smart-explorer surface (narrative, suggestions, risk, archetype) reads
 * from. Self-contained: returns null fields gracefully on partial data.
 */

import { getEnhancedTransactions, deriveAgeDays, type EnhancedTx } from "./helius-tx";
import { lookupSolanaLabel } from "./labels";
import { getCurrentPricesUsd, getSolUsdPrice } from "./jupiter-price";
import { classifyArchetype, type Archetype } from "./archetype";
import { getSiteOrigin } from "@/lib/seo/site";

export interface FeaturePack {
  address: string;
  chain: "solana";
  ageDays: number | null;
  totalUsd: number;
  composition: Array<{ symbol: string; mint: string; pctUsd: number; usd: number; uiAmount: number; logo?: string; priced: boolean }>;
  unpricedCount: number;
  topProtocols: string[];
  delta30dPct: number | null;
  txCount30d: number;
  txCountPrev30d: number;
  uniqueCounterparties: number;
  isMultisig: boolean;
  signerCount: number;
  lastMeaningfulAction: { description: string; daysAgo: number } | null;
  archetype: Archetype;
  archetypeConfidence: number;
  idle: { solUiAmount: number; usdcUiAmount: number; emptyTokenAccounts: number };
  topYields: Array<{ protocol: string; symbol: string; apy: number; riskTier: string }>;
  fetchedAt: string;
}

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LST_MINTS = new Set([
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
]);

interface HoldingRaw {
  mint: string;
  symbol: string;
  name?: string;
  balance: string;
  decimals: number;
  logo?: string;
}

async function fetchHoldings(address: string): Promise<HoldingRaw[]> {
  const base = getSiteOrigin();
  try {
    const r = await fetch(`${base}/api/helius/das/wallet-holdings?address=${address}`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.holdings) ? j.holdings : [];
  } catch {
    return [];
  }
}

async function fetchAudit(address: string): Promise<{ isMultisig: boolean; threshold: number | null; signers: Array<{ address: string }> } | null> {
  const base = getSiteOrigin();
  try {
    const r = await fetch(`${base}/api/treasury/security?wallet=${address}&public=1`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.audit) return null;
    return {
      isMultisig: !!j.audit.isMultisig,
      threshold: j.audit.threshold ?? null,
      signers: Array.isArray(j.audit.signers) ? j.audit.signers : [],
    };
  } catch {
    return null;
  }
}

async function fetchYields(): Promise<FeaturePack["topYields"]> {
  const base = getSiteOrigin();
  try {
    const r = await fetch(`${base}/api/yield/rates`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    const rates = j?.rates && typeof j.rates === "object" ? j.rates : {};
    return Object.values(rates as Record<string, any>)
      .filter((v) => v?.apy > 0)
      .sort((a: any, b: any) => b.apy - a.apy)
      .slice(0, 5)
      .map((v: any) => ({ protocol: v.protocol, symbol: v.symbol, apy: v.apy, riskTier: v.riskTier ?? "medium" }));
  } catch {
    return [];
  }
}

function describeTx(t: EnhancedTx): string {
  if (t.description) return t.description.slice(0, 140);
  return `${t.type ?? "Activity"}${t.source ? ` on ${t.source.toLowerCase()}` : ""}`;
}

function isMeaningful(t: EnhancedTx): boolean {
  if (!t.type) return false;
  return ["SWAP", "STAKE", "UNSTAKE", "TRANSFER", "NFT_SALE", "VOTE", "DEPOSIT", "WITHDRAW"].includes(t.type);
}

export async function buildFeaturePack(address: string): Promise<FeaturePack> {
  const [holdings, txs, audit, topYields, solUsd] = await Promise.all([
    fetchHoldings(address),
    getEnhancedTransactions(address, 100),
    fetchAudit(address),
    fetchYields(),
    getSolUsdPrice(),
  ]);

  // Price all held mints in one call.
  const mints = holdings.map((h) => h.mint).filter(Boolean);
  const prices = mints.length ? await getCurrentPricesUsd(mints) : {};

  let totalUsd = 0;
  const composition = holdings
    .map((h) => {
      const decimals = h.decimals ?? 0;
      const raw = Number(h.balance ?? 0);
      const uiAmount = decimals > 0 ? raw / Math.pow(10, decimals) : raw;
      const px = prices[h.mint] ?? (h.mint === SOL ? (solUsd ?? 0) : 0);
      const usd = uiAmount * px;
      totalUsd += usd;
      return { symbol: h.symbol || "UNKNOWN", mint: h.mint, pctUsd: 0, usd, uiAmount, logo: h.logo, priced: px > 0 };
    })
    .filter((c) => c.uiAmount > 0)
    .sort((a, b) => b.usd - a.usd);
  for (const c of composition) c.pctUsd = totalUsd > 0 ? c.usd / totalUsd : 0;
  const unpricedCount = composition.filter((c) => !c.priced).length;

  // Activity windows
  const now = Math.floor(Date.now() / 1000);
  const d30 = now - 30 * 86400;
  const d60 = now - 60 * 86400;
  const tx30 = txs.filter((t) => t.timestamp >= d30);
  const txPrev = txs.filter((t) => t.timestamp >= d60 && t.timestamp < d30);
  const counterparties = new Set<string>();
  const protocolHits = new Map<string, number>();
  let cexHits = 0;
  let swaps = 0;
  for (const t of txs) {
    if (t.type === "SWAP") swaps += 1;
    if (t.source) {
      const k = t.source.toLowerCase();
      protocolHits.set(k, (protocolHits.get(k) ?? 0) + 1);
    }
    for (const nt of t.nativeTransfers ?? []) {
      const other = nt.fromUserAccount === address ? nt.toUserAccount : nt.fromUserAccount;
      if (other && other !== address) {
        counterparties.add(other);
        if (lookupSolanaLabel(other)?.category === "cex") cexHits += 1;
      }
    }
    for (const tt of t.tokenTransfers ?? []) {
      const other = tt.fromUserAccount === address ? tt.toUserAccount : tt.fromUserAccount;
      if (other && other !== address) {
        counterparties.add(other);
        if (lookupSolanaLabel(other)?.category === "cex") cexHits += 1;
      }
    }
  }
  const topProtocols = Array.from(protocolHits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const lastMeaningful = txs.find(isMeaningful);
  const lastMeaningfulAction = lastMeaningful
    ? { description: describeTx(lastMeaningful), daysAgo: Math.max(0, Math.floor((now - lastMeaningful.timestamp) / 86400)) }
    : null;

  const pctSolUsdc = composition.reduce((acc, c) => acc + (c.mint === SOL || c.mint === USDC ? c.pctUsd : 0), 0);
  const pctLst = composition.reduce((acc, c) => acc + (LST_MINTS.has(c.mint) ? c.pctUsd : 0), 0);
  const pctUnverified = composition.reduce((acc, c) => acc + (c.symbol === "UNKNOWN" ? c.pctUsd : 0), 0);
  const swapRatio = txs.length ? swaps / txs.length : 0;
  const cexFlowRatio = txs.length ? cexHits / txs.length : 0;
  const avgTxUsd = 0; // would need per-tx USD valuation; left as 0 to avoid fabrication

  const archetype = classifyArchetype({
    ageDays: deriveAgeDays(txs),
    isMultisig: !!audit?.isMultisig,
    signerCount: audit?.signers?.length ?? 1,
    totalUsd,
    pctSolUsdc,
    pctLst,
    pctUnverified,
    swapRatio,
    txCount30d: tx30.length,
    uniqueCounterparties: counterparties.size,
    cexFlowRatio,
    avgTxUsd,
  });

  // Idle measures
  const solComp = composition.find((c) => c.mint === SOL);
  const usdcComp = composition.find((c) => c.mint === USDC);
  const emptyAccts = holdings.filter((h) => Number(h.balance ?? 0) === 0).length;

  const delta30dPct =
    txPrev.length === 0 ? null : ((tx30.length - txPrev.length) / Math.max(1, txPrev.length)) * 100;

  return {
    address,
    chain: "solana",
    ageDays: deriveAgeDays(txs),
    totalUsd,
    composition: composition.slice(0, 12),
    unpricedCount,
    topProtocols,
    delta30dPct,
    txCount30d: tx30.length,
    txCountPrev30d: txPrev.length,
    uniqueCounterparties: counterparties.size,
    isMultisig: !!audit?.isMultisig,
    signerCount: audit?.signers?.length ?? 1,
    lastMeaningfulAction,
    archetype: archetype.archetype,
    archetypeConfidence: archetype.confidence,
    idle: {
      solUiAmount: solComp?.uiAmount ?? 0,
      usdcUiAmount: usdcComp?.uiAmount ?? 0,
      emptyTokenAccounts: emptyAccts,
    },
    topYields,
    fetchedAt: new Date().toISOString(),
  };
}
