/**
 * REST dispatcher: GET/POST /api/v1/<capability/path>
 *
 *   Authorization: Bearer dk_live_…
 *
 * Validates bearer → enforces scope → enforces rate limit → runs capability →
 * records usage. All 15 Phase-1 capabilities are reachable as:
 *
 *   GET  /api/v1/portfolio/holdings?address=…&chain=solana
 *   POST /api/v1/identity/delegate_session  { body }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  findCapabilityByRestPath,
  type PublicCapability,
} from "@/lib/capabilities/registry";
import {
  extractBearer,
  resolvePublicKey,
  hasScope,
  checkRateLimit,
  recordUsage,
} from "@/lib/api-keys/public-keys";
import { checkPolicy } from "@/lib/api-keys/policy";
import { CapabilityError } from "@/lib/capabilities/handlers";
import { chargeAgentBalance, getAgentBalance, ensureStarterGrant, minorToUsd } from "@/lib/agent/balance";

export const dynamic = "force-dynamic";

// Per-call price in USDC minor units (6 decimals). Defaults to $0.001/call.
// Override per-capability via `cost` on the registry entry (also in minor units),
// or globally via DREYV_CAPABILITY_DEFAULT_PRICE_MINOR. Set 0 to make a capability free.
const DEFAULT_PRICE_MINOR = BigInt(
  Number(process.env.DREYV_CAPABILITY_DEFAULT_PRICE_MINOR ?? 1000) | 0,
);

function priceMinorFor(cap: { cost?: number }): bigint {
  if (typeof cap.cost === "number" && Number.isFinite(cap.cost)) {
    return BigInt(Math.max(0, Math.floor(cap.cost)));
  }
  return DEFAULT_PRICE_MINOR;
}


async function handle(req: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const t0 = Date.now();
  const { slug } = await context.params;
  const cap = findCapabilityByRestPath(slug ?? []);
  if (!cap) {
    return NextResponse.json(
      { error: "capability_not_found", path: (slug ?? []).join("/") },
      { status: 404 },
    );
  }

  const bearer = extractBearer(req);
  const key = await resolvePublicKey(bearer);
  if (!key && !cap.allowAnonymous) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message:
          "Missing or invalid Dreyv API key. Pass `Authorization: Bearer dk_live_…` (mint one at /app/settings/api).",
      },
      { status: 401 },
    );
  }

  let rlRemaining = "100";
  if (key) {
    if (!hasScope(key, cap.scope)) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "denied",
        latencyMs: Date.now() - t0,
        errorCode: "missing_scope",
      });
      return NextResponse.json(
        { error: "missing_scope", required: cap.scope, granted: key.scopes },
        { status: 403 },
      );
    }

    const policy = checkPolicy(key, cap.id, req);
    if (!policy.ok) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "denied",
        latencyMs: Date.now() - t0,
        errorCode: policy.code,
      });
      return NextResponse.json(
        { error: policy.code, message: policy.message, ...(policy.detail ?? {}) },
        { status: 403 },
      );
    }

    const rl = checkRateLimit(key);
    rlRemaining = String(rl.remaining);
    if (!rl.ok) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "rate_limited",
        latencyMs: Date.now() - t0,
        errorCode: "rate_limited",
      });
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rl.retryAfterMs, limitRpm: key.rateLimitRpm },
        { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
      );
    }
  }

  // Parse input from query (GET) or body (POST).
  let raw: Record<string, unknown> = {};
  if (req.method === "GET") {
    raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  } else {
    try {
      raw = await req.json();
    } catch {
      raw = {};
    }
  }
  // Coerce numeric query params best-effort for GET.
  if (req.method === "GET") {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) {
        const n = Number(v);
        if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v)) raw[k] = n;
      }
    }
  }

  const parsed = (cap as PublicCapability).inputSchema.safeParse(raw);
  if (!parsed.success) {
    if (key) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "error",
        latencyMs: Date.now() - t0,
        errorCode: "invalid_input",
      });
    }
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Charge prepaid agent balance per call (skip if priced at 0).
  const priceMinor = priceMinorFor(cap);
  let balanceAfterMinor: bigint | null = null;
  if (key && priceMinor > BigInt(0)) {
    // Per-call ref MUST be unique — the ledger has UNIQUE(reason, ref).
    // Reusing key.id here would either silently skip the second charge
    // (free calls) or raise a constraint error and 500 the request.
    const callRef = `${key.id}:${t0}:${crypto.randomUUID()}`;
    let charge = await chargeAgentBalance({
      userId: key.userId,
      amountMinor: priceMinor,
      reason: `capability:${cap.id}`,
      ref: callRef,
    });
    // First-touch: a brand-new agent has $0 balance and would 402 on its
    // very first call. Seed the one-time starter grant (idempotent) and
    // retry the charge so the developer can prove the loop end-to-end
    // without funding anything first.
    if (!charge.ok && charge.reason === "insufficient") {
      const seeded = await ensureStarterGrant(key.userId);
      if (seeded.ok) {
        charge = await chargeAgentBalance({
          userId: key.userId,
          amountMinor: priceMinor,
          reason: `capability:${cap.id}`,
          ref: `${callRef}:retry`,
        });
      }
    }
    if (!charge.ok) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "denied",
        latencyMs: Date.now() - t0,
        errorCode: "insufficient_balance",
      });
      const bal = await getAgentBalance(key.userId);
      return NextResponse.json(
        {
          error: "insufficient_balance",
          message:
            "Prepaid agent balance is too low to execute this capability. Top up via POST /api/agents/balance/topup.",
          capability: cap.id,
          required_usd: minorToUsd(priceMinor),
          balance_usd: minorToUsd(bal.balance_minor),
          required_minor: priceMinor.toString(),
          balance_minor: bal.balance_minor.toString(),
          topup_url: `${new URL(req.url).origin}/api/agents/balance/topup`,
        },
        { status: 402 },
      );
    }
    balanceAfterMinor = charge.balance_after;
  }

  const origin = new URL(req.url).origin;
  try {
    const result = await cap.handler(parsed.data, {
      userId: key?.userId ?? "anonymous",
      keyId: key?.id ?? "anonymous",
      origin,
      transport: "rest",
    });
    const latencyMs = Date.now() - t0;
    if (key) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "ok",
        latencyMs,
        costCredits: Number(priceMinor),
      });
    }
    return NextResponse.json(
      {
        ok: true,
        capability: cap.id,
        latencyMs,
        data: result,
        billing: key && priceMinor > BigInt(0)
          ? {
              charged_usd: minorToUsd(priceMinor),
              charged_minor: priceMinor.toString(),
              balance_after_usd: balanceAfterMinor !== null ? minorToUsd(balanceAfterMinor) : null,
            }
          : { charged_usd: "0.00", charged_minor: "0", balance_after_usd: null },
      },
      { headers: { "x-dreyv-capability": cap.id, "x-dreyv-rate-remaining": rlRemaining } },
    );

  } catch (err) {
    const latencyMs = Date.now() - t0;
    const status = err instanceof CapabilityError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal error";
    if (key) {
      await recordUsage({
        keyId: key.id,
        userId: key.userId,
        capabilityId: cap.id,
        transport: "rest",
        status: "error",
        latencyMs,
        errorCode: String(status),
      });
    }
    return NextResponse.json(
      { error: "capability_failed", message, capability: cap.id },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, ctx);
}
