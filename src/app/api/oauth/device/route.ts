/**
 * POST /api/oauth/device — RFC 8628 device authorization request.
 * Public clients may call this without auth; we still require a valid client_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { oauthDeviceCodes } from "@/db/schema";
import { getClient } from "@/lib/oauth/clients";
import { parseScopeString } from "@/lib/oauth/scopes";
import { hashToken } from "@/lib/oauth/tokens";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function userCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const scopeRaw = String(form.get("scope") ?? "");
  if (!clientId) {
    return NextResponse.json({ error: "invalid_request", error_description: "client_id required" }, { status: 400 });
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  if (!client.grantTypes.includes("urn:ietf:params:oauth:grant-type:device_code")) {
    return NextResponse.json({ error: "unauthorized_client" }, { status: 400 });
  }
  if (!db) return NextResponse.json({ error: "server_error" }, { status: 500 });

  const scopes = parseScopeString(scopeRaw);
  const deviceCode = `dod_${randomBytes(40).toString("base64url")}`;
  const code = userCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(oauthDeviceCodes).values({
    deviceCodeHash: hashToken(deviceCode),
    userCode: code,
    clientId,
    scopes,
    expiresAt,
    intervalSeconds: 5,
  });

  const origin = getSiteOrigin();
  return NextResponse.json(
    {
      device_code: deviceCode,
      user_code: code,
      verification_uri: `${origin}/oauth/device`,
      verification_uri_complete: `${origin}/oauth/device?user_code=${encodeURIComponent(code)}`,
      expires_in: 900,
      interval: 5,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
