/**
 * POST /api/studio/research — Unified 4-gun research pipeline.
 *
 * Flow:
 *   1. Tavily          → discover top URLs for the query.
 *   2. Firecrawl + Jina (parallel) → scrape the top sources to markdown.
 *   3. Cloudflare Browser Rendering → fallback for JS-heavy pages when both
 *      Firecrawl and Jina return thin content.
 *   4. Lovable AI (Gemini) → synthesize a signal-dense SDK brief.
 *
 * Persists the merged brief to knowledgeEntries as "studio_research".
 * Never invents; if every provider is unavailable it says so plainly.
 */

import { NextRequest, NextResponse } from "next/server";
import { TavilyClient } from "@/lib/tavily";
import { JinaClient } from "@/lib/jina";
import { FirecrawlClient } from "@/lib/firecrawl";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";
import { lovableAi } from "@/lib/lovable-ai-proxy";
import { knowledgeMemory } from "@/lib/knowledge-memory";

export const maxDuration = 60;

// Lovable AI is routed via the Supabase `lovable-ai-proxy` edge function; see src/lib/lovable-ai-proxy.ts
const THIN = 400; // chars — below this we consider a scrape "thin" and fall back

interface ScrapeChunk {
  url: string;
  provider: "firecrawl" | "jina" | "cf-browser";
  markdown: string;
}

function stripChrome(md: string): string {
  if (!md) return "";
  return md
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^.*(skip to content|toggle navigation|cookie|subscribe to our newsletter|appearance settings|navigation menu).*$/gim, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function scrapeOne(url: string, firecrawl: FirecrawlClient, jina: JinaClient): Promise<ScrapeChunk> {
  const [fc, jn] = await Promise.allSettled([firecrawl.scrape(url), jina.readUrl(url)]);
  const fcMd = fc.status === "fulfilled" ? stripChrome(fc.value) : "";
  const jnMd = jn.status === "fulfilled" ? stripChrome(jn.value) : "";
  // Prefer the longer of the two — different providers win on different sites
  const winner = fcMd.length >= jnMd.length
    ? { provider: "firecrawl" as const, markdown: fcMd }
    : { provider: "jina" as const, markdown: jnMd };

  if (winner.markdown.length >= THIN) return { url, ...winner };

  // Fallback: CF Browser Rendering for JS-heavy pages
  try {
    const cf = stripChrome(await cfMarkdown({ url }));
    if (cf.length > winner.markdown.length) return { url, provider: "cf-browser", markdown: cf };
  } catch (err) {
    console.warn("[research] CF fallback failed for", url, err);
  }
  return { url, ...winner };
}

async function synthesize(protocol: string, prompt: string, chunks: ScrapeChunk[]): Promise<string> {
  if (!chunks.length) return "";

  const corpus = chunks
    .map((c) => `## Source (${c.provider}): ${c.url}\n\n${c.markdown.slice(0, 4000)}`)
    .join("\n\n---\n\n")
    .slice(0, 14000);

  const sys = `You are a Solana SDK expert. From the research notes below, write a concise markdown brief on "${protocol}" covering: (1) main JS/TS SDK package(s), (2) 2-3 key TypeScript function signatures with imports, (3) one minimal usage example, (4) any gotchas. If notes are insufficient, say so plainly — never fabricate signatures or package names.`;

  try {
    const out = await lovableAi({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Protocol: ${protocol}\nIntent: ${prompt.slice(0, 300)}\n\nNOTES:\n${corpus}` },
      ],
      temperature: 0.15,
      timeoutMs: 45_000,
    });
    return typeof out === "string" ? out.trim() : "";
  } catch (err) {
    console.warn("[research] synth error:", err);
    return "";
  }
}

export async function POST(req: NextRequest) {
  let body: { protocol?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const protocol = (body.protocol || "").trim();
  const prompt = (body.prompt || "").trim();
  if (!protocol) return NextResponse.json({ error: "Missing protocol" }, { status: 400 });

  const tavilyKey = process.env.TAVILY_API_KEY || "";
  const firecrawlKey = process.env.FIRECRAWL_API_KEY || "";
  const jinaKey = process.env.JINA_API_KEY || "";

  const tavily = new TavilyClient(tavilyKey);
  const firecrawl = new FirecrawlClient(firecrawlKey);
  const jina = new JinaClient(jinaKey);

  // 1. Discovery
  const providersUsed: string[] = [];
  let discovered: Array<{ url: string; title: string }> = [];
  if (tavilyKey) {
    try {
      const hits = await tavily.search(`${protocol} solana sdk documentation typescript`, "advanced");
      discovered = hits.slice(0, 3).map((h) => ({ url: h.url, title: h.title }));
      if (discovered.length) providersUsed.push("tavily");
    } catch (err) {
      console.warn("[research] tavily failed:", err);
    }
  }

  // If Tavily gave us nothing, try Firecrawl's own search as a discovery fallback
  if (!discovered.length && firecrawlKey) {
    try {
      const r = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${protocol} solana sdk documentation`, limit: 3 }),
      });
      if (r.ok) {
        const d = await r.json();
        const results = d?.data || d?.web?.results || [];
        discovered = results
          .slice(0, 3)
          .map((x: Record<string, unknown>) => ({ url: String(x.url || ""), title: String(x.title || protocol) }))
          .filter((x: { url: string }) => x.url);
        if (discovered.length) providersUsed.push("firecrawl-search");
      }
    } catch (err) {
      console.warn("[research] firecrawl search failed:", err);
    }
  }

  // 2 + 3. Scrape (Firecrawl+Jina in parallel, CF fallback) for each URL
  const chunks: ScrapeChunk[] = [];
  if (discovered.length && (firecrawlKey || jinaKey)) {
    const results = await Promise.allSettled(
      discovered.map((d) => scrapeOne(d.url, firecrawl, jina))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.markdown) {
        chunks.push(r.value);
        if (!providersUsed.includes(r.value.provider)) providersUsed.push(r.value.provider);
      }
    }
  }

  // 4. Synthesis
  const synthesized = await synthesize(protocol, prompt, chunks);
  if (synthesized) providersUsed.push("lovable-ai");

  const combined = synthesized ||
    (chunks.length
      ? `Research notes gathered but synthesis was unavailable. Raw sources:\n\n${chunks.map((c) => `- ${c.url}`).join("\n")}`
      : "");

  // Persist (best-effort)
  if (combined) {
    try {
      await knowledgeMemory.store({
        source: "studio_research",
        title: `Studio research: ${protocol}`,
        summary: combined.slice(0, 500),
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
    sources: chunks.map((c) => ({ url: c.url, source: c.provider })),
    providersUsed,
    hasResearch: combined.length > 0,
  });
}
