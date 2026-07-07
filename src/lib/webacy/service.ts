/**
 * High-level Webacy service — the only surface `/api/webacy/*` routes
 * (and internal callers like the Simulation Firewall) should use.
 *
 * All methods:
 *   - are cached in-process
 *   - fail-open (return `UNKNOWN_RISK` on provider failure)
 *   - batch-safe (address/url/token accept arrays)
 */

import "server-only";
import { webacyFetch, isWebacyEnabled } from "./client";
import { cacheWrap, WEBACY_TTL } from "./cache";
import { normalizeRiskPayload } from "./normalize";
import { RiskScore, UNKNOWN_RISK, worstRisk, RiskLevel } from "./types";

export { isWebacyEnabled };

// ─── Addresses (Contract Risk + Threat Risks) ─────────────────────────

async function fetchAddress(address: string, chain: string): Promise<RiskScore> {
  return cacheWrap(`wb:addr:${chain}:${address}`, WEBACY_TTL.address, async () => {
    const [contract, threat] = await Promise.all([
      webacyFetch(`/addresses/${encodeURIComponent(address)}`, { query: { chain } }),
      webacyFetch(`/quick-profile/${encodeURIComponent(address)}`, { query: { chain } }),
    ]);
    if (!contract.ok && !threat.ok) return UNKNOWN_RISK(address);
    const merged = {
      ...(contract.ok ? (contract.data as object) : {}),
      ...(threat.ok ? (threat.data as object) : {}),
    };
    return normalizeRiskPayload(address, merged);
  });
}

export async function scoreAddresses(addresses: string[], chain = "sol"): Promise<Map<string, RiskScore>> {
  const unique = Array.from(new Set(addresses.filter(Boolean)));
  const results = await Promise.all(unique.map((a) => fetchAddress(a, chain)));
  return new Map(unique.map((a, i) => [a, results[i]!]));
}

// ─── Tokens (Threat Risks on mint) ────────────────────────────────────

export async function scoreToken(mint: string, chain = "sol"): Promise<RiskScore> {
  return cacheWrap(`wb:token:${chain}:${mint}`, WEBACY_TTL.token, async () => {
    const res = await webacyFetch(`/addresses/token/${encodeURIComponent(mint)}`, { query: { chain } });
    if (!res.ok) return UNKNOWN_RISK(mint);
    return normalizeRiskPayload(mint, res.data);
  });
}

// ─── URLs ─────────────────────────────────────────────────────────────

export async function scoreUrls(urls: string[]): Promise<Map<string, RiskScore>> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const results = await Promise.all(
    unique.map((u) =>
      cacheWrap(`wb:url:${u}`, WEBACY_TTL.url, async () => {
        const res = await webacyFetch(`/url`, { query: { url: u } });
        if (!res.ok) return UNKNOWN_RISK(u);
        return normalizeRiskPayload(u, res.data);
      })
    )
  );
  return new Map(unique.map((u, i) => [u, results[i]!]));
}

// ─── Transaction risk ─────────────────────────────────────────────────

export async function scoreTransaction(input: {
  chain?: string;
  signature?: string;
  serializedTx?: string;
  signer?: string;
}): Promise<RiskScore> {
  const chain = input.chain ?? "sol";
  const key = `wb:tx:${chain}:${input.signature ?? input.serializedTx?.slice(0, 64) ?? "n/a"}`;
  return cacheWrap(key, WEBACY_TTL.tx, async () => {
    const res = await webacyFetch(`/transactions/scan`, {
      method: "POST",
      body: {
        chain,
        signature: input.signature,
        transaction: input.serializedTx,
        signer: input.signer,
      },
    });
    if (!res.ok) return UNKNOWN_RISK(input.signature ?? "tx");
    return normalizeRiskPayload(input.signature ?? "tx", res.data);
  });
}

// ─── Wallet exposure ──────────────────────────────────────────────────

export interface WalletExposure {
  overall: RiskScore;
  flaggedCount: number;
  holdings: RiskScore[];
}

export async function walletExposure(wallet: string, chain = "sol"): Promise<WalletExposure> {
  return cacheWrap(`wb:exposure:${chain}:${wallet}`, WEBACY_TTL.exposure, async () => {
    const res = await webacyFetch(`/addresses/${encodeURIComponent(wallet)}/exposure`, { query: { chain } });
    if (!res.ok) {
      return { overall: UNKNOWN_RISK(wallet), flaggedCount: 0, holdings: [] };
    }
    const data = res.data as { holdings?: unknown[]; overallRisk?: number } & Record<string, unknown>;
    const holdings = Array.isArray(data.holdings)
      ? data.holdings.map((h) => {
          const row = h as Record<string, unknown>;
          const subject = (row.address as string) ?? (row.mint as string) ?? (row.symbol as string) ?? "";
          return normalizeRiskPayload(subject, row);
        })
      : [];
    const overall = normalizeRiskPayload(wallet, data);
    const flaggedCount = holdings.filter((h) => h.level === "medium" || h.level === "high").length;
    return { overall, flaggedCount, holdings };
  });
}

// ─── Approvals ────────────────────────────────────────────────────────

export interface ApprovalRow {
  token: string;
  spender: string;
  amount: string;
  risk: RiskScore;
}

export async function walletApprovals(wallet: string, chain = "sol"): Promise<ApprovalRow[]> {
  return cacheWrap(`wb:approvals:${chain}:${wallet}`, WEBACY_TTL.approvals, async () => {
    const res = await webacyFetch(`/addresses/${encodeURIComponent(wallet)}/approvals`, { query: { chain } });
    if (!res.ok) return [];
    const rows = (res.data as { approvals?: unknown[] }).approvals ?? (Array.isArray(res.data) ? (res.data as unknown[]) : []);
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      const spender = (row.spender as string) ?? (row.spenderAddress as string) ?? "";
      const token = (row.token as string) ?? (row.tokenAddress as string) ?? (row.mint as string) ?? "";
      const amount = String(row.amount ?? row.allowance ?? "0");
      return {
        token,
        spender,
        amount,
        risk: normalizeRiskPayload(spender, row),
      };
    });
  });
}

// ─── Helper for Firewall integration ──────────────────────────────────

export function worstOfMap(map: Map<string, RiskScore>): RiskLevel {
  let worst: RiskLevel = "unknown";
  for (const s of map.values()) worst = worstRisk(worst, s.level);
  return worst;
}
