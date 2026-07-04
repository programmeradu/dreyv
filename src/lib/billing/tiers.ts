/**
 * Canonical tier definitions — the single source of truth for tier labels,
 * pricing, and feature lists surfaced anywhere in the product (Settings billing
 * panel, /app/billing page, /pricing marketing page).
 */

export type TierId = "free" | "mini" | "max";

export interface TierMeta {
  id: TierId;
  label: string;
  price: string;
  monthlyUsd: number;
  features: string[];
  /** Label for the upgrade CTA, or null if this is the top tier. */
  cta: string | null;
}

export const TIER_META: Record<TierId, TierMeta> = {
  free: {
    id: "free",
    label: "Base",
    price: "$0 / mo",
    monthlyUsd: 0,
    features: [
      "Up to 5 agent personas",
      "Marketplace publishing",
      "On-chain payments (Solana)",
      "Persistent notification history",
    ],
    cta: "Upgrade to Mini",
  },
  mini: {
    id: "mini",
    label: "Mini",
    price: "$49 / mo",
    monthlyUsd: 49,
    features: [
      "Up to 25 agent personas",
      "Priority MCP throughput",
      "Squads multisig escalation",
      "Webhook + Telegram + Slack",
    ],
    cta: "Upgrade to Max",
  },
  max: {
    id: "max",
    label: "Max",
    price: "$199 / mo",
    monthlyUsd: 199,
    features: [
      "Unlimited agent personas",
      "Dedicated specialist fabric",
      "Premium support SLA",
      "Early access to new capabilities",
    ],
    cta: null,
  },
};

export function tierMeta(tier: string | null | undefined): TierMeta {
  return TIER_META[(tier as TierId) ?? "free"] ?? TIER_META.free;
}
