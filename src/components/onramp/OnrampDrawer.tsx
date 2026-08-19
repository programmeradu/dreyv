"use client";

/**
 * In-app Stripe Crypto Onramp drawer — replaces the new-tab redirect with an
 * embedded onramp session rendered inside Dreyv via crypto-onramp-outer.js.
 *
 * Flow:
 *   1. Call the `stripe-onramp-session` edge function with destination + (when
 *      available) the user's connected wallet → receive a clientSecret.
 *   2. Mount `StripeOnramp.OnrampSession({ clientSecret })` into a flat
 *      violet-bordered card.
 *   3. Listen for `onramp_session_updated` to toast + refresh balances.
 *
 * Falls back to a Standalone redirect when the edge function is unreachable
 * (e.g. STRIPE_SECRET_KEY not yet configured).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { buildOnrampUrl, buildOnrampUrlServer, type BuildOnrampUrlParams } from "@/lib/onramp/stripe";
import { cn } from "@/lib/utils";
import { useVault } from "@/lib/contexts/VaultContext";
import { toast } from "@/lib/toast-notifications";



interface OnrampDrawerProps extends BuildOnrampUrlParams {
  open: boolean;
  onClose: () => void;
  /** Wallet to lock onramp delivery to. When set, user cannot edit. */
  walletAddress?: string;
  /** Network for the locked wallet (e.g. "solana"). */
  walletNetwork?: string;
  onCompleted?: (session: { id: string; status: string }) => void;
}

export function OnrampDrawer({
  open,
  onClose,
  walletAddress,
  walletNetwork,
  onCompleted,
  ...params
}: OnrampDrawerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const { refresh } = useVault();
  const sessionRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const mintSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFallbackUrl(null);
    try {
      const resp = await fetch("/api/stripe/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: walletAddress ?? undefined,
          network: walletNetwork ?? params.network,
          asset: params.asset,
          sourceAmount: params.sourceAmount,
          destinationAmount: params.destinationAmount,
          sourceCurrency: params.sourceCurrency ?? "usd",
          destinationCurrencies: params.destinationCurrencies,
          destinationNetworks: params.destinationNetworks,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Session request failed (${resp.status})`);
      if (!data?.clientSecret) throw new Error(data?.error || "No client secret returned");

      const StripeOnramp = (window as unknown as { StripeOnramp?: unknown })
        .StripeOnramp as any;
      if (!StripeOnramp) throw new Error("Stripe Onramp SDK not loaded");
      const onramp = typeof StripeOnramp === "function" ? StripeOnramp() : StripeOnramp;
      const session = onramp.createSession({ clientSecret: data.clientSecret });
      session.mount(mountRef.current);
      session.addEventListener("onramp_session_updated", (event: any) => {
        const status = event?.payload?.session?.status;
        if (status === "fulfillment_complete") {
          toast.success("Funds delivered", {
            description: `${(params.asset ?? "USDC").toString().toUpperCase()} landed in your wallet. Refreshing balances…`,
          });
          // Stripe settles seconds after this event — kick a refresh now and
          // again 8s later to catch on-chain confirmation.
          refresh().catch(() => undefined);
          setTimeout(() => refresh().catch(() => undefined), 8000);
          onCompleted?.({ id: data.id, status });
        } else if (status === "rejected") {
          toast.error("Onramp session rejected", {
            description: "Stripe was unable to complete this purchase.",
          });
          onCompleted?.({ id: data.id, status });
        }
      });
      sessionRef.current = session;
    } catch (err: any) {
      console.error("[OnrampDrawer] mint failed, falling back to redirect", err);
      setError(err?.message ?? "Failed to start onramp session");
      const url = buildOnrampUrl(params) ?? buildOnrampUrlServer(params);
      setFallbackUrl(url);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, walletNetwork, params, onCompleted, refresh]);

  useEffect(() => {
    if (!open) return;
    mintSession();
    return () => {
      try {
        sessionRef.current?.unmount?.();
      } catch {
        /* noop */
      }
      sessionRef.current = null;
    };
  }, [open, mintSession]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-violet-950/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full max-w-md rounded-t-3xl border border-violet-200 bg-white p-6 sm:rounded-3xl",
          "shadow-[0_-12px_40px_-20px_rgba(124,58,237,0.35)]",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-violet-600">
              Fund with card
            </p>
            <h2 className="mt-1 text-lg font-semibold text-violet-950">
              {params.asset?.toUpperCase() ?? "USDC"} → {walletNetwork ?? params.network ?? "Solana"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-violet-700 hover:bg-violet-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && (
          <p className="py-8 text-center text-sm text-violet-700">
            Preparing your Stripe session…
          </p>
        )}

        <div ref={mountRef} className="min-h-[480px]" />

        {error && fallbackUrl && (
          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 text-sm text-violet-900">
            <p className="font-medium">Embedded onramp unavailable</p>
            <p className="mt-1 text-violet-700">{error}</p>
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Continue at Stripe →
            </a>
          </div>
        )}

        {walletAddress && (
          <p className="mt-4 text-[11px] text-violet-500">
            Crypto will be delivered to your connected wallet
            {walletNetwork ? ` on ${walletNetwork}` : ""}. Wallet locked — Stripe
            cannot redirect funds elsewhere.
          </p>
        )}
      </div>
    </div>
  );
}
