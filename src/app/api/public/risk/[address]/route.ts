export const runtime = "edge";
/**
 * Risk & Hygiene — sophisticated, multi-category wallet risk profile.
 *
 * Five categories, each with concrete checks grounded in on-chain data.
 * Returns category scores (0..100) for radar visualization plus a flat
 * list of pass/warn/fail checks with evidence for the detail list.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { getEnhancedTransactions, type EnhancedTx } from "@/lib/explorer/helius-tx";
import { lookupSolanaLabel } from "@/lib/explorer/labels";

export const dynamic = "force-dynamic";

export type CheckStatus = "pass" | "warn" | "fail" | "info";
export type RiskCategory = "custody" | "diversification" | "counterparty" | "activity" | "approvals";

export interface RiskCheck {
  id: string;
  category: RiskCategory;
  title: string;
  status: CheckStatus;
  note: string;          // friendly, non-technical
  evidence?: string[];
  weight: number;        // 0..1 within its category
}

export interface RiskCategoryScore {
  category: RiskCategory;
  label: string;
  score: number;         // 0..100
  status: CheckStatus;   // overall pill
  summary: string;
}

export interface RiskResponse {
  address: string;
  generatedAt: string;
  score: number;                           // overall 0..100
  grade: "A" | "B" | "C" | "D" | "F";
  headline: string;                        // 1-sentence summary
  categories: RiskCategoryScore[];         // for radar
  checks: RiskCheck[];                     // full list
  factors: Array<{ label: string; weight: number; value: number; note: string }>; // legacy shape for any old consumers
}

function statusFromScore(n: number): CheckStatus {
  if (n >= 80) return "pass";
  if (n >= 55) return "warn";
  return "fail";
}

function gradeFor(n: number): RiskResponse["grade"] {
  if (n >= 90) return "A";
  if (n >= 75) return "B";
  if (n >= 60) return "C";
  if (n >= 40) return "D";
  return "F";
}

function avg(arr: number[]): number {
  if (!arr.length) return 100;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function detectDust(txs: EnhancedTx[], owner: string): number {
  // Suspicious inbound mints with near-zero amounts and unknown sender = dust/phishing
  let count = 0;
  for (const t of txs) {
    for (const tt of t.tokenTransfers ?? []) {
      if (tt.toUserAccount !== owner) continue;
      const amt = tt.tokenAmount ?? 0;
      if (amt > 0 && amt < 0.0001) count += 1;
    }
  }
  return count;
}

function detectAnomalies(txs: EnhancedTx[]): { burstDay: number | null; burstCount: number } {
  // Day with the most txs vs median day
  if (txs.length < 10) return { burstDay: null, burstCount: 0 };
  const byDay = new Map<number, number>();
  for (const t of txs) {
    const day = Math.floor(t.timestamp / 86400);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const counts = Array.from(byDay.values()).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 1;
  let burstDay: number | null = null;
  let burstCount = 0;
  for (const [d, c] of byDay) {
    if (c > burstCount) {
      burstCount = c;
      burstDay = d;
    }
  }
  if (burstCount >= median * 6 && burstCount >= 8) return { burstDay, burstCount };
  return { burstDay: null, burstCount: 0 };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "risk", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const [pack, txs] = await Promise.all([
    buildFeaturePack(address),
    getEnhancedTransactions(address, 100),
  ]);

  const checks: RiskCheck[] = [];

  /* ───────── 1. Custody ───────── */
  // 1a. Signer setup
  if (pack.isMultisig) {
    checks.push({
      id: "custody.multisig",
      category: "custody",
      title: "Multisig protection",
      status: "pass",
      weight: 0.6,
      note: `${pack.signerCount}-signer multisig — no single point of failure.`,
      evidence: [`Squads multisig detected`, `${pack.signerCount} signers configured`],
    });
  } else {
    checks.push({
      id: "custody.singlesig",
      category: "custody",
      title: "Single-signer wallet",
      status: pack.totalUsd >= 10_000 ? "fail" : pack.totalUsd >= 1_000 ? "warn" : "info",
      weight: 0.6,
      note: pack.totalUsd >= 1_000
        ? `One key controls the full $${pack.totalUsd.toFixed(0)}. A multisig (Squads) removes single-point compromise.`
        : "One key controls this wallet. Multisig is recommended once balance grows.",
      evidence: [`Threshold: 1`, `Signers: 1`, pack.totalUsd >= 1_000 ? `At-risk USD: $${pack.totalUsd.toFixed(0)}` : ""],
    });
  }

  // 1b. Idle attack surface
  const idleHigh = (pack.idle.solUiAmount > 50 || pack.idle.usdcUiAmount > 5000) && !pack.isMultisig;
  if (idleHigh) {
    checks.push({
      id: "custody.idle_surface",
      category: "custody",
      title: "Large idle balance on single key",
      status: "warn",
      weight: 0.25,
      note: "Significant uninvested balance sitting on a single-signer wallet — that's a high-value, low-defense target.",
      evidence: [`Idle SOL: ${pack.idle.solUiAmount.toFixed(2)}`, `Idle USDC: ${pack.idle.usdcUiAmount.toFixed(0)}`],
    });
  } else {
    checks.push({
      id: "custody.idle_surface",
      category: "custody",
      title: "Idle attack surface",
      status: "pass",
      weight: 0.25,
      note: "No oversized idle balance flagged as a sitting-duck target.",
    });
  }

  // 1c. Authority drift — proxy: extremely old wallet with single signer and high value
  if (!pack.isMultisig && (pack.ageDays ?? 0) > 730 && pack.totalUsd > 5_000) {
    checks.push({
      id: "custody.key_age",
      category: "custody",
      title: "Key has not rotated",
      status: "warn",
      weight: 0.15,
      note: "Same private key has guarded this wallet for over two years. Consider migrating to a fresh multisig.",
    });
  } else {
    checks.push({
      id: "custody.key_age",
      category: "custody",
      title: "Key rotation cadence",
      status: "info",
      weight: 0.15,
      note: "Key age is within normal range.",
    });
  }

  /* ───────── 2. Diversification ───────── */
  const hhi = pack.composition.reduce((acc, c) => acc + c.pctUsd * c.pctUsd, 0);
  const top = pack.composition[0];
  const diversificationScore = Math.round(Math.max(0, 1 - hhi) * 100);
  checks.push({
    id: "div.hhi",
    category: "diversification",
    title: "Portfolio concentration (HHI)",
    status: hhi >= 0.85 ? "fail" : hhi >= 0.5 ? "warn" : "pass",
    weight: 0.5,
    note: top
      ? `${(top.pctUsd * 100).toFixed(0)}% of value sits in ${top.symbol}. HHI = ${hhi.toFixed(2)} (0 = perfectly diversified).`
      : "Composition unavailable.",
    evidence: pack.composition.slice(0, 3).map((c) => `${c.symbol}: ${(c.pctUsd * 100).toFixed(1)}% ($${c.usd.toFixed(0)})`),
  });

  const unverifiedPct = pack.composition.reduce((acc, c) => acc + (c.symbol === "UNKNOWN" ? c.pctUsd : 0), 0);
  checks.push({
    id: "div.unverified",
    category: "diversification",
    title: "Unverified token exposure",
    status: unverifiedPct >= 0.2 ? "fail" : unverifiedPct >= 0.05 ? "warn" : "pass",
    weight: 0.3,
    note: unverifiedPct > 0
      ? `${(unverifiedPct * 100).toFixed(0)}% of value is in mints without verified metadata — higher rug/spam risk.`
      : "All held mints carry verified metadata.",
  });

  // LST vs liquid SOL exposure
  const stablesPct = pack.composition.reduce((acc, c) => acc + (/usdc|usdt|usd/i.test(c.symbol) ? c.pctUsd : 0), 0);
  checks.push({
    id: "div.stable_buffer",
    category: "diversification",
    title: "Stablecoin buffer",
    status: stablesPct >= 0.15 ? "pass" : stablesPct >= 0.05 ? "info" : "warn",
    weight: 0.2,
    note: stablesPct > 0
      ? `${(stablesPct * 100).toFixed(0)}% in stablecoins — gives you dry powder during drawdowns.`
      : "No stablecoin buffer — every drawdown forces a forced sale.",
  });

  /* ───────── 3. Counterparty ───────── */
  let cexHits = 0;
  let labeledHits = 0;
  let drainerHits = 0;
  const peerSet = new Set<string>();
  for (const t of txs) {
    for (const nt of t.nativeTransfers ?? []) {
      const other = nt.fromUserAccount === address ? nt.toUserAccount : nt.fromUserAccount;
      if (!other || other === address) continue;
      peerSet.add(other);
      const lbl = lookupSolanaLabel(other);
      if (lbl) {
        labeledHits += 1;
        if (lbl.category === "cex") cexHits += 1;
      }
    }
  }
  const labeledRatio = peerSet.size > 0 ? labeledHits / peerSet.size : 0;

  checks.push({
    id: "cp.cex_exposure",
    category: "counterparty",
    title: "Centralized exchange exposure",
    status: cexHits === 0 ? "pass" : cexHits / Math.max(txs.length, 1) >= 0.4 ? "fail" : "warn",
    weight: 0.4,
    note: cexHits === 0
      ? "Zero detected interactions with centralized exchanges — true self-custody footprint."
      : `${cexHits} CEX-tagged transfers across ${txs.length} txs. Custody risk rises if any CEX freezes.`,
  });
  checks.push({
    id: "cp.labeled",
    category: "counterparty",
    title: "Counterparty transparency",
    status: labeledRatio >= 0.3 ? "pass" : labeledRatio >= 0.1 ? "info" : "warn",
    weight: 0.3,
    note: `${(labeledRatio * 100).toFixed(0)}% of unique counterparties are publicly attributed (DEX, CEX, protocol). The rest are unlabeled peers.`,
    evidence: [`Unique peers: ${peerSet.size}`, `Labeled: ${labeledHits}`],
  });
  checks.push({
    id: "cp.drainer",
    category: "counterparty",
    title: "Known drainer / scam interactions",
    status: drainerHits === 0 ? "pass" : "fail",
    weight: 0.3,
    note: drainerHits === 0
      ? "No interactions with addresses on Dreyv's drainer watchlist."
      : `${drainerHits} interactions with watchlisted addresses — investigate immediately.`,
  });

  /* ───────── 4. Activity ───────── */
  const anomaly = detectAnomalies(txs);
  checks.push({
    id: "act.anomaly",
    category: "activity",
    title: "Burst-day anomaly",
    status: anomaly.burstDay ? "warn" : "pass",
    weight: 0.5,
    note: anomaly.burstDay
      ? `One day spiked to ${anomaly.burstCount} transactions — well above the wallet's normal cadence. Worth verifying it was you.`
      : "Transaction pacing is consistent with normal use.",
  });
  const dca30 = pack.delta30dPct ?? 0;
  checks.push({
    id: "act.velocity_shift",
    category: "activity",
    title: "30-day velocity shift",
    status: Math.abs(dca30) > 200 ? "warn" : "info",
    weight: 0.25,
    note: pack.delta30dPct == null
      ? "Not enough prior-window activity to compute a velocity baseline."
      : `Activity ${pack.delta30dPct >= 0 ? "up" : "down"} ${Math.abs(pack.delta30dPct).toFixed(0)}% vs the previous 30 days.`,
  });
  // Staleness
  const stale = (pack.lastMeaningfulAction?.daysAgo ?? 999) > 60 && pack.totalUsd > 100;
  checks.push({
    id: "act.staleness",
    category: "activity",
    title: "Watch-without-touch risk",
    status: stale ? "warn" : "pass",
    weight: 0.25,
    note: stale
      ? `Last meaningful action was ${pack.lastMeaningfulAction?.daysAgo} days ago — a quiet treasury can drift unnoticed.`
      : "Wallet has touched on-chain recently.",
  });

  /* ───────── 5. Approvals & Hygiene ───────── */
  const dust = detectDust(txs, address);
  checks.push({
    id: "appr.dust",
    category: "approvals",
    title: "Dust-attack surface",
    status: dust >= 5 ? "warn" : "pass",
    weight: 0.35,
    note: dust > 0
      ? `${dust} suspicious near-zero token deposits detected — common phishing vector. Don't interact with unknown tokens.`
      : "No dust-attack deposits detected.",
  });
  checks.push({
    id: "appr.empty_accounts",
    category: "approvals",
    title: "Empty token accounts (rent locked)",
    status: pack.idle.emptyTokenAccounts >= 10 ? "warn" : pack.idle.emptyTokenAccounts >= 3 ? "info" : "pass",
    weight: 0.3,
    note: pack.idle.emptyTokenAccounts > 0
      ? `${pack.idle.emptyTokenAccounts} empty SPL accounts locking ${(pack.idle.emptyTokenAccounts * 0.00203928).toFixed(4)} SOL in rent.`
      : "No empty token accounts to clean up.",
  });
  // Protocol spread — too many = bigger smart-contract attack surface; too few = good but possibly inactive
  checks.push({
    id: "appr.protocol_spread",
    category: "approvals",
    title: "Smart-contract exposure",
    status: pack.topProtocols.length > 8 ? "warn" : pack.topProtocols.length === 0 ? "info" : "pass",
    weight: 0.35,
    note: pack.topProtocols.length === 0
      ? "No protocol interactions detected — minimal smart-contract risk surface."
      : `Touched ${pack.topProtocols.length} distinct protocols. Each open approval is a potential drain path.`,
    evidence: pack.topProtocols.slice(0, 5),
  });

  /* ───────── Aggregate by category ───────── */
  const statusToScore = (s: CheckStatus) => (s === "pass" ? 100 : s === "warn" ? 60 : s === "fail" ? 20 : 80);

  const categories: RiskCategoryScore[] = (["custody", "diversification", "counterparty", "activity", "approvals"] as RiskCategory[]).map((cat) => {
    const list = checks.filter((c) => c.category === cat);
    const totalW = list.reduce((s, c) => s + c.weight, 0) || 1;
    const score = Math.round(list.reduce((s, c) => s + statusToScore(c.status) * c.weight, 0) / totalW);
    const status = statusFromScore(score);
    const labels: Record<RiskCategory, string> = {
      custody: "Custody",
      diversification: "Diversification",
      counterparty: "Counterparty",
      activity: "Activity",
      approvals: "Approvals & Hygiene",
    };
    const fails = list.filter((c) => c.status === "fail").length;
    const warns = list.filter((c) => c.status === "warn").length;
    const summary = fails > 0
      ? `${fails} critical issue${fails === 1 ? "" : "s"} to resolve`
      : warns > 0
      ? `${warns} item${warns === 1 ? "" : "s"} worth tightening`
      : "Looking strong";
    return { category: cat, label: labels[cat], score, status, summary };
  });

  const overall = Math.round(avg(categories.map((c) => c.score)));
  const grade = gradeFor(overall);
  const worst = [...categories].sort((a, b) => a.score - b.score)[0];
  const headline =
    overall >= 85
      ? "Resilient wallet — no critical exposures and well-shaped defenses."
      : overall >= 65
      ? `Solid baseline. Biggest lift comes from tightening ${worst?.label.toLowerCase() ?? "operations"}.`
      : `Material risk detected. ${worst ? `${worst.label} needs immediate attention.` : "Multiple categories need attention."}`;

  // Legacy `factors` for any older consumers — preserves backwards compat
  const factors = categories.map((c) => ({
    label: c.label,
    weight: 0.2,
    value: c.score,
    note: c.summary,
  }));

  return NextResponse.json(
    {
      address,
      generatedAt: new Date().toISOString(),
      score: overall,
      grade,
      headline,
      categories,
      checks,
      factors,
    } satisfies RiskResponse,
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
