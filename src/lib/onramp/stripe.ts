/**
 * Stripe Crypto Onramp — frontend-only "Standalone" redirect URL helper.
 *
 * This is the no-account, no-secret flavor: we build a redirect URL via the
 * Stripe Onramp JS SDK (loaded globally in app/layout.tsx) and either open it
 * in a new tab or return it for the agent to surface as a clickable link.
 *
 * When `NEXT_PUBLIC_STRIPE_ONRAMP_ENABLED !== "true"` the helper returns null
 * so callers can hide the CTA cleanly. Upgrade path: replace `buildOnrampUrl`
 * with a server-minted session that can `lock_wallet_address` to the user's
 * connected wallet, once a Stripe account is approved for onramp.
 *
 * Docs: https://docs.stripe.com/crypto/onramp/standalone
 */

export type OnrampAsset =
  | "usdc"
  | "usdt"
  | "sol"
  | "eth"
  | "btc"
  | "matic"
  | "pol"
  | "avax"
  | "xlm";

export type OnrampNetwork =
  | "solana"
  | "ethereum"
  | "base"
  | "polygon"
  | "bitcoin"
  | "avalanche"
  | "stellar";

export interface BuildOnrampUrlParams {
  /** Default destination asset (e.g. "usdc"). */
  asset?: OnrampAsset;
  /** Default destination network (e.g. "solana"). */
  network?: OnrampNetwork;
  /** Suggested fiat amount in USD (numeric string, e.g. "100"). */
  sourceAmount?: string;
  /** Suggested crypto amount (mutually exclusive with sourceAmount). */
  destinationAmount?: string;
  /** Fiat currency. Defaults to "usd". */
  sourceCurrency?: "usd" | "eur";
  /** Restrict picker to these assets. */
  destinationCurrencies?: OnrampAsset[];
  /** Restrict picker to these networks. */
  destinationNetworks?: OnrampNetwork[];
}

export function isOnrampEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ONRAMP_ENABLED === "true";
}

declare global {
  interface Window {
    StripeOnramp?: {
      Standalone: (params: Record<string, unknown>) => { getUrl: () => string };
    };
  }
}

/**
 * Build a Stripe-hosted onramp redirect URL on the client. Returns null when
 * the SDK hasn't loaded yet or the flag is off — callers should fall back to
 * disabling the CTA in that case.
 */
export function buildOnrampUrl(params: BuildOnrampUrlParams): string | null {
  if (!isOnrampEnabled()) return null;
  if (typeof window === "undefined" || !window.StripeOnramp) return null;

  const payload: Record<string, unknown> = {
    source_currency: params.sourceCurrency ?? "usd",
  };
  if (params.sourceAmount) {
    payload.amount = { source_amount: params.sourceAmount };
  } else if (params.destinationAmount) {
    payload.amount = { destination_amount: params.destinationAmount };
  }
  if (params.destinationCurrencies?.length) {
    payload.destination_currencies = params.destinationCurrencies;
  }
  if (params.destinationNetworks?.length) {
    payload.destination_networks = params.destinationNetworks;
  }
  if (params.asset) payload.destination_currency = params.asset;
  if (params.network) payload.destination_network = params.network;

  try {
    const standalone = window.StripeOnramp.Standalone(payload);
    return standalone.getUrl();
  } catch {
    return null;
  }
}

/**
 * Server-safe URL builder fallback. Used by the agent capability so it can
 * return a real link even when running on the server (no window.StripeOnramp).
 *
 * Mirrors the query-param shape of crypto.link.com so users land on the same
 * surface with the same prefilled fields. Stripe accepts arbitrary unknown
 * params without breaking.
 */
export function buildOnrampUrlServer(params: BuildOnrampUrlParams): string {
  const qs = new URLSearchParams();
  qs.set("source_currency", params.sourceCurrency ?? "usd");
  if (params.sourceAmount) qs.set("source_amount", params.sourceAmount);
  if (params.destinationAmount) qs.set("destination_amount", params.destinationAmount);
  if (params.asset) qs.set("destination_currency", params.asset);
  if (params.network) qs.set("destination_network", params.network);
  if (params.destinationCurrencies?.length) {
    qs.set("destination_currencies", params.destinationCurrencies.join(","));
  }
  if (params.destinationNetworks?.length) {
    qs.set("destination_networks", params.destinationNetworks.join(","));
  }
  return `https://crypto.link.com/?${qs.toString()}`;
}
