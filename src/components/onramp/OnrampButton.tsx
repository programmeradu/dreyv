"use client";

/**
 * Reusable "Fund with card" button.
 *
 * Default: opens the in-app <OnrampDrawer /> which mints a server-side Stripe
 * Crypto Onramp session (locked to the user's wallet when provided) and
 * embeds the session via crypto-onramp-outer.js.
 *
 * `mode="redirect"` keeps the legacy new-tab Standalone flow for surfaces
 * that can't host the drawer (e.g. agent chat link cards).
 *
 * Hidden when NEXT_PUBLIC_STRIPE_ONRAMP_ENABLED !== "true".
 */

import { useCallback, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  buildOnrampUrl,
  buildOnrampUrlServer,
  isOnrampEnabled,
  type BuildOnrampUrlParams,
} from "@/lib/onramp/stripe";
import { cn } from "@/lib/utils";
import { OnrampDrawer } from "./OnrampDrawer";

interface OnrampButtonProps extends BuildOnrampUrlParams {
  label?: string;
  className?: string;
  variant?: "primary" | "ghost";
  /** "drawer" (default) mints a session in-app; "redirect" opens a new tab. */
  mode?: "drawer" | "redirect";
  walletAddress?: string;
  walletNetwork?: string;
}

export function OnrampButton({
  label = "Fund with card",
  className,
  variant = "primary",
  mode = "drawer",
  walletAddress,
  walletNetwork,
  ...params
}: OnrampButtonProps) {
  const enabled = isOnrampEnabled();
  const [open, setOpen] = useState(false);
  const fallbackUrl = useMemo(() => buildOnrampUrlServer(params), [params]);

  const handleClick = useCallback(() => {
    if (!enabled) return;
    if (mode === "drawer") {
      setOpen(true);
      return;
    }
    const url = buildOnrampUrl(params) ?? fallbackUrl;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [enabled, mode, params, fallbackUrl]);

  if (!enabled) return null;

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-violet-600 text-white hover:bg-violet-700"
      : "border border-violet-200 bg-white text-violet-700 hover:bg-violet-50";

  const newTabUrl = buildOnrampUrl(params) ?? fallbackUrl;

  return (
    <>
      <div className="inline-flex flex-col items-start gap-1">
        <button type="button" onClick={handleClick} className={cn(base, styles, className)}>
          {label}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        {mode === "drawer" && (
          <a
            href={newTabUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-violet-600 hover:text-violet-700 hover:underline"
          >
            or open in a new tab →
          </a>
        )}
      </div>
      {mode === "drawer" && (
        <OnrampDrawer
          open={open}
          onClose={() => setOpen(false)}
          walletAddress={walletAddress}
          walletNetwork={walletNetwork ?? params.network}
          {...params}
        />
      )}
    </>
  );
}
