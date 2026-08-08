export const runtime = "edge";
/**
 * POST /api/studio/marketplace/register — Register app on-chain (KeystoneMarket).
 *
 * On-chain registration must be built and signed CLIENT-SIDE via the
 * developer's wallet (Turnkey / Phantom / Backpack). This route no longer
 * pretends to accept a signed tx — it returns 501 so callers don't ship a
 * silent no-op. Wire the SDK `useTurnkey().signTransaction(initialize_app)`
 * flow in the Studio publish button instead.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "On-chain marketplace registration must be built and signed in the wallet. " +
        "Use the client SDK: buildInitializeAppTx() then wallet.signAndSend().",
      docs: "/developers/marketplace#on-chain-registration",
    },
    { status: 501 },
  );
}
