/**
 * /v/[address]/opengraph-image — dynamic share card.
 *
 * Fetches the feature pack server-side and renders a violet
 * Stitch-aligned OG card with archetype, address, net worth, and a
 * single-sentence preview of the AI narrative when available.
 *
 * DISABLED: OG image generation disabled to reduce Cloudflare Worker bundle size
 */
// import { ImageResponse } from "next/og";
import { getSiteOrigin } from "@/lib/seo/site";

export const runtime = "nodejs";
export const alt = "Dreyv smart wallet explorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fmtUsd = (n: number) =>
    Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
    : Math.abs(n) >= 1_000 ? `$${(n / 1_000).toFixed(1)}k`
    : `$${(n || 0).toFixed(2)}`;

async function safeJson<T>(url: string): Promise<T | null> {
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        return (await r.json()) as T;
    } catch {
        return null;
    }
}

export default async function OG({ params }: { params: { address: string } }) {
    // DISABLED: Return placeholder image to avoid @vercel/og dependency
    // OG image generation disabled to reduce Cloudflare Worker bundle size
    return new Response("OG image generation disabled for Cloudflare Workers", {
        status: 503,
        headers: { "Content-Type": "text/plain" }
    });
}
