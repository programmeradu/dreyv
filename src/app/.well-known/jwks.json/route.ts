/**
 * GET /.well-known/jwks.json — Public JSON Web Key Set.
 * Includes every non-retired OAuth signing key so older tokens still verify
 * during key rotation.
 */

import { NextResponse } from "next/server";
import { resolvePublicJwks } from "@/lib/oauth/keys";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  try {
    const jwks = await resolvePublicJwks();
    return NextResponse.json(jwks, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/jwk-set+json",
      },
    });
  } catch {
    return NextResponse.json(
      { keys: [] },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/jwk-set+json",
        },
      },
    );
  }
}
