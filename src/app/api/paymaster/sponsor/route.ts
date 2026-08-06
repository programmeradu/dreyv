import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { sponsorTransaction, getPaymasterInfo } from "@/lib/paymaster/kora";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * POST /api/paymaster/sponsor
 *
 * Body: { transaction_b64: string, max_charge_minor?: string }
 * Headers: Authorization: Bearer dk_live_… (scope pay:x402 required)
 *
 * The submitted transaction MUST set the paymaster pubkey (see
 * /api/paymaster/info) as the fee payer. Dreyv signs as fee payer,
 * submits, and debits the caller's prepaid USDC balance.
 */
export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) {
    return NextResponse.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="dreyv", error="invalid_token"' },
      },
    );
  }
  if (!key.scopes.includes("pay:x402")) {
    return NextResponse.json(
      { error: "insufficient_scope", required: ["pay:x402"], granted: key.scopes },
      { status: 403 },
    );
  }

  const info = getPaymasterInfo();
  if (!info.available) {
    return NextResponse.json(
      {
        error: "paymaster_unconfigured",
        message:
          "Paymaster is not yet funded. Try again later or contact founders@dreyv.com.",
      },
      { status: 503 },
    );
  }

  let body: { transaction_b64?: unknown; max_charge_minor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.transaction_b64 !== "string" || body.transaction_b64.length < 4) {
    return NextResponse.json(
      { error: "missing_field", field: "transaction_b64" },
      { status: 400 },
    );
  }

  let maxChargeMinor: bigint | undefined;
  if (body.max_charge_minor !== undefined && body.max_charge_minor !== null) {
    try {
      maxChargeMinor = BigInt(String(body.max_charge_minor));
    } catch {
      return NextResponse.json(
        { error: "invalid_field", field: "max_charge_minor" },
        { status: 400 },
      );
    }
  }

  try {
    const result = await sponsorTransaction({
      userId: key.userId,
      apiKeyId: key.id,
      transaction_b64: body.transaction_b64,
      max_charge_minor: maxChargeMinor,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "sponsor_failed";
    const isClient =
      msg.startsWith("insufficient_balance") ||
      msg.startsWith("fee_exceeds_cap") ||
      msg.startsWith("charge_exceeds_max_charge_minor") ||
      msg.includes("fee_payer_mismatch");
    return NextResponse.json(
      { error: isClient ? "sponsor_rejected" : "sponsor_failed", reason: msg },
      { status: isClient ? 402 : 502 },
    );
  }
}
