"use client";

import { ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, polygon, bsc } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import "@coinbase/onchainkit/styles.css";
// RainbowKit
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { LiveblocksProvider } from "@liveblocks/react";
// Phantom React SDK (Phase 12 Track B — replaces @solana/wallet-adapter-*)
import { PhantomCompatProvider } from "@/lib/wallet/compat";
import { VaultProvider } from "@/lib/contexts/VaultContext";
import { NetworkProvider } from "@/lib/contexts/NetworkContext";

const chains = [mainnet, base, arbitrum, polygon, bsc] as const;
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const fallbackConfig = createConfig({
  chains,
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
  },
});

const rainbowConfig = projectId
  ? getDefaultConfig({
      appName: "Dreyv",
      projectId,
      chains,
      ssr: true,
    })
  : fallbackConfig;

const queryClient = new QueryClient();

const rkTheme = lightTheme({
  accentColor: "var(--primary)",
  accentColorForeground: "var(--primary-foreground)",
  borderRadius: "small",
  overlayBlur: "small",
});

export function Web3Providers({ children }: { children: ReactNode }) {
  const apiKey = process.env.NEXT_PUBLIC_CDP_API_KEY;

  return (
    <NetworkProvider>
      <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
        <PhantomCompatProvider appName="Dreyv">
          <VaultProvider>
            <WagmiProvider config={rainbowConfig}>
              <QueryClientProvider client={queryClient}>
                {projectId ? (
                  <RainbowKitProvider theme={rkTheme} modalSize="compact">
                    {apiKey ? (
                      <OnchainKitProvider apiKey={apiKey} chain={base}>
                        {children}
                      </OnchainKitProvider>
                    ) : (
                      children
                    )}
                  </RainbowKitProvider>
                ) : apiKey ? (
                  <OnchainKitProvider apiKey={apiKey} chain={base}>
                    {children}
                  </OnchainKitProvider>
                ) : (
                  <>{children}</>
                )}
              </QueryClientProvider>
            </WagmiProvider>
          </VaultProvider>
        </PhantomCompatProvider>
      </LiveblocksProvider>
    </NetworkProvider>
  );
}
