/**
 * Universal token resolver + on-chain safety check.
 *
 * Removes the bottleneck of a hardcoded TOKEN_MINTS map by letting any
 * capability resolve ANY SPL token from either:
 *   • a known symbol (delegated to TOKEN_MINTS first),
 *   • a raw base58 mint address,
 *   • an arbitrary symbol via the Jupiter token list.
 *
 * Also exposes `assessTokenSafety(mint)` — a lightweight risk band based on
 * Jupiter's verified/strict-list status + on-chain mint/freeze authority.
 * Capabilities (notably `execute_swap`) gate execution on this so unverified
 * tokens require explicit user approval rather than silent failure.
 */

import { Connection, PublicKey } from "@solana/web3.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const splToken = require("@solana/spl-token") as { getMint: (c: Connection, m: PublicKey) => Promise<{ decimals: number; mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null }> };
import { TOKEN_MINTS } from "./tokens";

// ── Types ──────────────────────────────────────────────────────────────────
export interface ResolvedToken {
  symbol: string;
  mint: string;
  decimals: number;
  name?: string;
  logoURI?: string;
  source: "static" | "jupiter" | "onchain" | "input-mint";
  verified?: boolean;
}

export type SafetyBand = "low" | "medium" | "high" | "unknown";

export interface TokenSafetyReport {
  mint: string;
  band: SafetyBand;
  verified: boolean;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  warnings: string[];
  source: "jupiter+onchain" | "jupiter" | "onchain" | "none";
}

// ── Caches (module-scoped, in-memory) ──────────────────────────────────────
const tokenCache = new Map<string, ResolvedToken>();
const safetyCache = new Map<string, { at: number; report: TokenSafetyReport }>();
const SAFETY_TTL_MS = 5 * 60 * 1000;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isLikelyMint = (s: string) => BASE58.test(s);

// ── Jupiter token-list lookup ──────────────────────────────────────────────
// Jupiter exposes per-token metadata at `https://tokens.jup.ag/token/{mint}`.
// For symbol lookups we fall back to the search endpoint.
async function fetchJupiterByMint(mint: string): Promise<ResolvedToken | null> {
  try {
    const res = await fetch(`https://tokens.jup.ag/token/${mint}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.address) return null;
    return {
      symbol: String(data.symbol ?? "").toUpperCase() || mint.slice(0, 4).toUpperCase(),
      mint: String(data.address),
      decimals: Number(data.decimals ?? 9),
      name: data.name,
      logoURI: data.logoURI,
      source: "jupiter",
      verified: Array.isArray(data.tags) && (data.tags.includes("verified") || data.tags.includes("strict")),
    };
  } catch {
    return null;
  }
}

async function fetchJupiterBySymbol(symbol: string): Promise<ResolvedToken | null> {
  const upper = symbol.toUpperCase();

  // 1. Verified-only list — fast path for blue chips.
  try {
    const res = await fetch(`https://tokens.jup.ag/tokens?tags=verified`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const hit = list.find((t: any) => String(t.symbol ?? "").toUpperCase() === upper);
        if (hit) {
          return {
            symbol: upper,
            mint: String(hit.address),
            decimals: Number(hit.decimals ?? 9),
            name: hit.name,
            logoURI: hit.logoURI,
            source: "jupiter",
            verified: true,
          };
        }
      }
    }
  } catch {
    /* fall through to search */
  }

  // 2. Jupiter search API — covers unverified/long-tail tokens (HORSE, etc.).
  //    Returns array sorted by liquidity/volume; pick the best symbol match.
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    if (arr.length === 0) return null;
    // Prefer exact symbol match; fall back to first result (highest liquidity).
    const exact = arr.find((t) => String(t.symbol ?? "").toUpperCase() === upper);
    const hit = exact ?? arr[0];
    if (!hit?.id && !hit?.address) return null;
    const tags: string[] = Array.isArray(hit.tags) ? hit.tags : [];
    return {
      symbol: String(hit.symbol ?? upper).toUpperCase(),
      mint: String(hit.id ?? hit.address),
      decimals: Number(hit.decimals ?? 9),
      name: hit.name,
      logoURI: hit.icon ?? hit.logoURI,
      source: "jupiter",
      verified: tags.includes("verified") || tags.includes("strict"),
    };
  } catch {
    return null;
  }
}

// ── On-chain mint inspection ───────────────────────────────────────────────
async function fetchOnChainMint(
  rpcEndpoint: string,
  mint: string,
): Promise<{ decimals: number; mintAuthority: string | null; freezeAuthority: string | null } | null> {
  try {
    const conn = new Connection(rpcEndpoint, "confirmed");
    const info = await splToken.getMint(conn, new PublicKey(mint));
    return {
      decimals: info.decimals,
      mintAuthority: info.mintAuthority ? info.mintAuthority.toBase58() : null,
      freezeAuthority: info.freezeAuthority ? info.freezeAuthority.toBase58() : null,
    };
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Resolve a token from a symbol OR raw mint address.
 * Falls back through: static map → Jupiter list → on-chain mint inspection.
 */
export async function resolveTokenAny(
  symbolOrMint: string,
  rpcEndpoint?: string,
): Promise<ResolvedToken | null> {
  if (!symbolOrMint) return null;
  const key = symbolOrMint.trim();
  if (tokenCache.has(key)) return tokenCache.get(key)!;

  // Lazy-import the persistent registry so this module stays usable in
  // contexts where the DB isn't initialised (tests, CLI tools).
  const registry = await import("./token-registry-store").catch(() => null);

  // 1. Static map (fast path for common tokens).
  const upper = key.toUpperCase();
  if (TOKEN_MINTS[upper]) {
    const resolved: ResolvedToken = {
      symbol: upper,
      mint: TOKEN_MINTS[upper],
      decimals: ["USDC", "USDT", "PYUSD", "USDS"].includes(upper) ? 6 : 9,
      source: "static",
      verified: true,
    };
    tokenCache.set(key, resolved);
    return resolved;
  }

  // 2. Persistent registry (cross-process, cross-user learning).
  if (registry) {
    const stored = await registry.loadResolvedToken(key);
    if (stored) {
      tokenCache.set(key, stored);
      tokenCache.set(stored.mint, stored);
      tokenCache.set(stored.symbol, stored);
      return stored;
    }
  }

  const remember = (resolved: ResolvedToken) => {
    tokenCache.set(key, resolved);
    tokenCache.set(resolved.mint, resolved);
    tokenCache.set(resolved.symbol, resolved);
    // Fire-and-forget: never block resolution on persistence.
    if (registry) registry.saveResolvedToken(resolved).catch(() => {});
    return resolved;
  };

  // 3. Looks like a mint → try Jupiter then on-chain.
  if (isLikelyMint(key)) {
    const j = await fetchJupiterByMint(key);
    if (j) return remember(j);
    if (rpcEndpoint) {
      const onChain = await fetchOnChainMint(rpcEndpoint, key);
      if (onChain) {
        return remember({
          symbol: key.slice(0, 4).toUpperCase(),
          mint: key,
          decimals: onChain.decimals,
          source: "onchain",
          verified: false,
        });
      }
    }
    // Last-ditch: trust the input but flag it (don't persist — unverified mint).
    const fallback: ResolvedToken = {
      symbol: key.slice(0, 4).toUpperCase(),
      mint: key,
      decimals: 9,
      source: "input-mint",
      verified: false,
    };
    tokenCache.set(key, fallback);
    return fallback;
  }

  // 4. Symbol lookup via Jupiter verified list.
  const sym = await fetchJupiterBySymbol(key);
  if (sym) return remember(sym);

  return null;
}

/**
 * Assess token safety. Returns a band + warnings used by execute_swap to
 * decide whether to require explicit approval before quoting a swap.
 */
export async function assessTokenSafety(
  mint: string,
  rpcEndpoint?: string,
): Promise<TokenSafetyReport> {
  const cached = safetyCache.get(mint);
  if (cached && Date.now() - cached.at < SAFETY_TTL_MS) return cached.report;

  // Persistent registry: skip the full re-check if we have a fresh DB entry.
  const registry = await import("./token-registry-store").catch(() => null);
  if (registry) {
    const stored = await registry.loadSafetyReport(mint);
    if (stored) {
      safetyCache.set(mint, { at: Date.now(), report: stored });
      return stored;
    }
  }

  const warnings: string[] = [];
  let verified = false;
  let mintAuthorityActive = false;
  let freezeAuthorityActive = false;
  let jupiterOk = false;
  let onChainOk = false;

  // Static-map mints are always treated as low risk.
  if (Object.values(TOKEN_MINTS).includes(mint)) {
    const report: TokenSafetyReport = {
      mint,
      band: "low",
      verified: true,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      warnings: [],
      source: "jupiter+onchain",
    };
    safetyCache.set(mint, { at: Date.now(), report });
    return report;
  }

  const j = await fetchJupiterByMint(mint);
  if (j) {
    jupiterOk = true;
    verified = !!j.verified;
    if (!verified) warnings.push("Token is not on Jupiter's verified list.");
  } else {
    warnings.push("Token not found on Jupiter — limited routing/liquidity likely.");
  }

  if (rpcEndpoint) {
    const onChain = await fetchOnChainMint(rpcEndpoint, mint);
    if (onChain) {
      onChainOk = true;
      mintAuthorityActive = !!onChain.mintAuthority;
      freezeAuthorityActive = !!onChain.freezeAuthority;
      if (mintAuthorityActive) warnings.push("Mint authority is still active — supply can be inflated.");
      if (freezeAuthorityActive) warnings.push("Freeze authority is still active — your balance can be frozen.");
    }
  }

  let band: SafetyBand = "unknown";
  if (jupiterOk || onChainOk) {
    if (verified && !mintAuthorityActive && !freezeAuthorityActive) band = "low";
    else if (mintAuthorityActive && freezeAuthorityActive) band = "high";
    else if (mintAuthorityActive || freezeAuthorityActive || !verified) band = "medium";
    else band = "low";
  }

  const report: TokenSafetyReport = {
    mint,
    band,
    verified,
    mintAuthorityActive,
    freezeAuthorityActive,
    warnings,
    source:
      jupiterOk && onChainOk
        ? "jupiter+onchain"
        : jupiterOk
          ? "jupiter"
          : onChainOk
            ? "onchain"
            : "none",
  };
  safetyCache.set(mint, { at: Date.now(), report });
  if (registry) registry.saveSafetyReport(report).catch(() => {});
  return report;
}
