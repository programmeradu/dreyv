import type { Metadata, Viewport } from "next";
import "./globals.css";
import VisualEditsMessenger from "../visual-edits/VisualEditsMessenger";
import ErrorReporter from "@/components/ErrorReporter";
import Script from "next/script";
import { ConditionalAppProviders } from "@/components/providers/conditional-app-providers";
import { ToastContainer } from "@/components/ToastContainer";
import { CookieBanner } from "@/components/CookieBanner";
import { WebMCPProvider } from "@/components/agent/WebMCPProvider";
import { RootJsonLd } from "@/components/seo/JsonLd";
import { getSiteUrl } from "@/lib/seo/site";
const siteUrl = getSiteUrl();
const siteOrigin = siteUrl.origin;

const titleDefault = "dreyv | Solana treasury operations, simulated before anyone signs";
const description =
  "Non-custodial treasury workspace for Solana DAOs and protocols. Plain-language intent, simulation before anyone signs, multisig-native with Squads.";

export const viewport: Viewport = {
  themeColor: "#efebe2",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: titleDefault,
    template: "%s | dreyv",
  },
  description,
  applicationName: "dreyv",
  keywords: [
    "dreyv",
    "dreyv.com",
    "dreyv atlas",
    "AI powered treasury",
    "AI treasury Web3",
    "Web3 treasury",
    "DAO treasury",
    "Solana treasury",
    "DeFi treasury management",
    "AI treasury",
    "non-custodial treasury",
    "treasury simulation",
    "crypto treasury operations",
    "intent-driven treasury",
  ],
  authors: [{ name: "dreyv", url: "https://dreyv.com" }],
  creator: "dreyv",
  publisher: "dreyv",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    languages: {
      "en-US": "/",
      "x-default": "/",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteOrigin,
    siteName: "dreyv",
    title: titleDefault,
    description,
    images: [
      {
        url: new URL("/og/dreyv-og.jpg", siteUrl).toString(),
        width: 1200,
        height: 630,
        alt: "Know what you\u2019re signing. Three violet wax seals on paper, two pressed and one waiting.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: titleDefault,
    description,
    images: [new URL("/og/dreyv-og.jpg", siteUrl).toString()],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? {
        verification: {
          google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
        },
      }
    : {}),
};

const gtmId = process.env.NEXT_PUBLIC_GTM_ID ?? "GTM-KNKWW6MC";

const gtmScript = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');`;

/** GA4 property for dreyv (Google Analytics). If you also send the same ID from GTM, disable one to avoid double page_view. */
const gaMeasurementId =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "G-FYR5RC3HK9";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="google-tag-manager" strategy="beforeInteractive">
          {gtmScript}
        </Script>
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
            height={0}
            width={0}
            style={{ display: "none", visibility: "hidden" }}
            title="Google Tag Manager"
          />
        </noscript>
        <RootJsonLd />
        <ErrorReporter />
        <Script
          src="https://plugin.jup.ag/plugin-v1.js"
          strategy="afterInteractive"
        />
        {process.env.NEXT_PUBLIC_STRIPE_ONRAMP_ENABLED === "true" && (
          <>
            <Script src="https://js.stripe.com/dahlia/stripe.js" strategy="afterInteractive" />
            <Script src="https://crypto-js.stripe.com/crypto-onramp-outer.js" strategy="afterInteractive" />
          </>
        )}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics-ga4" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${gaMeasurementId}');
          `}
        </Script>
        <ConditionalAppProviders>{children}</ConditionalAppProviders>
        <WebMCPProvider />
        <VisualEditsMessenger />
        <ToastContainer />
        <CookieBanner />
      </body>
    </html>
  );
}
