"use client";

/**
 * Reusable "Fund with card" button — opens the Stripe-hosted crypto onramp
 * in a new tab with the destination asset/network/amount prefilled.
 *
 * Hidden when NEXT_PUBLIC_STRIPE_ONRAMP_ENABLED !== "true" so it stays dark
 * until the Stripe onramp account is approved.
 */

import { useCallback, useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  buildOnrampUrl,
  buildOnrampUrlServer,
  isOnrampEnabled,
  type BuildOnrampUrlParams,
} from "@/lib/onramp/stripe";
import { cn } from "@/lib/utils";

interface OnrampButtonProps extends BuildOnrampUrlParams {
  label?: string;
  className?: string;
  variant?: "primary" | "ghost";
}

export function OnrampButton({
  label = "Fund with card",
  className,
  variant = "primary",
  ...params
}: OnrampButtonProps) {
  const enabled = isOnrampEnabled();
  const fallbackUrl = useMemo(() => buildOnrampUrlServer(params), [params]);

  const handleClick = useCallback(() => {
    if (!enabled) return;
    const url = buildOnrampUrl(params) ?? fallbackUrl;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [enabled, params, fallbackUrl]);

  if (!enabled) return null;

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-violet-600 text-white hover:bg-violet-700"
      : "border border-violet-200 bg-white text-violet-700 hover:bg-violet-50";

  return (
    <button type="button" onClick={handleClick} className={cn(base, styles, className)}>
      {label}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </button>
  );
}
