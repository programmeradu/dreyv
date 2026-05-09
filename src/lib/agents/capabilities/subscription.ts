/**
 * Subscription / tier upgrade capability.
 *
 * The agent must be able to handle "upgrade to mini" / "switch to max" /
 * "what's my plan" without hallucinating. This capability returns a real
 * navigation payload pointing at /app/billing where the user picks
 * Card (Paystack) or Crypto (10% off, USDC/USDT/SOL today).
 *
 * It deliberately does NOT mint a Paystack URL server-side here — Paystack
 * checkout creation is auth-cookie scoped and lives on /app/billing's
 * client flow. The agent's job is to route the user there with the right
 * pre-selected tier and payment-method picker open.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";

const upgrade_subscription = defineCapability({
  id: "upgrade_subscription",
  domain: "payments",
  description:
    "Initiate a Dreyv tier change (free → mini → max). Use whenever the user says 'upgrade', 'switch to mini/max', 'go pro', or asks how to pay. Returns a real navigation target to /app/billing with the chosen tier preselected and the card-vs-crypto picker visible. Do NOT promise a checkout URL — the user must complete payment from /app/billing.",
  inputSchema: z.object({
    tier: z.enum(["mini", "max"]).describe("Target tier."),
    method: z
      .enum(["card", "crypto", "any"])
      .optional()
      .default("any")
      .describe("Preferred payment rail. 'crypto' includes a 10% discount."),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["solana", "evm"],
  execute: async (input) => {
    const usd = input.tier === "mini" ? 49 : 199;
    const cryptoUsd = (usd * 0.9).toFixed(2);
    const url = "/app/billing";
    return {
      success: true,
      operation: "upgrade_subscription",
      tier: input.tier,
      method: input.method,
      url,
      navigate: url,
      message:
        input.method === "crypto"
          ? `Open /app/billing and use the crypto panel — ${input.tier === "mini" ? "Mini" : "Max"} settles for $${cryptoUsd} in USDC, USDT, or SOL (10% off card price).`
          : input.method === "card"
            ? `Open /app/billing and click Upgrade to ${input.tier === "mini" ? "Mini" : "Max"} — Paystack will take it from there ($${usd}/mo).`
            : `Open /app/billing to upgrade to ${input.tier === "mini" ? "Mini" : "Max"}. You can pay $${usd}/mo by card (Paystack) or $${cryptoUsd}/cycle in crypto (USDC/USDT/SOL · 10% off).`,
      pricing: { card: { usd, recurring: true, provider: "paystack" }, crypto: { usd: Number(cryptoUsd), recurring: false, discountPct: 10, assets: ["usdc", "usdt", "sol"], chain: "solana" } },
    };
  },
});

const get_subscription_status = defineCapability({
  id: "get_subscription_status",
  domain: "payments",
  description:
    "Read the caller's current Dreyv subscription tier and status. Use when the user asks 'what plan am I on', 'am I a paid user', or before suggesting an upgrade.",
  inputSchema: z.object({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  supportedChains: ["solana", "evm"],
  execute: async (_input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "get_subscription_status", message: "Wallet required to read subscription." };
    }
    // Best-effort: hit the same endpoint the billing page uses so we never drift.
    try {
      const origin = (await import("@/lib/seo/site")).getSiteOrigin();
      const res = await fetch(`${origin}/api/paystack/status`, { headers: { "x-wallet": ctx.walletAddress }, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      return {
        success: true,
        operation: "get_subscription_status",
        tier: data?.tier ?? "free",
        status: data?.status ?? "inactive",
        provider: "paystack",
      };
    } catch (err) {
      return { success: false, operation: "get_subscription_status", message: `Could not read status: ${(err as Error).message}` };
    }
  },
});

export const subscriptionCapabilities: AnyCapability[] = [upgrade_subscription, get_subscription_status];
