import type { Metadata } from "next";
import { AtlasShell } from "@/components/atlas/atlas-shell";
import { StrategyLabClient } from "@/components/atlas/strategy-lab-client";

export const metadata: Metadata = {
  title: "Strategy Lab - dreyv atlas",
  description: "Simulate and execute Solana DeFi strategies with Dreyv Atlas Strategy Lab.",
};

export default function StrategyLabPage() {
  return (
    <AtlasShell activeSection="strategy-lab">
      <StrategyLabClient />
    </AtlasShell>
  );
}
