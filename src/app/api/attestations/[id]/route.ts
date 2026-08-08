import { NextRequest, NextResponse } from "next/server";
import { getAttestationById } from "@/lib/attestations/issuer";

export const dynamic = "force-dynamic";

/**
 * GET /api/attestations/[id]
 *
 * Public resolver for an attestation. Returns the full envelope including
 * the canonical_payload so any client can independently verify the
 * ed25519 signature against the issuer pubkey.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    const att = await getAttestationById(id);
    if (!att) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(att, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "lookup_failed", reason: err instanceof Error ? err.message : "" },
      { status: 500 },
    );
  }
}
