/**
 * GET /.well-known/http-message-signatures-directory
 * Web Bot Auth directory — publishes the JWKS used to sign outbound
 * HTTP Message Signatures so receiving sites can verify Dreyv's bot/agent
 * requests.
 *
 * Spec: https://datatracker.ietf.org/wg/webbotauth/about/
 * Cloudflare: https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
 */

import { NextResponse } from "next/server";
import { resolvePublicJwks } from "@/lib/oauth/keys";

export const dynamic = "force-dynamic";
export async function GET() {
  let keys: unknown[] = [];
  try {
    const jwks = await resolvePublicJwks();
    keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  } catch {
    keys = [];
  }

  return NextResponse.json(
    { keys },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/http-message-signatures-directory+json",
      },
    },
  );
}
