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
import { getMint } from "@solana/spl-token";
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
  try {
    const res = await fetch(
      `https://tokens.jup.ag/tokens?tags=verified`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    const upper = symbol.toUpperCase();
    const hit = list.find(
      (t: any) => String(t.symbol ?? "").toUpperCase() === upper,
    );
    if (!hit) return null;
    return {
      symbol: upper,
      mint: String(hit.address),
      decimals: Number(hit.decimals ?? 9),
      name: hit.name,
      logoURI: hit.logoURI,
      source: "jupiter",
      verified: true,
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
    const info = await getMint(conn, new PublicKey(mint));
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

  // 2. Looks like a mint → try Jupiter then on-chain.
  if (isLikelyMint(key)) {
    const j = await fetchJupiterByMint(key);
    if (j) {
      tokenCache.set(key, j);
      return j;
    }
    if (rpcEndpoint) {
      const onChain = await fetchOnChainMint(rpcEndpoint, key);
      if (onChain) {
        const resolved: ResolvedToken = {
          symbol: key.slice(0, 4).toUpperCase(),
          mint: key,
          decimals: onChain.decimals,
          source: "onchain",
          verified: false,
        };
        tokenCache.set(key, resolved);
        return resolved;
      }
    }
    // Last-ditch: trust the input but flag it.
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

  // 3. Symbol lookup via Jupiter verified list.
  const sym = await fetchJupiterBySymbol(key);
  if (sym) {
    tokenCache.set(key, sym);
    return sym;
  }

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
  return report;
}
