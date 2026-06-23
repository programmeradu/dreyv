/**
 * x402 payment verification.
 *
 * In production, this calls the configured facilitator's /verify and
 * /settle endpoints (e.g. https://x402.org/facilitator on base-sepolia,
 * or a self-hosted Coinbase facilitator). For now we provide a typed
 * shell that:
 *   - extracts the X-PAYMENT header,
 *   - calls the facilitator if `X402_FACILITATOR_URL` is set,
 *   - otherwise treats any non-empty payload as accepted in DEV only.
 *
 * Never trust the dev fallback in production.
 */

export interface X402Requirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface X402VerifyResult {
  ok: boolean;
  reason?: string;
  payer?: string;
  txHash?: string;
}

export async function verifyX402Payment(
  headerValue: string,
  requirements: X402Requirements,
): Promise<X402VerifyResult> {
  if (!headerValue) return { ok: false, reason: "missing_x_payment" };

  const facilitator = process.env.X402_FACILITATOR_URL?.trim();
  if (!facilitator) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "facilitator_not_configured" };
    }
    return { ok: true, payer: "dev:unverified" };
  }

  try {
    const res = await fetch(`${facilitator.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: headerValue,
        paymentRequirements: requirements,
      }),
    });
    if (!res.ok) return { ok: false, reason: `facilitator_${res.status}` };
    const data = (await res.json()) as { isValid?: boolean; payer?: string; invalidReason?: string };
    if (!data.isValid) return { ok: false, reason: data.invalidReason ?? "invalid" };
    return { ok: true, payer: data.payer };
  } catch (err) {
    return { ok: false, reason: `facilitator_error:${(err as Error).message}` };
  }
}
