"use client";

import { useState } from "react";

// Curated map of well-known stack logos to their canonical domain (used for favicon lookup).
const KNOWN_DOMAINS: Record<string, string> = {
  pyth: "pyth.network",
  "pyth oracles": "pyth.network",
  coingecko: "coingecko.com",
  jupiter: "jup.ag",
  helius: "helius.dev",
  solana: "solana.com",
  anchor: "anchor-lang.com",
  marinade: "marinade.finance",
  resend: "resend.com",
  stripe: "stripe.com",
  paddle: "paddle.com",
  fastspring: "fastspring.com",
  supabase: "supabase.com",
  "lovable cloud": "supabase.com",
  vercel: "vercel.com",
  cloudflare: "cloudflare.com",
  openai: "openai.com",
  groq: "groq.com",
  google: "google.com",
  gemini: "ai.google.dev",
  "google gemini": "ai.google.dev",
  perplexity: "perplexity.ai",
  firecrawl: "firecrawl.dev",
  tavily: "tavily.com",
  twilio: "twilio.com",
  slack: "slack.com",
  twitter: "x.com",
  x: "x.com",
  telegram: "telegram.org",
  discord: "discord.com",
  github: "github.com",
  linear: "linear.app",
  notion: "notion.so",
  airtable: "airtable.com",
  "google sheets": "sheets.google.com",
  resendemail: "resend.com",
  squads: "squads.so",
  turnkey: "turnkey.com",
  rainbow: "rainbow.me",
  rainbowkit: "rainbowkit.com",
  wagmi: "wagmi.sh",
  ethereum: "ethereum.org",
  uniswap: "uniswap.org",
  base: "base.org",
  arbitrum: "arbitrum.io",
  optimism: "optimism.io",
  polygon: "polygon.technology",
  chainlink: "chain.link",
  streamflow: "streamflow.finance",
  paypal: "paypal.com",
  plaid: "plaid.com",
};

function domainFromDocs(docsUrl?: string): string | null {
  if (!docsUrl) return null;
  try {
    return new URL(docsUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function resolveDomain(name: string, docsUrl?: string): string | null {
  const key = name.trim().toLowerCase();
  if (KNOWN_DOMAINS[key]) return KNOWN_DOMAINS[key];
  // try first word
  const first = key.split(/\s+/)[0];
  if (KNOWN_DOMAINS[first]) return KNOWN_DOMAINS[first];
  return domainFromDocs(docsUrl);
}

export function IntegrationLogo({ name, docsUrl }: { name: string; docsUrl?: string }) {
  const domain = resolveDomain(name, docsUrl);
  const [errored, setErrored] = useState(false);

  if (!domain || errored) return null;

  return (
    <div className="shrink-0 w-9 h-9 rounded-md border border-border bg-white flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt={`${name} logo`}
        className="w-6 h-6 object-contain"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
