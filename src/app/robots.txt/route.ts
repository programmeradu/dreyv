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

# Default policy — search + live agent retrieval welcome, training disallowed.
User-agent: *
Allow: /
# Explicitly allow agent-discovery endpoints even though /api/ is otherwise blocked.
Allow: /api/mcp$
Allow: /api/mcp/manifest
Allow: /api/llms.txt
Allow: /api/health
Allow: /api/price
Allow: /api/atlas/
Disallow: /app/
Disallow: /app
Disallow: /api/
Disallow: /auth
Disallow: /auth/
Disallow: /mobile/
Disallow: /github-cleanup
Disallow: /hello
Disallow: /working-swap
# WebMCP internal endpoints — not for crawlers.
Disallow: /_webmcp/

# Search-focused crawlers — full access to public pages.
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: DuckDuckBot
Allow: /

# Live AI assistants (RAG / answer-the-question-now) — welcome.
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /
User-agent: Claude-User
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: Google-Extended
Allow: /

# Foundation-model training crawlers — disallowed (no license granted).
User-agent: GPTBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: anthropic-ai
Disallow: /
User-agent: CCBot
Disallow: /
User-agent: Bytespider
Disallow: /
User-agent: Amazonbot
Disallow: /
User-agent: Applebot-Extended
Disallow: /
User-agent: Meta-ExternalAgent
Disallow: /
User-agent: cohere-ai
Disallow: /

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
