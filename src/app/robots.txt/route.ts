import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * robots.txt with Content Signals (contentsignals.org / draft-romm-aipref-contentsignals).
 *
 * Declares dreyv's preferences for how automated crawlers may use this content:
 *  - search   = yes  → indexing in traditional search engines is welcome
 *  - ai-input = yes  → live agent retrieval (RAG, "answer my question now") welcome
 *  - ai-train = no   → do NOT use to train foundation models without a license
 */
export function GET() {
    const origin = getSiteOrigin();

    const body = `# dreyv — robots.txt
# Content Signals: https://contentsignals.org/
Content-Signal: search=yes, ai-input=yes, ai-train=no

User-agent: *
Allow: /
Disallow: /app/
Disallow: /app
Disallow: /api/
Disallow: /auth
Disallow: /auth/
Disallow: /mobile/
Disallow: /github-cleanup
Disallow: /hello
Disallow: /working-swap

Sitemap: ${origin}/sitemap.xml
Host: ${new URL(origin).host}
`;

    return new NextResponse(body, {
        status: 200,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
        },
    });
}
