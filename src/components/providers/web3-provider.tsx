"use client";

import { ReactNode, useEffect } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, polygon, bsc } from "viem/chains";
import dynamic from "next/dynamic";
const OnchainKitProvider = dynamic(() => import("@coinbase/onchainkit").then(mod => mod.OnchainKitProvider), { ssr: false });
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// OnchainKitProvider will be dynamically imported above

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
  useEffect(() => {
    if (apiKey) {
      import("@coinbase/onchainkit/styles.css");
    }
  }, [apiKey]);

  // RainbowKit's ConnectButton / transaction hooks require RainbowKitProvider on
  // every route — not only when WalletConnect projectId is set (local dev often omits it).
  const inner: ReactNode = apiKey ? (
    <OnchainKitProvider apiKey={apiKey} chain={base}>
      <VaultProvider>{children}</VaultProvider>
    </OnchainKitProvider>
  ) : (
    <VaultProvider>{children}</VaultProvider>
  );

  return (
    <NetworkProvider>
      <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
        <PhantomCompatProvider appName="Dreyv">
          <WagmiProvider config={rainbowConfig}>
            <QueryClientProvider client={queryClient}>
              <RainbowKitProvider theme={rkTheme} modalSize="compact">
                {inner}
              </RainbowKitProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </PhantomCompatProvider>
      </LiveblocksProvider>
    </NetworkProvider>
  );
}
