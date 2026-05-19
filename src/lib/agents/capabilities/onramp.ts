/**
 * Stripe Crypto Onramp capability — fund a wallet with fiat via Stripe's
 * hosted onramp (crypto.link.com). Non-custodial: Stripe handles fiat + KYC,
 * crypto lands directly in the user's connected wallet.
 *
 * Returns a redirect URL the agent can render as a one-click button. When
 * NEXT_PUBLIC_STRIPE_ONRAMP_ENABLED is off, returns a soft-disabled response
 * so the agent says "fiat onramp isn't enabled yet" instead of breaking.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { buildOnrampUrlServer, isOnrampEnabled, type OnrampAsset, type OnrampNetwork } from "@/lib/onramp/stripe";

const onramp_fiat_to_crypto = defineCapability({
  id: "onramp_fiat_to_crypto",
  domain: "payments",
  description:
    "Buy crypto with fiat (USD/EUR) via Stripe's hosted onramp and deliver it directly to the user's connected wallet. Use whenever the user says 'fund my wallet', 'buy USDC with card', 'top up SOL for gas', 'I need more stables', or before a paid action when the wallet balance is too low. Non-custodial — Dreyv never touches fiat. Returns a one-click redirect URL pre-populated with destination asset, network, and amount.",
  inputSchema: z.object({
    asset: z
      .enum(["usdc", "usdt", "sol", "eth", "btc", "matic", "pol", "avax", "xlm"])
      .optional()
      .default("usdc")
      .describe("Crypto asset to receive. Defaults to USDC."),
    network: z
      .enum(["solana", "ethereum", "base", "polygon", "bitcoin", "avalanche", "stellar"])
      .optional()
      .default("solana")
      .describe("Destination network. Defaults to Solana."),
    sourceAmount: z
      .string()
      .optional()
      .describe("Suggested fiat amount in USD (numeric string, e.g. '100')."),
    sourceCurrency: z.enum(["usd", "eur"]).optional().default("usd"),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "low",
  supportedChains: ["solana", "evm"],
  execute: async (input, ctx) => {
    if (!isOnrampEnabled()) {
      return {
        success: false,
        operation: "onramp_fiat_to_crypto",
        message:
          "Fiat onramp isn't enabled on this Dreyv environment yet. Once the Stripe onramp account is approved we'll surface a one-click 'Fund with card' button here.",
      };
    }

    const url = buildOnrampUrlServer({
      asset: input.asset as OnrampAsset,
      network: input.network as OnrampNetwork,
      sourceAmount: input.sourceAmount,
      sourceCurrency: input.sourceCurrency,
    });

    const amountPart = input.sourceAmount ? `~$${input.sourceAmount} of ` : "";
    const locked = Boolean(ctx.walletAddress);
    const message = locked
      ? `Opening Stripe Onramp in-app to buy ${amountPart}${input.asset.toUpperCase()} on ${input.network}. Wallet locked to your connected address — Stripe cannot redirect funds elsewhere. Dreyv never touches the fiat.`
      : `Fiat onramp ready: buy ${amountPart}${input.asset.toUpperCase()} on ${input.network} via Stripe. Open the link, complete KYC + card payment, and the ${input.asset.toUpperCase()} drops straight into the wallet you specify at Stripe.`;

    return {
      success: true,
      operation: "onramp_fiat_to_crypto",
      url,
      navigate: locked ? "drawer:onramp" : url,
      drawer: locked
        ? {
            kind: "onramp",
            walletAddress: ctx.walletAddress,
            walletNetwork: input.network,
            asset: input.asset,
            sourceAmount: input.sourceAmount ?? null,
            sourceCurrency: input.sourceCurrency,
          }
        : undefined,
      provider: "stripe",
      asset: input.asset,
      network: input.network,
      sourceAmount: input.sourceAmount ?? null,
      walletAddress: ctx.walletAddress ?? null,
      message,
    };
  },
});

export const onrampCapabilities: AnyCapability[] = [onramp_fiat_to_crypto];
