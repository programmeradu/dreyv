import type { Metadata } from "next";
import { HomePage } from "@/components/marketing/home/home-page";
import { HomeJsonLd } from "@/components/seo/JsonLd";

const title = "Solana treasury operations, simulated before anyone signs";
const description =
  "dreyv is a non-custodial treasury workspace for teams on Solana. Say what you want, see the simulated result, then sign in your Squads multisig. Free plan, no card.";
const ogTitle = "Know what you\u2019re signing. | dreyv";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: ogTitle,
    description,
    siteName: "dreyv",
    images: [
      {
        url: "/og/dreyv-og.png",
        width: 1200,
        height: 630,
        alt: "Know what you\u2019re signing. Three violet wax seals on paper, two pressed and one waiting.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: ogTitle,
    description,
    images: ["/og/dreyv-og.png"],
  },
};

export default function Home() {
  return (
    <>
      <HomeJsonLd />
      <HomePage />
    </>
  );
}
