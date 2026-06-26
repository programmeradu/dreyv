import { NextRequest, NextResponse } from "next/server";
import { verifyAttestationById, verifyDetached } from "@/lib/attestations/issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/attestations/verify
 *
 * Two modes — no auth required (verification is public by design):
 *   1. { id: "<attestation-uuid>" }
 *      → looks up the stored attestation and verifies its signature.
 *   2. { canonical_payload: "...", signature: "<b64>", issuer: "<pubkey b58>" }
 *      → stateless verification of an attestation the caller holds locally.
 */
export async function POST(req: NextRequest) {
  let body: {
    id?: unknown;
    canonical_payload?: unknown;
    signature?: unknown;
    issuer?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.id === "string" && body.id.length > 0) {
    try {
      const result = await verifyAttestationById(body.id);
      if (!result.ok) {
        return NextResponse.json({ valid: false, reason: result.reason }, { status: 200 });
      }
      return NextResponse.json({ valid: true, attestation: result.attestation });
    } catch (err) {
      const flat = [
        err instanceof Error ? err.message : "",
        err && typeof err === "object" && "cause" in err && (err as { cause?: unknown }).cause instanceof Error
          ? ((err as { cause: Error }).cause.message)
          : "",
      ].join(" | ");
      if (flat.includes("agent_attestations") || flat.includes("does not exist")) {
        return NextResponse.json(
          { valid: false, reason: "not_found", note: "attestations_unmigrated" },
          { status: 200 },
        );
      }
      return NextResponse.json({ valid: false, reason: "lookup_failed" }, { status: 500 });
    }
  }

  if (
    typeof body.canonical_payload === "string" &&
    typeof body.signature === "string" &&
    typeof body.issuer === "string"
  ) {
    const ok = verifyDetached({
      canonical_payload: body.canonical_payload,
      signature_b64: body.signature,
      issuer_pubkey_base58: body.issuer,
    });
    return NextResponse.json({ valid: ok, reason: ok ? null : "bad_signature" });
  }

  return NextResponse.json(
    { error: "missing_field", message: "provide either { id } or { canonical_payload, signature, issuer }" },
    { status: 400 },
  );
}
