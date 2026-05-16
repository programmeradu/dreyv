/**
 * Subscription / tier upgrade capability.
 *
 * The agent must be able to handle "upgrade to mini" / "switch to max" /
 * "what's my plan" without hallucinating.
 *
 * When the caller is authenticated (wallet known) and Paystack is configured,
 * this capability mints a real Paystack hosted-checkout URL so the user can
 * complete the upgrade **directly from chat** without first navigating to
 * /app/billing. When Paystack isn't reachable or the user has no email on
 * file, we fall back to the navigation-to-/app/billing payload so the user
 * can finish there (with the tier preselected and the card-vs-crypto picker
 * visible).
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";

const upgrade_subscription = defineCapability({
  id: "upgrade_subscription",
  domain: "payments",
  description:
    "Initiate a Dreyv tier change (free → mini → max). Use whenever the user says 'upgrade', 'switch to mini/max', 'go pro', or asks how to pay. Returns a real Paystack checkout URL the user can open from chat (card rail) and/or a navigation target to /app/billing for the crypto rail. If the user is unauthenticated or has no billing email, returns only the /app/billing navigation.",
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
  execute: async (input, ctx) => {
    const usd = input.tier === "mini" ? 49 : 199;
    const cryptoUsd = (usd * 0.9).toFixed(2);
    const billingUrl = "/app/billing";

    // Try to mint a real Paystack checkout URL when:
    //   - the user wants the card rail (or "any"),
    //   - we know the wallet (so we can resolve the user + email),
    //   - Paystack is configured + plan code for tier exists,
    //   - the user has a valid billing email.
    let checkoutUrl: string | null = null;
    let checkoutReference: string | null = null;
    let checkoutError: string | null = null;

    if (input.method !== "crypto" && ctx.walletAddress) {
      try {
        const [{ db }, { users }, { eq }, paystack, { isValidBillingEmail }, { getSiteOrigin }, { resolveUserIdFromWallet }] =
          await Promise.all([
            import("@/db"),
            import("@/db/schema"),
            import("drizzle-orm"),
            import("@/lib/paystack"),
            import("@/lib/billing-email"),
            import("@/lib/seo/site"),
            import("@/lib/agents/brains/storage"),
          ]);

        // Guard: Paystack configured + plan mapping exists.
        try { paystack.getPaystackSecret(); } catch { throw new Error("Paystack is not configured"); }
        const plan = paystack.planCodeForTier(input.tier);
        if (!plan) throw new Error(`No Paystack plan code for ${input.tier}`);

        // Resolve user + email from wallet.
        if (!db) throw new Error("Database unavailable");
        const userId = await resolveUserIdFromWallet(ctx.walletAddress);
        if (!userId) throw new Error("No Dreyv account linked to this wallet");

        const [row] = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const email = (row?.email ?? "").trim();
        if (!isValidBillingEmail(email)) {
          throw new Error("Add a billing email in Settings before upgrading");
        }

        const origin = getSiteOrigin().replace(/\/$/, "");
        const callbackUrl = `${origin}/app/billing?paystack=verify`;
        const session = await paystack.paystackInitializeTransaction({
          email,
          plan,
          callbackUrl,
          metadata: {
            dreyv_user_id: userId,
            wallet: ctx.walletAddress,
            tier: input.tier,
            source: "commandbar",
          },
        });
        checkoutUrl = session.authorization_url || null;
        checkoutReference = session.reference || null;
      } catch (err) {
        checkoutError = err instanceof Error ? err.message : String(err);
      }
    }

    const cryptoMessage = `${input.tier === "mini" ? "Mini" : "Max"} via crypto settles for $${cryptoUsd} in USDC, USDT, or SOL (10% off card price) — opens at /app/billing.`;
    const cardCheckoutMessage = checkoutUrl
      ? `One-click Paystack checkout ready for ${input.tier === "mini" ? "Mini" : "Max"} ($${usd}/mo). Open the link to finish payment — your tier flips automatically when Paystack confirms.`
      : null;
    const cardFallbackMessage = `Open /app/billing and click Upgrade to ${input.tier === "mini" ? "Mini" : "Max"} — Paystack will take it from there ($${usd}/mo).`;

    let message: string;
    if (input.method === "crypto") {
      message = cryptoMessage;
    } else if (input.method === "card") {
      message = cardCheckoutMessage ?? cardFallbackMessage;
    } else {
      message = checkoutUrl
        ? `${cardCheckoutMessage} Prefer crypto for 10% off? ${cryptoMessage}`
        : `Open /app/billing to upgrade to ${input.tier === "mini" ? "Mini" : "Max"}. You can pay $${usd}/mo by card (Paystack) or $${cryptoUsd}/cycle in crypto (USDC/USDT/SOL · 10% off).`;
    }

    // Preferred navigation target: the Paystack URL itself if we have it,
    // otherwise the billing page. The agent renders `navigate` as a CTA.
    const navigate = checkoutUrl ?? billingUrl;

    return {
      success: true,
      operation: "upgrade_subscription",
      tier: input.tier,
      method: input.method,
      url: navigate,
      navigate,
      checkoutUrl,
      checkoutReference,
      checkoutProvider: checkoutUrl ? "paystack" : null,
      checkoutError,
      fallbackUrl: billingUrl,
      message,
      pricing: {
        card: { usd, recurring: true, provider: "paystack" },
        crypto: { usd: Number(cryptoUsd), recurring: false, discountPct: 10, assets: ["usdc", "usdt", "sol"], chain: "solana" },
      },
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
