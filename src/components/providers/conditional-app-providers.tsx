"use client";

import { ReactNode } from "react";
import { Web3Providers } from "@/components/providers/web3-provider";

export function ConditionalAppProviders({ children }: { children: ReactNode }) {
  return <Web3Providers>{children}</Web3Providers>;
}
