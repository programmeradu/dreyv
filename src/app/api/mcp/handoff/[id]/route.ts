/**
 * GET  /api/mcp/handoff/[id]       → returns the staged tx + meta for the mobile signer UI
 * POST /api/mcp/handoff/[id]       → { signature } records that the user signed + broadcast
 * DELETE /api/mcp/handoff/[id]     → user rejected
 *
 * No auth needed to GET — the `id` itself is unguessable (96-bit) and short-lived.
 */
import { NextRequest, NextResponse } from "next/server";
import { getHandoff, markHandoffSigned, rejectHandoff } from "@/lib/mcp/handoff-store";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = getHandoff(id);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  return NextResponse.json(
    {
      id: rec.id,
      txBase64: rec.txBase64,
      userPublicKey: rec.userPublicKey,
      label: rec.label,
      network: rec.network,
      meta: rec.meta ?? null,
      status: rec.status,
      signature: rec.signature ?? null,
      expiresAt: rec.expiresAt,
    },
    { headers: CORS },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { signature?: string };
  if (!body.signature || typeof body.signature !== "string") {
    return NextResponse.json({ error: "missing_signature" }, { status: 400, headers: CORS });
  }
  const rec = markHandoffSigned(id, body.signature);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  return NextResponse.json({ ok: true, status: rec.status, signature: rec.signature }, { headers: CORS });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = rejectHandoff(id);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  return NextResponse.json({ ok: true, status: rec.status }, { headers: CORS });
}
