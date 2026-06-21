/**
 * Phase 11 — Policy enforcement for public API keys.
 *
 * Pre-flight checks for every /api/v1/* (and MCP) call:
 *  - kill switch (instant, per-key disable)
 *  - capability allowlist (lockdown to a specific tool set)
 *  - origin allowlist (Referer / Origin host)
 *  - IP allowlist (request IP, with simple CIDR /N support)
 *
 * No fallbacks: returns the precise denial reason so the gateway can
 * surface a real 403 instead of silently dropping.
 */

import type { ResolvedPublicKey } from "./public-keys";

export interface PolicyDenial {
  ok: false;
  code:
    | "kill_switch"
    | "capability_not_allowed"
    | "origin_not_allowed"
    | "ip_not_allowed";
  message: string;
  detail?: Record<string, unknown>;
}

export interface PolicyOk {
  ok: true;
}

export type PolicyResult = PolicyOk | PolicyDenial;

export function clientIpFromRequest(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return null;
}

export function clientOriginHost(req: Request): string | null {
  const o = req.headers.get("origin") ?? req.headers.get("referer");
  if (!o) return null;
  try {
    return new URL(o).host.toLowerCase();
  } catch {
    return null;
  }
}

function ipMatches(ip: string, rule: string): boolean {
  if (!ip || !rule) return false;
  if (!rule.includes("/")) return ip === rule;
  const [base, bitsStr] = rule.split("/");
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0) return false;
  // IPv4 only — keep it tight; IPv6 CIDR is intentionally unsupported here.
  const toInt = (x: string) => {
    const parts = x.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const a = toInt(ip);
  const b = toInt(base);
  if (a === null || b === null || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export function checkPolicy(
  key: ResolvedPublicKey,
  capabilityId: string,
  req: Request,
): PolicyResult {
  if (key.killSwitchAt) {
    return {
      ok: false,
      code: "kill_switch",
      message: "API key kill-switch is engaged. Disable it via safety.kill_switch before continuing.",
      detail: { since: key.killSwitchAt.toISOString?.() ?? String(key.killSwitchAt) },
    };
  }
  if (key.capabilityAllowlist.length > 0 && !key.capabilityAllowlist.includes(capabilityId)) {
    return {
      ok: false,
      code: "capability_not_allowed",
      message: `Capability '${capabilityId}' is not in this key's allowlist.`,
      detail: { allowed: key.capabilityAllowlist },
    };
  }
  if (key.originAllowlist.length > 0) {
    const host = clientOriginHost(req);
    if (!host || !key.originAllowlist.some((h) => h.toLowerCase() === host)) {
      return {
        ok: false,
        code: "origin_not_allowed",
        message: `Request origin '${host ?? "(none)"}' is not in this key's allowlist.`,
        detail: { allowed: key.originAllowlist },
      };
    }
  }
  if (key.ipAllowlist.length > 0) {
    const ip = clientIpFromRequest(req);
    if (!ip || !key.ipAllowlist.some((rule) => ipMatches(ip, rule))) {
      return {
        ok: false,
        code: "ip_not_allowed",
        message: `Request IP '${ip ?? "(none)"}' is not in this key's allowlist.`,
        detail: { allowed: key.ipAllowlist },
      };
    }
  }
  return { ok: true };
}
