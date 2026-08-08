export const runtime = "edge";
/**
 * GET /api/agents/action-codes/:id — agent polls for approval status.
 * Owner-scoped (only the user/key that minted the code may read it).
 */

import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getCodeStatus } from "@/lib/agent/action-codes";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = await getCodeStatus(id, key.userId);
  if (!status) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: status.id,
    intent: status.intent,
    description: status.description,
    amount_minor: status.amountMinor,
    currency: status.currency,
    status: status.status,
    expires_at: status.expiresAt.toISOString(),
    approved_at: status.approvedAt?.toISOString() ?? null,
    consumed_at: status.consumedAt?.toISOString() ?? null,
  });
}
