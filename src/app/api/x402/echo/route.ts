import { NextRequest, NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

/**
 * Minimal x402-protected echo endpoint.
 *
 * Returns HTTP 402 Payment Required with a `accepts` array of payment
 * requirements (per x402 spec — https://x402.org) when called without a
 * valid `X-PAYMENT` header. Agents that satisfy the requirement (in a
 * future signed flow) get a 200 echo. This is the live "x402 detected"
 * surface that agent-readiness scanners probe.
 */
export async function GET(req: NextRequest) {
    return handle(req);
}

export async function POST(req: NextRequest) {
    return handle(req);
}

export function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "X-PAYMENT, Content-Type, Authorization",
        },
    });
}

async function handle(req: NextRequest) {
    const origin = getSiteOrigin();
    const payment = req.headers.get("x-payment");

    if (!payment) {
        return NextResponse.json(
            {
                x402Version: 1,
                error: "payment_required",
                accepts: [
                    {
                        scheme: "exact",
                        network: "base-sepolia",
                        maxAmountRequired: "1000",
                        resource: `${origin}/api/x402/echo`,
                        description: "Per-call dreyv x402 echo endpoint.",
                        mimeType: "application/json",
                        payTo: "0x0000000000000000000000000000000000000000",
                        maxTimeoutSeconds: 60,
                        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                        extra: {
                            name: "USDC",
                            version: "2",
                        },
                    },
                ],
            },
            {
                status: 402,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
                },
            },
        );
    }

    return NextResponse.json(
        {
            ok: true,
            resource: `${origin}/api/x402/echo`,
            received: payment.slice(0, 32) + "…",
        },
        { headers: { "Access-Control-Allow-Origin": "*" } },
    );
}
