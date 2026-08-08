export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getIssuerInfo, issueAttestation } from "@/lib/attestations/issuer";
import { getOrCreateAgentWallet } from "@/lib/agent/wallet";

export const dynamic = "force-dynamic";

/**
 * POST /api/attestations/issue
 *
 * Body: { schema: string, claims: object, subject?: { user_id?, wallet? }, expires_in_seconds?: number }
 * Headers: Authorization: Bearer dk_live_…
 *
 * The caller can attest about themselves (default) or about a Solana wallet
 * they control (caller must include the wallet in subject). All attestations
 * are publicly verifiable via GET /api/attestations/[id].
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

  const issuer = getIssuerInfo();
  if (!issuer.available) {
    return NextResponse.json(
      {
        error: "issuer_unconfigured",
        message:
          "Attestation signer not configured. Operator must set ATTESTATION_SIGNING_KEY_BASE58.",
      },
      { status: 503 },
    );
  }

  let body: {
    schema?: unknown;
    claims?: unknown;
    subject?: { user_id?: unknown; wallet?: unknown };
    expires_in_seconds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.schema !== "string" || !body.schema) {
    return NextResponse.json({ error: "missing_field", field: "schema" }, { status: 400 });
  }
  if (!body.claims || typeof body.claims !== "object") {
    return NextResponse.json({ error: "missing_field", field: "claims" }, { status: 400 });
  }
  if (JSON.stringify(body.claims).length > 8_192) {
    return NextResponse.json({ error: "claims_too_large", max_bytes: 8192 }, { status: 413 });
  }

  // Default subject = the caller. Always pin user_id to the bearer.
  const subject = {
    user_id: key.userId,
    wallet:
      typeof body.subject?.wallet === "string" && body.subject.wallet.length > 0
        ? body.subject.wallet
        : null,
  };

  // Auto-attach the agent's custodial wallet on the canonical
  // dreyv.agent.identity.v1 schema for downstream verification.
  if (body.schema === "dreyv.agent.identity.v1" && !subject.wallet) {
    try {
      const w = await getOrCreateAgentWallet(key.userId);
      subject.wallet = w.publicKey;
    } catch {
      // non-fatal — issue without wallet
    }
  }

  const expiresAt =
    typeof body.expires_in_seconds === "number" && body.expires_in_seconds > 0
      ? new Date(Date.now() + body.expires_in_seconds * 1000)
      : null;

  try {
    const att = await issueAttestation({
      schema: body.schema,
      subject,
      claims: body.claims as Record<string, unknown>,
      expires_at: expiresAt,
    });
    return NextResponse.json({ ok: true, attestation: att });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "issue_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
