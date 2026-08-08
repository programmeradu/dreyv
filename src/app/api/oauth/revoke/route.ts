export const runtime = "edge";
/**
 * POST /api/oauth/revoke — RFC 7009. Accepts access or refresh tokens.
 * Per spec, returns 200 even when the token is unknown.
 */
import { NextRequest, NextResponse } from "next/server";
import { revokeByToken } from "@/lib/oauth/tokens";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  if (token) await revokeByToken(token);
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
