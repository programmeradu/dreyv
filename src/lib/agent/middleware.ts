/**
 * withAgentAuth — unified middleware for every agent-facing endpoint.
 *
 *   - Resolves the caller via Bearer token (dk_live_… key OR OAuth JWT).
 *   - Enforces required scopes.
 *   - Optionally requires x402 payment (returns 402 with `accepts` if missing).
 *   - Calls the handler with the resolved key + verified payment context.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractBearer,
  resolvePublicKey,
  type ApiScope,
  type ResolvedPublicKey,
} from "@/lib/api-keys/public-keys";
import { getSiteOrigin } from "@/lib/seo/site";
import { verifyX402Payment, type X402Requirements } from "@/lib/agent/x402-verify";
import type { AgentCapability } from "@/lib/agent/registry";

const RECEIVER = process.env.X402_PAY_TO?.trim() || "0x0000000000000000000000000000000000000000";
const ASSET = process.env.X402_ASSET?.trim() || "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC base-sepolia
const NETWORK = process.env.X402_NETWORK?.trim() || "base-sepolia";

export interface AgentCtx {
  key: ResolvedPublicKey;
  payer?: string;
}

export type AgentHandler = (req: NextRequest, ctx: AgentCtx) => Promise<Response> | Response;

export function withAgentAuth(
  cap: Pick<AgentCapability, "id" | "resource" | "requiredScopes" | "pricing" | "priceAtomic"> & {
    allRequired?: boolean;
  },
  handler: AgentHandler,
) {
  return async function wrapped(req: NextRequest): Promise<Response> {
    const bearer = extractBearer(req);
    const key = bearer ? await resolvePublicKey(bearer) : null;
    if (!key) {
      return NextResponse.json(
        { error: "unauthorized", capability: cap.id },
        {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="dreyv", error="invalid_token"' },
        },
      );
    }

    const ok = cap.allRequired
      ? cap.requiredScopes.every((s) => key.scopes.includes(s as ApiScope))
      : cap.requiredScopes.some((s) => key.scopes.includes(s as ApiScope));
    if (!ok) {
      return NextResponse.json(
        {
          error: "insufficient_scope",
          required: cap.requiredScopes,
          granted: key.scopes,
          capability: cap.id,
        },
        { status: 403 },
      );
    }

    let payer: string | undefined;
    if (cap.pricing === "metered") {
      const origin = getSiteOrigin();
      const requirements: X402Requirements = {
        scheme: "exact",
        network: NETWORK,
        maxAmountRequired: cap.priceAtomic ?? "1000",
        resource: `${origin}${cap.resource}`,
        payTo: RECEIVER,
        asset: ASSET,
        description: cap.id,
        mimeType: "application/json",
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      };

      const header = req.headers.get("x-payment");
      if (!header) {
        return NextResponse.json(
          { x402Version: 1, error: "payment_required", accepts: [requirements] },
          {
            status: 402,
            headers: {
              "WWW-Authenticate": `x402 resource="${requirements.resource}", scheme="exact", network="${NETWORK}"`,
              Link: `<${origin}/.well-known/x402>; rel="payment-discovery"; type="application/json"`,
              "X-Payment-Required": "true",
              "X-X402-Version": "1",
              "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE, WWW-Authenticate, Link",
            },
          },
        );
      }

      const result = await verifyX402Payment(header, requirements);
      if (!result.ok) {
        return NextResponse.json(
          { x402Version: 1, error: "payment_invalid", reason: result.reason, accepts: [requirements] },
          { status: 402 },
        );
      }
      payer = result.payer;
    }

    return handler(req, { key, payer });
  };
}
