/**
 * Shared OG card template — premium light Stitch-style.
 * Brand: solid violet-600 (#7c3aed) only, no gradients on brand colors.
 * Surfaces use white → violet-50 ambient wash + violet-400/300 glows.
 *
 * Used by every `opengraph-image.tsx` route via `renderOgCard()`.
 *
 * DISABLED: OG image generation disabled to reduce Cloudflare Worker bundle size
 */
// import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export type OgCardInput = {
  /** Small uppercase tag at the top — e.g. "Pricing", "Compare", "For developers". */
  eyebrow?: string;
  /** Main headline (keep ≤ 70 chars for legibility). */
  headline: string;
  /** Supporting line under headline (≤ 140 chars). */
  subline?: string;
  /** Bottom proof chips, max 3. */
  chips?: string[];
  /** Absolute URL to the crystal asset (resolved by caller from request origin). */
  crystalUrl?: string;
};

export function renderOgCard(input: OgCardInput): Response {
  // DISABLED: Return placeholder response to avoid @vercel/og dependency
  return new Response("OG image generation disabled for Cloudflare Workers", {
    status: 503,
    headers: { "Content-Type": "text/plain" }
  });
}

/** Resolve absolute URL to /brand/og-crystal.png from the deployment origin. */
export function resolveCrystalUrl(): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://dreyv.com";
  return `${env.replace(/\/$/, "")}/brand/og-crystal.png`;
}
