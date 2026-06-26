import { NextRequest, NextResponse } from "next/server";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { listBackends } from "@/lib/keychain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/keychain/backends
 *
 * Returns every signer backend available to the caller (custodial,
 * turnkey, squads…) with the matching capabilities and pubkey when
 * already provisioned. Mirrors solana.com/tools/keychain shape.
 */
export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv"' } },
    );
  }
  const backends = await listBackends(key.userId);
  return NextResponse.json({
    service: "dreyv-keychain",
    spec: "https://solana.com/docs/tools/keychain",
    user_id: key.userId,
    backends,
  });
}
