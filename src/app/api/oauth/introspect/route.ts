/**
 * POST /api/oauth/introspect — RFC 7662.
 * Requires authenticated client (confidential or DCR registration_access_token).
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, verifyClientSecret } from "@/lib/oauth/clients";
import { introspectToken } from "@/lib/oauth/tokens";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  if (!token) return NextResponse.json({ active: false }, { status: 200 });

  // Confidential client auth via Basic header.
  const authHeader = req.headers.get("authorization");
  let authed = false;
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    try {
      const raw = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
      const idx = raw.indexOf(":");
      if (idx > 0) {
        const cid = decodeURIComponent(raw.slice(0, idx));
        const secret = decodeURIComponent(raw.slice(idx + 1));
        const client = await getClient(cid);
        if (client && verifyClientSecret(secret, client.clientSecretHash)) authed = true;
      }
    } catch {}
  }
  if (!authed) return NextResponse.json({ error: "invalid_client" }, { status: 401 });

  const result = await introspectToken(token);
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
