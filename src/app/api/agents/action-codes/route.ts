/**
 * POST /api/agents/action-codes — agent mints a one-time human approval code.
 *
 * Request:
 *   { intent: string, description: string, amount_minor?: number|string,
 *     currency?: "usdc", metadata?: object }
 *
 * Response (single source of truth — the agent shows `code` + `approval_url`
 * to the human, then polls GET /api/agents/action-codes/:id):
 *   { id, code, approval_url, expires_at, human_prompt }
 *
 * After approval the agent passes `id` back into the privileged action.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { mintActionCode } from "@/lib/agent/action-codes";

export const dynamic = "force-dynamic";

const MAX_INTENT_LEN = 64;
const MAX_DESC_LEN = 280;

export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    intent?: string;
    description?: string;
    amount_minor?: string | number | null;
    currency?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const intent = (body.intent || "").trim();
  const description = (body.description || "").trim();
  if (!intent || intent.length > MAX_INTENT_LEN) {
    return NextResponse.json({ error: "invalid_intent", note: `1..${MAX_INTENT_LEN} chars` }, { status: 400 });
  }
  if (!description || description.length > MAX_DESC_LEN) {
    return NextResponse.json({ error: "invalid_description", note: `1..${MAX_DESC_LEN} chars` }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const minted = await mintActionCode(
    {
      userId: key.userId,
      apiKeyId: key.id,
      intent,
      description,
      amountMinor: body.amount_minor != null ? BigInt(body.amount_minor) : null,
      currency: body.currency ?? null,
      metadata: body.metadata ?? {},
    },
    origin,
  );

  return NextResponse.json({
    id: minted.id,
    code: minted.code,
    approval_url: minted.approvalUrl,
    expires_at: minted.expiresAt.toISOString(),
    human_prompt: `Ask the user: "Open ${minted.approvalUrl} and enter code ${minted.code} to approve ${intent}." Then poll GET /api/agents/action-codes/${minted.id} until status='approved'.`,
    poll_url: `${origin}/api/agents/action-codes/${minted.id}`,
  });
}
