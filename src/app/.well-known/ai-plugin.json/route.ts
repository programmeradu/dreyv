import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * OpenAI plugin manifest (legacy ai-plugin.json discovery).
 * Spec: https://platform.openai.com/docs/plugins/getting-started/plugin-manifest
 */
export function GET() {
  const origin = getSiteOrigin();
  return NextResponse.json(
    {
      schema_version: "v1",
      name_for_human: "dreyv",
      name_for_model: "dreyv",
      description_for_human:
        "Non-custodial AI treasury workspace for Web3 teams. Intent → Plan → Simulate → Sign. Solana-native.",
      description_for_model:
        "dreyv is a non-custodial AI treasury command layer for Solana DAOs and protocols. Use it to turn plain-language treasury intent into multi-step plans, simulate them on forked state, and propose them to a Squads multisig for signing. Public endpoints expose token prices, atlas data, and research tools. Authenticated endpoints expose planning, simulation, swap routing (Jupiter), vault balances, and Squads proposals. dreyv never custodies private keys.",
      auth: {
        type: "oauth",
        client_url: `${origin}/developers#oauth`,
        scope: "read write",
        authorization_url: `${origin}/api/auth/authorize`,
        authorization_content_type: "application/json",
        verification_tokens: {},
      },
      api: {
        type: "openapi",
        url: `${origin}/openapi.json`,
        is_user_authenticated: true,
      },
      logo_url: `${origin}/icon.png`,
      contact_email: "founders@dreyv.com",
      legal_info_url: `${origin}/legal/terms`,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    },
  );
}
