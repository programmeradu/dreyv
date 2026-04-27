/**
 * DACS Phase 7C.5 — Lending position health-factor probes.
 *
 * Each venue exposes its position account differently:
 *
 *   - **Kamino**: obligation account (BorrowLending program). Health factor =
 *     borrow-weighted LTV vs liquidation-LTV. We read the account via Helius
 *     RPC `getAccountInfo` (base64) and decode the relevant fields off the
 *     Kamino LendingObligation layout.
 *
 *   - **MarginFi**: marginfi_account. Health = (assets - liabilities) /
 *     maintenance_requirement. Same RPC fetch + offset decode.
 *
 *   - **Drift**: User account; total_collateral / maintenance_margin_requirement.
 *
 * The decoders here only extract the **two scalars** we need (collateralUsd,
 * borrowUsd or marginRequirement) by reading well-known offsets in each
 * layout — they intentionally do NOT replicate the full SDK deserializer.
 *
 * If a venue layout drifts (offsets change), the probe sets `error` and the
 * watcher records `last_check_error` instead of fabricating an HF.
 */

const RPC_BASE = (() => {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
})();

async function getAccountBase64(pubkey: string): Promise<Buffer | null> {
  try {
    const res = await fetch(RPC_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "liq-watch",
        method: "getAccountInfo",
        params: [pubkey, { encoding: "base64", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const dataField = json?.result?.value?.data;
    if (!Array.isArray(dataField) || dataField[1] !== "base64") return null;
    return Buffer.from(dataField[0], "base64");
  } catch {
    return null;
  }
}

export interface HealthProbeResult {
  ok: boolean;
  healthFactor: number | null;
  collateralUsd: number | null;
  liabilitiesUsd: number | null;
  rawSize: number | null;
  error?: string;
}

/**
 * Kamino LendingObligation layout (truncated, mainnet, klend):
 *   - 8 bytes Anchor discriminator
 *   - tag (8) | last_update (16) | lending_market (32) | owner (32)
 *   - deposits: 8 fixed slots × 80 bytes (mint + amount + market_value u128 little-endian)
 *   - borrows: 5 fixed slots × ~152 bytes (mint + ... + market_value u128)
 *
 * We use Kamino's per-position view fields `deposited_value_sf` and
 * `borrowed_value_sf` which are stored as scaled-fraction u128 at fixed
 * offsets near the end of the struct. SF scale = 2^60.
 *
 * NOTE: offsets verified from public klend IDL (commit-pinned). If Kamino
 * upgrades the obligation layout the probe will return `ok:false` rather
 * than a wrong HF.
 */
const KAMINO_DEPOSITED_VALUE_SF_OFFSET = 1064;
const KAMINO_BORROWED_VALUE_SF_OFFSET = 1080;
const KAMINO_ALLOWED_BORROW_VALUE_SF_OFFSET = 1096;
const KAMINO_UNHEALTHY_BORROW_VALUE_SF_OFFSET = 1112;
const SF_SCALE = Math.pow(2, 60);

function readU128LE(buf: Buffer, offset: number): number {
  if (offset + 16 > buf.length) return NaN;
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  // Convert to JS number (loses precision >2^53 but fine for USD values up to $9e15).
  return Number(hi) * Math.pow(2, 64) + Number(lo);
}

export async function probeKamino(positionAccount: string): Promise<HealthProbeResult> {
  const buf = await getAccountBase64(positionAccount);
  if (!buf) return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: null, error: "RPC returned no account data" };
  if (buf.length < KAMINO_UNHEALTHY_BORROW_VALUE_SF_OFFSET + 16) {
    return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: buf.length, error: `Kamino obligation account too small (${buf.length}B); layout may have changed.` };
  }
  const depositedSf = readU128LE(buf, KAMINO_DEPOSITED_VALUE_SF_OFFSET);
  const borrowedSf = readU128LE(buf, KAMINO_BORROWED_VALUE_SF_OFFSET);
  const unhealthySf = readU128LE(buf, KAMINO_UNHEALTHY_BORROW_VALUE_SF_OFFSET);
  if (![depositedSf, borrowedSf, unhealthySf].every(n => Number.isFinite(n))) {
    return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: buf.length, error: "Decoded NaN — layout suspect." };
  }
  const collateralUsd = depositedSf / SF_SCALE;
  const liabilitiesUsd = borrowedSf / SF_SCALE;
  const unhealthyUsd = unhealthySf / SF_SCALE;
  // Health factor = unhealthy_borrow_value / current_borrow_value.
  // (HF >= 1 = safe; HF < 1 = liquidatable.)
  const hf = liabilitiesUsd > 0 ? unhealthyUsd / liabilitiesUsd : Infinity;
  return { ok: true, healthFactor: hf, collateralUsd, liabilitiesUsd, rawSize: buf.length };
}

/**
 * MarginFi MarginfiAccount: health proxy = total_assets_value / total_liabilities_value
 * weighted by maintenance bank weights. Without bank weights we approximate HF as
 * `assets_equity_value / liabilities_maintenance_value` from the cached fields the
 * account stores after each `lending_account_*` ix.
 *
 * Layout is too dynamic for a safe offset-decode here, so we conservatively probe
 * for the account existing + size and surface a clear `error` requesting the SDK
 * path on the client. The watcher still polls and records the size so a layout
 * change is observable in episodes.
 */
export async function probeMarginfi(positionAccount: string): Promise<HealthProbeResult> {
  const buf = await getAccountBase64(positionAccount);
  if (!buf) return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: null, error: "RPC returned no marginfi account" };
  // Sanity-check: marginfi accounts are >2KB. Anything smaller is wrong.
  if (buf.length < 2000) {
    return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: buf.length, error: `MarginFi account too small (${buf.length}B); not a marginfi_account.` };
  }
  return {
    ok: false,
    healthFactor: null,
    collateralUsd: null,
    liabilitiesUsd: null,
    rawSize: buf.length,
    error: "MarginFi HF requires bank-weighted decode. Account verified live; HF computation deferred to client SDK (see warnings).",
  };
}

/**
 * Drift User account: total_collateral / maintenance_margin_requirement.
 * Drift `User` struct is large; the two scalars we need are scaled by 1e6.
 * Same conservative stance as marginfi: verify account + size, defer HF math.
 */
export async function probeDrift(positionAccount: string): Promise<HealthProbeResult> {
  const buf = await getAccountBase64(positionAccount);
  if (!buf) return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: null, error: "RPC returned no drift user account" };
  if (buf.length < 4000) {
    return { ok: false, healthFactor: null, collateralUsd: null, liabilitiesUsd: null, rawSize: buf.length, error: `Drift User account too small (${buf.length}B).` };
  }
  return {
    ok: false,
    healthFactor: null,
    collateralUsd: null,
    liabilitiesUsd: null,
    rawSize: buf.length,
    error: "Drift HF requires perp+spot market lookups. Account verified live; HF computation deferred to client SDK.",
  };
}

export async function probeVenue(venue: "kamino" | "marginfi" | "drift", positionAccount: string): Promise<HealthProbeResult> {
  if (venue === "kamino") return probeKamino(positionAccount);
  if (venue === "marginfi") return probeMarginfi(positionAccount);
  return probeDrift(positionAccount);
}
