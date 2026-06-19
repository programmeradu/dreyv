// Replace with a minimal Server Component that renders the client subcomponent
import type { Metadata } from "next";
import { HomeClient } from "@/components/home/home-client";
import { HomeJsonLd } from "@/components/seo/JsonLd";

const title = "AI Treasury Operating System for Web3";
const description =
  "Non-custodial treasury workspace: natural-language intent, simulation before you sign, Solana-native intelligence.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: `${title} | dreyv`,
    description,
    siteName: "dreyv",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} | dreyv`,
    description,
  },
};

export default function Home() {
  return (
    <>
      <HomeJsonLd />
      <HomeClient />
    </>
  );
}
