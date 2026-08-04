"use client";

import { ReactNode } from "react";
import dynamic from "next/dynamic";

const Web3Providers = dynamic(
  () => import("@/components/providers/web3-provider").then((mod) => mod.Web3Providers),
  { ssr: false }
);

export function ConditionalAppProviders({ children }: { children: ReactNode }) {
  return <Web3Providers>{children}</Web3Providers>;
}
