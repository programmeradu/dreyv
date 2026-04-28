"use client";

import { ReactNode } from "react";
import { PhantomCompatProvider } from "@/lib/wallet/compat";
import { NetworkProvider } from "@/lib/contexts/NetworkContext";

/**
 * Legacy Solana-only provider used by /atlas routes.
 * Phase 12 Track B: now backed by Phantom React SDK + compat shim.
 * The compat layer's `useConnection()` derives endpoint from NetworkContext,
 * which already picks up `NEXT_PUBLIC_SOLANA_RPC` and the proxy fallback.
 */
export function SolanaProviders({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <PhantomCompatProvider appName="Dreyv">{children}</PhantomCompatProvider>
    </NetworkProvider>
  );
}
