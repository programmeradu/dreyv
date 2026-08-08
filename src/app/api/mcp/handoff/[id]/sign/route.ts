/**
 * Solana Pay transaction-request endpoint.
 *
 * Wallets (Phantom mobile, Solflare, Backpack) scanning the QR will:
 *   1. GET  /api/mcp/handoff/[id]/sign → { label, icon }
 *   2. POST /api/mcp/handoff/[id]/sign { account } → { transaction (base64), message }
 *
 * Spec: https://docs.solanapay.com/spec#transaction-requests
 */
import { NextRequest, NextResponse } from "next/server";
import { getHandoff } from "@/lib/mcp/handoff-store";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = await getHandoff(id);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  return NextResponse.json(
    {
      label: `Dreyv · ${rec.label}`,
      icon: `${getSiteOrigin()}/dreyv-mark.svg`,
    },
    { headers: CORS },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = await getHandoff(id);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  const body = (await req.json().catch(() => ({}))) as { account?: string };
  if (!body.account) {
    return NextResponse.json({ error: "missing_account" }, { status: 400, headers: CORS });
  }
  return NextResponse.json(
    {
      transaction: rec.txBase64,
      message: rec.label,
    },
    { headers: CORS },
  );
}
