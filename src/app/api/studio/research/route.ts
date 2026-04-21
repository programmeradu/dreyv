import { NextRequest, NextResponse } from "next/server";
import { checkRouteLimit } from "@/lib/rate-limit-middleware";
import { knowledgeMemory } from "@/lib/knowledge-memory";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Studio research route — given an unknown protocol, fetch docs via Firecrawl
 * (search + scrape) and SDK shape via Perplexity (sonar-pro). Persists to
 * the knowledgeEntries table with source: "studio_research".
 *
 * Both providers are optional — the route returns whatever it could gather.
 */
export async function POST(req: NextRequest) {
  const limit = await checkRouteLimit(req, "ai_architect_runs");
  if (!limit.success) {
    return NextResponse.json(
      { error: "Rate limited", retryAfter: limit.retryAfter },
      { status: 429 }
    );
  }

  let body: { protocol?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const protocol = (body.protocol || "").trim();
  const prompt = (body.prompt || "").trim();
  if (!protocol) {
    return NextResponse.json({ error: "Missing protocol" }, { status: 400 });
  }

  const sources: Array<{ url: string; source: "firecrawl" | "perplexity" | "lovable_ai" }> = [];
  let docsMarkdown = "";
  let sdkShape = "";

  // ─── Firecrawl: scrape protocol docs ──────────────────────────────
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    try {
      const searchRes = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `${protocol} solana sdk documentation api`,
          limit: 2,
          scrapeOptions: { formats: ["markdown"] },
        }),
      });
      if (searchRes.ok) {
        const sd = await searchRes.json();
        const results = sd?.data || sd?.web?.results || [];
        for (const r of results.slice(0, 2)) {
          const md = r.markdown || r.content || "";
          if (md) {
            docsMarkdown += `\n\n## From ${r.url || protocol}\n\n${md.slice(0, 4000)}`;
            sources.push({ url: r.url || "", source: "firecrawl" });
          }
        }
      }
    } catch (err) {
      console.warn("[research] firecrawl failed:", err);
    }
  }

  // ─── Perplexity: SDK shape + code examples (optional) ────────────
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (perplexityKey) {
    try {
      const ppRes = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${perplexityKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content:
                "You are a Solana SDK expert. Given a protocol name, return a concise markdown summary: (1) main JS/TS SDK package name, (2) 1-2 key TypeScript function signatures with imports, (3) one minimal usage example. No fluff.",
            },
            { role: "user", content: `Protocol: ${protocol}\nUser intent: ${prompt.slice(0, 300)}` },
          ],
          max_tokens: 600,
          temperature: 0.1,
        }),
      });
      if (ppRes.ok) {
        const pd = await ppRes.json();
        sdkShape = pd?.choices?.[0]?.message?.content || "";
        const citations: string[] = pd?.citations || [];
        for (const c of citations.slice(0, 3)) {
          sources.push({ url: c, source: "perplexity" });
        }
      }
    } catch (err) {
      console.warn("[research] perplexity failed:", err);
    }
  }

  // ─── Fallback: Lovable AI synthesis if no external sources ────────
  if (!docsMarkdown && !sdkShape) {
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (lovableKey) {
      try {
        const res = await fetch(LOVABLE_AI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content:
                  "You are a Solana SDK expert. Provide a concise markdown brief on the named protocol: SDK package, key TypeScript signatures, one short usage snippet. If you don't know, say so plainly — do not fabricate.",
              },
              { role: "user", content: `Protocol: ${protocol}\nIntent: ${prompt.slice(0, 300)}` },
            ],
            max_tokens: 600,
            temperature: 0.2,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          sdkShape = d?.choices?.[0]?.message?.content || "";
          if (sdkShape) sources.push({ url: "lovable-ai-gateway", source: "lovable_ai" });
        }
      } catch (err) {
        console.warn("[research] lovable_ai fallback failed:", err);
      }
    }
  }

  const combined = [docsMarkdown.trim(), sdkShape.trim()].filter(Boolean).join("\n\n---\n\n");

  // Persist to knowledge memory (best-effort)
  if (combined) {
    try {
      await knowledgeMemory.store({
        source: "studio_research",
        title: `Studio research: ${protocol}`,
        summary: sdkShape.slice(0, 500),
        content: combined,
        tags: ["studio", "research", protocol.toLowerCase()],
      });
    } catch (err) {
      console.warn("[research] persist failed (non-fatal):", err);
    }
  }

  return NextResponse.json({
    protocol,
    markdown: combined,
    sources,
    hasResearch: combined.length > 0,
  });
}
