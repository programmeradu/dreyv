export const runtime = "edge";
/**
 * GET  /api/agents/wallet/caps — read current per-user spend caps + 24h spend.
 * PATCH /api/agents/wallet/caps — tighten caps. Loosening (raising any cap)
 *                                  requires a human-approved action code with
 *                                  intent="wallet.caps.update".
 */

import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getWalletCaps, setWalletCaps, getSpendLast24hMinor, type WalletCaps } from "@/lib/agent/caps";
import { consumeApprovedCode } from "@/lib/agent/action-codes";

export const dynamic = "force-dynamic";

function serialise(c: WalletCaps) {
  return {
    per_tx_max_minor: c.perTxMaxMinor.toString(),
    per_day_max_minor: c.perDayMaxMinor.toString(),
    require_code_above_minor: c.requireCodeAboveMinor.toString(),
    currency: "usdc",
    decimals: 6,
  };
}

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [caps, spent] = await Promise.all([
    getWalletCaps(key.userId),
    getSpendLast24hMinor(key.userId),
  ]);
  return NextResponse.json({ caps: serialise(caps), spent_24h_minor: spent.toString() });
}

export async function PATCH(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    per_tx_max_minor?: string | number;
    per_day_max_minor?: string | number;
    require_code_above_minor?: string | number;
    action_code_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const current = await getWalletCaps(key.userId);
  const patch: Partial<WalletCaps> = {};
  if (body.per_tx_max_minor != null) patch.perTxMaxMinor = BigInt(body.per_tx_max_minor);
  if (body.per_day_max_minor != null) patch.perDayMaxMinor = BigInt(body.per_day_max_minor);
  if (body.require_code_above_minor != null) patch.requireCodeAboveMinor = BigInt(body.require_code_above_minor);

  const isLoosening =
    (patch.perTxMaxMinor != null && patch.perTxMaxMinor > current.perTxMaxMinor) ||
    (patch.perDayMaxMinor != null && patch.perDayMaxMinor > current.perDayMaxMinor) ||
    (patch.requireCodeAboveMinor != null && patch.requireCodeAboveMinor > current.requireCodeAboveMinor);

  if (isLoosening) {
    if (!body.action_code_id) {
      return NextResponse.json(
        {
          error: "requires_action_code",
          intent: "wallet.caps.update",
          human_prompt:
            "Raising spend caps requires human approval. Mint an action code via POST /api/agents/action-codes with intent='wallet.caps.update', have the user approve it, then retry with { action_code_id }.",
        },
        { status: 402 },
      );
    }
    const consumed = await consumeApprovedCode({
      id: body.action_code_id,
      userId: key.userId,
      intent: "wallet.caps.update",
    });
    if (!consumed.ok) {
      return NextResponse.json({ error: "action_code_invalid", reason: consumed.reason }, { status: 403 });
    }
  }

  const next = await setWalletCaps(key.userId, patch);
  return NextResponse.json({ caps: serialise(next) });
}
