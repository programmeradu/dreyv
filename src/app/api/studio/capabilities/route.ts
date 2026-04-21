/**
 * GET /api/studio/capabilities — Reports what the Studio can actually do
 * given the current server environment. Used by the header to disable
 * features that would otherwise fail silently.
 *
 * Honest > pretty. If a key is missing, the UI hides the action.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    const cfAccount = !!process.env.CLOUDFLARE_ACCOUNT_ID;
    const cfToken = !!process.env.CLOUDFLARE_AI_TOKEN;
    const browserRendering = cfAccount && cfToken;

    const db = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    const arweave = !!(process.env.ARWEAVE_KEY || process.env.BUNDLR_KEY);
    const turnkey = !!(process.env.TURNKEY_API_PUBLIC_KEY && process.env.TURNKEY_API_PRIVATE_KEY);

    return NextResponse.json({
        browserRendering, // preview-screenshot, pdf-export, real smoke test
        save: db,         // ship to library requires DB
        ship: db,         // ship requires DB; arweave/turnkey strengthen it
        arweave,
        turnkey,
        // Test mode the server can actually deliver
        testMode: browserRendering ? "real" : "static-lint",
    });
}
