import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { sign, type KeychainBackend } from "@/lib/keychain";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ALLOWED_BACKENDS: KeychainBackend[] = ["custodial", "turnkey", "squads"];

/**
 * POST /api/keychain/sign
 *
 * Body: { backend: "custodial"|"turnkey"|"squads", message_b64: string, intent?: "sign_message"|"sign_transaction" }
 * Headers: Authorization: Bearer dk_live_… (scope agent:delegate required)
 *
 * Returns the signature in both base64 and base58 plus the signing pubkey.
 * For `intent: "sign_transaction"`, the caller is responsible for
 * assembling the final transaction with this signature.
 */
export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv"' } },
    );
  }
  if (!key.scopes.includes("agent:delegate")) {
    return NextResponse.json(
      { error: "insufficient_scope", required: ["agent:delegate"], granted: key.scopes },
      { status: 403 },
    );
  }

  let body: { backend?: unknown; message_b64?: unknown; intent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const backend = body.backend as KeychainBackend;
  if (!ALLOWED_BACKENDS.includes(backend)) {
    return NextResponse.json(
      { error: "invalid_backend", allowed: ALLOWED_BACKENDS },
      { status: 400 },
    );
  }
  if (typeof body.message_b64 !== "string" || body.message_b64.length < 1) {
    return NextResponse.json({ error: "missing_field", field: "message_b64" }, { status: 400 });
  }
  const intent =
    body.intent === "sign_transaction" ? "sign_transaction" : "sign_message";

  // Hard cap on message size so callers can't grief the server.
  const raw = Buffer.from(body.message_b64, "base64");
  if (raw.length > 8 * 1024) {
    return NextResponse.json({ error: "message_too_large", max_bytes: 8192 }, { status: 413 });
  }

  try {
    const result = await sign({
      userId: key.userId,
      backend,
      message_b64: body.message_b64,
      intent,
    });
    return NextResponse.json({ ok: true, ...result, intent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "sign_failed";
    const isClient =
      msg.startsWith("turnkey_unconfigured") ||
      msg.startsWith("squads_requires_proposal") ||
      msg === "unknown_backend";
    return NextResponse.json(
      { error: isClient ? "backend_unsupported" : "sign_failed", reason: msg },
      { status: isClient ? 501 : 500 },
    );
  }
}
