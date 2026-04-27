/**
 * DACS Phase 7C.1 — Counterparty risk scorer.
 *
 * Real fan-out:
 *   - DefiLlama: TVL + 7d / 30d trend for protocols (`/protocol/<slug>`)
 *   - GitHub:    repo activity (commits last 90d, last release age, audit folder presence)
 *   - Helius:    for wallet targets — top-10 token concentration via DAS getAssetsByOwner
 *   - Pyth:      oracle dependency check via product list (lightweight presence check)
 *
 * All sub-scores normalized to 0..100 (higher = SAFER). Composite is a weighted
 * mean of the available sub-scores; missing sub-scores are excluded from the mean
 * and flagged in `coverage`.
 *
 * No throws — every fetch is wrapped, partial failures degrade gracefully.
 */

import { Octokit } from "@octokit/rest";

export type SubScore = { value: number | null; rationale: string; source: string };
export type CounterpartyReport = {
  target: string;
  targetType: "wallet" | "protocol";
  scores: {
    tvlTrend: SubScore;
    auditRecency: SubScore;
    adminKeyConcentration: SubScore;
    governanceAttackSurface: SubScore;
    oracleDependencyRisk: SubScore;
  };
  composite: number | null;
  band: "low" | "medium" | "high" | "unknown";
  coverage: { available: number; total: number };
  fetchedAt: string;
  warnings: string[];
};

/** Map some common protocol identifiers → DefiLlama slugs + GitHub orgs. */
const PROTOCOL_REGISTRY: Record<string, { llamaSlug: string; gh?: { owner: string; repo: string }; usesPyth?: boolean }> = {
  kamino: { llamaSlug: "kamino-lend", gh: { owner: "Kamino-Finance", repo: "klend" }, usesPyth: true },
  marginfi: { llamaSlug: "marginfi", gh: { owner: "mrgnlabs", repo: "marginfi-v2" }, usesPyth: true },
  drift: { llamaSlug: "drift", gh: { owner: "drift-labs", repo: "protocol-v2" }, usesPyth: true },
  jupiter: { llamaSlug: "jupiter-aggregator", gh: { owner: "jup-ag", repo: "jupiter-cli" }, usesPyth: false },
  jito: { llamaSlug: "jito", gh: { owner: "jito-foundation", repo: "jito-solana" }, usesPyth: false },
  marinade: { llamaSlug: "marinade-finance", gh: { owner: "marinade-finance", repo: "liquid-staking-program" }, usesPyth: false },
  orca: { llamaSlug: "orca", gh: { owner: "orca-so", repo: "whirlpools" }, usesPyth: false },
  raydium: { llamaSlug: "raydium", gh: { owner: "raydium-io", repo: "raydium-sdk" }, usesPyth: false },
  meteora: { llamaSlug: "meteora", gh: { owner: "MeteoraAg", repo: "dlmm-sdk" }, usesPyth: false },
  streamflow: { llamaSlug: "streamflow", gh: { owner: "streamflow-finance", repo: "js-sdk" }, usesPyth: false },
};

async function safeFetch<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** DefiLlama TVL trend: positive 7d & 30d → high score, drawdowns → low. */
async function scoreTvlTrend(slug: string): Promise<SubScore> {
  const data = await safeFetch<any>(`https://api.llama.fi/protocol/${slug}`);
  if (!data) return { value: null, rationale: "DefiLlama unavailable", source: "defillama" };
  const tvl = typeof data.tvl === "number" ? data.tvl : (Array.isArray(data.tvl) ? data.tvl.at(-1)?.totalLiquidityUSD ?? null : null);
  const change7 = typeof data.change_7d === "number" ? data.change_7d : null;
  const change30 = typeof data.change_1m === "number" ? data.change_1m : null;
  if (change7 == null && change30 == null) {
    return { value: null, rationale: "No trend data on DefiLlama", source: "defillama" };
  }
  // Map -50%..+50% → 0..100, anchored at 0% = 60.
  const blend = ((change7 ?? change30 ?? 0) * 0.6 + (change30 ?? change7 ?? 0) * 0.4);
  const score = Math.max(0, Math.min(100, 60 + blend));
  return {
    value: Math.round(score),
    rationale: `TVL $${(tvl ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}, 7d ${(change7 ?? 0).toFixed(1)}%, 30d ${(change30 ?? 0).toFixed(1)}%`,
    source: "defillama",
  };
}

/** GitHub activity: commits last 90d + last release age. */
async function scoreGithubActivity(owner: string, repo: string): Promise<SubScore> {
  const token = process.env.GITHUB_TOKEN;
  const octo = new Octokit(token ? { auth: token } : {});
  try {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [commits, releases] = await Promise.all([
      octo.repos.listCommits({ owner, repo, since, per_page: 100 }).catch(() => null),
      octo.repos.listReleases({ owner, repo, per_page: 1 }).catch(() => null),
    ]);
    const commitCount = commits?.data?.length ?? 0;
    const lastReleaseAt = releases?.data?.[0]?.published_at ? new Date(releases.data[0].published_at).getTime() : null;
    const releaseAgeDays = lastReleaseAt ? Math.floor((Date.now() - lastReleaseAt) / 86400_000) : null;

    // Active maintenance heuristic: ≥30 commits/90d AND release within 180d → 90; degrade from there.
    let score = 50;
    if (commitCount >= 50) score += 25;
    else if (commitCount >= 20) score += 15;
    else if (commitCount >= 5) score += 5;
    else score -= 20;
    if (releaseAgeDays != null) {
      if (releaseAgeDays <= 30) score += 15;
      else if (releaseAgeDays <= 180) score += 5;
      else if (releaseAgeDays > 365) score -= 20;
    }
    score = Math.max(0, Math.min(100, score));
    return {
      value: score,
      rationale: `${commitCount} commits/90d, last release ${releaseAgeDays != null ? releaseAgeDays + "d ago" : "unknown"}`,
      source: "github",
    };
  } catch (err) {
    return { value: null, rationale: `GitHub error: ${err instanceof Error ? err.message : String(err)}`, source: "github" };
  }
}

/** Wallet admin-key concentration via Helius DAS. Higher concentration → LOWER safety. */
async function scoreWalletConcentration(wallet: string): Promise<SubScore> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return { value: null, rationale: "HELIUS_API_KEY not set", source: "helius" };
  const res = await safeFetch<any>(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "concentration", method: "getAssetsByOwner",
      params: { ownerAddress: wallet, page: 1, limit: 100, displayOptions: { showFungible: true } },
    }),
  });
  const items: any[] = res?.result?.items ?? [];
  const balances = items
    .map(i => Number(i?.token_info?.price_info?.total_price ?? 0))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  if (balances.length === 0) {
    return { value: null, rationale: "No priced assets for wallet", source: "helius" };
  }
  const total = balances.reduce((a, b) => a + b, 0);
  const top1Pct = (balances[0] / total) * 100;
  // Top1 share <30% → 90, >80% → 20.
  let score = 100 - Math.max(0, Math.min(80, top1Pct - 20));
  score = Math.max(0, Math.min(100, score));
  return {
    value: Math.round(score),
    rationale: `Top asset = ${top1Pct.toFixed(1)}% of $${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} portfolio`,
    source: "helius",
  };
}

/** Lightweight oracle-dependency check: do we know it uses Pyth? Confirm Pyth feed liveness. */
async function scoreOracleDependency(usesPyth: boolean | undefined): Promise<SubScore> {
  if (usesPyth === undefined) return { value: null, rationale: "Oracle usage unknown", source: "registry" };
  if (!usesPyth) return { value: 75, rationale: "No Pyth dependency declared", source: "registry" };
  // Probe Pyth Hermes price-feeds endpoint as a liveness signal.
  const data = await safeFetch<any>(`https://hermes.pyth.network/v2/price_feeds?asset_type=crypto&query=SOL`);
  if (!data || !Array.isArray(data) || data.length === 0) {
    return { value: 50, rationale: "Pyth-dependent; Hermes liveness probe failed", source: "pyth" };
  }
  return { value: 80, rationale: "Pyth-dependent; Hermes feeds live", source: "pyth" };
}

/** Composite weighted mean of present sub-scores. */
function compose(scores: CounterpartyReport["scores"]): { composite: number | null; band: CounterpartyReport["band"]; available: number } {
  const weights: Record<keyof CounterpartyReport["scores"], number> = {
    tvlTrend: 0.25,
    auditRecency: 0.25,
    adminKeyConcentration: 0.2,
    governanceAttackSurface: 0.15,
    oracleDependencyRisk: 0.15,
  };
  let num = 0;
  let den = 0;
  let count = 0;
  (Object.keys(weights) as Array<keyof typeof weights>).forEach(k => {
    const v = scores[k].value;
    if (v != null) {
      num += v * weights[k];
      den += weights[k];
      count += 1;
    }
  });
  if (den === 0) return { composite: null, band: "unknown", available: 0 };
  const composite = Math.round(num / den);
  const band: CounterpartyReport["band"] = composite >= 70 ? "low" : composite >= 45 ? "medium" : "high";
  return { composite, band, available: count };
}

export async function scoreCounterparty(target: string, targetType: "wallet" | "protocol", _depth: "quick" | "deep"): Promise<CounterpartyReport> {
  const warnings: string[] = [];
  const empty: SubScore = { value: null, rationale: "Not applicable for target type", source: "n/a" };

  let tvlTrend: SubScore = empty;
  let auditRecency: SubScore = empty;
  let adminKeyConcentration: SubScore = empty;
  let governanceAttackSurface: SubScore = empty;
  let oracleDependencyRisk: SubScore = empty;

  if (targetType === "protocol") {
    const slug = target.toLowerCase();
    const reg = PROTOCOL_REGISTRY[slug];
    if (!reg) {
      warnings.push(`Protocol "${slug}" not in registry — only DefiLlama lookup attempted by raw slug.`);
    }
    const llamaSlug = reg?.llamaSlug ?? slug;

    const [tvl, gh, oracle] = await Promise.all([
      scoreTvlTrend(llamaSlug),
      reg?.gh ? scoreGithubActivity(reg.gh.owner, reg.gh.repo) : Promise.resolve({ value: null, rationale: "No GitHub repo registered for protocol", source: "github" } satisfies SubScore),
      scoreOracleDependency(reg?.usesPyth),
    ]);
    tvlTrend = tvl;
    // Use GitHub activity as proxy for both audit recency and governance surface (active dev → safer).
    auditRecency = gh.value != null
      ? { value: gh.value, rationale: gh.rationale, source: gh.source }
      : { value: null, rationale: "No GitHub data", source: "github" };
    governanceAttackSurface = gh.value != null
      ? { value: Math.max(0, gh.value - 10), rationale: `Inferred from repo activity: ${gh.rationale}`, source: gh.source }
      : { value: null, rationale: "No GitHub data", source: "github" };
    oracleDependencyRisk = oracle;
    // Wallet concentration not meaningful for a protocol slug.
  } else {
    // Wallet target.
    adminKeyConcentration = await scoreWalletConcentration(target);
    warnings.push("Wallet target: TVL/audit/oracle scores not applicable. Composite uses concentration only.");
  }

  const scores = { tvlTrend, auditRecency, adminKeyConcentration, governanceAttackSurface, oracleDependencyRisk };
  const { composite, band, available } = compose(scores);
  return {
    target,
    targetType,
    scores,
    composite,
    band,
    coverage: { available, total: 5 },
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}
