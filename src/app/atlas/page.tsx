import type { Metadata } from "next";
import { Suspense } from "react";
import { SolanaProviders } from "@/components/providers/solana-provider";
import { AtlasClient } from "@/components/atlas/atlas-client";

const atlasTitle = "dreyv atlas";
const atlasDescription =
  "dreyv atlas: Solana intelligence cockpit with transparent risk signals, workflow guidance, and execution-ready context.";

export const metadata: Metadata = {
  title: atlasTitle,
  description: atlasDescription,
  alternates: { canonical: "/atlas" },
  openGraph: {
    type: "website",
    url: "/atlas",
    title: `${atlasTitle} | Solana intelligence cockpit`,
    description: atlasDescription,
    siteName: "dreyv",
  },
  twitter: {
    card: "summary_large_image",
    title: `${atlasTitle} | Solana intelligence cockpit`,
    description: atlasDescription,
  },
};

export const dynamic = "force-dynamic";

export const runtime = "edge";
export default function SolanaAtlasPage() {
  return <AtlasClient />;
}
