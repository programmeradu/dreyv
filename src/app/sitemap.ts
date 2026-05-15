import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/seo/site";
import { ATLAS_TOKENS } from "@/lib/seo/atlas-tokens";
import { ATLAS_YIELD_ASSETS } from "@/lib/seo/atlas-yields";
import { ATLAS_PROTOCOLS } from "@/lib/seo/atlas-protocols";
import { GUIDES } from "@/lib/seo/guides";

/**
 * Public, indexable routes (aligned with robots.ts + middleware noindex rules).
 * Includes programmatic SEO surfaces:
 *   - /atlas/tokens/[symbol]  — one entry per supported token
 *   - /guides/[slug]          — one entry per long-form guide
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteOrigin();
  const lastModified = new Date();

  const corePaths: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[0]["changeFrequency"];
    priority: number;
  }> = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
    { path: "/atlas", changeFrequency: "weekly", priority: 0.9 },
    { path: "/atlas/tokens", changeFrequency: "weekly", priority: 0.85 },
    { path: "/atlas/methodology", changeFrequency: "monthly", priority: 0.7 },
    { path: "/atlas/strategy-lab", changeFrequency: "weekly", priority: 0.75 },
    { path: "/guides", changeFrequency: "weekly", priority: 0.85 },
    { path: "/waitlist", changeFrequency: "weekly", priority: 0.95 },
    { path: "/solana-treasury-tracker", changeFrequency: "weekly", priority: 0.9 },
    { path: "/solana-portfolio-tracker", changeFrequency: "weekly", priority: 0.9 },
    { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/cookies", changeFrequency: "yearly", priority: 0.2 },
    { path: "/legal/refunds", changeFrequency: "yearly", priority: 0.2 },
  ];

  const tokenPaths = ATLAS_TOKENS.map((t) => ({
    path: `/atlas/tokens/${t.symbol.toLowerCase()}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const yieldPaths = ATLAS_YIELD_ASSETS.map((a) => ({
    path: `/atlas/yields/${a.slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  const protocolPaths = ATLAS_PROTOCOLS.map((p) => ({
    path: `/atlas/protocols/${p.slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  const guidePaths = GUIDES.map((g) => ({
    path: `/guides/${g.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.75,
    lastModified: new Date(g.publishedAt),
  }));

  return [
    ...corePaths.map(({ path, changeFrequency, priority }) => ({
      url: `${base}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
    ...tokenPaths.map(({ path, changeFrequency, priority }) => ({
      url: `${base}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
    ...yieldPaths.map(({ path, changeFrequency, priority }) => ({
      url: `${base}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
    ...protocolPaths.map(({ path, changeFrequency, priority }) => ({
      url: `${base}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
    ...guidePaths.map(({ path, changeFrequency, priority, lastModified: lm }) => ({
      url: `${base}${path}`,
      lastModified: lm,
      changeFrequency,
      priority,
    })),
  ];
}
