"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Web3Providers } from "@/components/providers/web3-provider";

export function ConditionalAppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const skipWeb3 = pathname === "/admin/migrations" || pathname?.startsWith("/admin/migrations/");

  if (skipWeb3) {
    return <>{children}</>;
  }

  return <Web3Providers>{children}</Web3Providers>;
}