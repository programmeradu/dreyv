/**
 * POST /api/studio/research — 4-gun MERGE pipeline (no fallback).
 *
 * Empirical routing (from 10-topic matrix on 2026-07-01):
 *   • Tavily     — discovery + 10-12k of clean snippets we now USE as a source.
 *   • Cloudflare — primary reader; wins on volume for docs/blogs/GitHub.
 *   • Jina       — best on GitHub READMEs / *.md / raw markdown.
 *   • Firecrawl  — best on JS-heavy SPAs where CF returns thin (<2k) content.
 *
 * Per URL: pick CF + ONE partner (by URL heuristic) → run in parallel →
 * merge unique paragraphs (dedup by 60-char prefix, prefer longer versions).
 * Tavily snippet digest is ALWAYS injected as an extra source.
 */

import { NextRequest, NextResponse } from "next/server";
import { TavilyClient, TavilySearchResult } from "@/lib/tavily";
import { JinaClient } from "@/lib/jina";
import { FirecrawlClient } from "@/lib/firecrawl";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";
import { lovableAi } from "@/lib/lovable-ai-proxy";
import { knowledgeMemory } from "@/lib/knowledge-memory";
export const runtime = "edge";

export const maxDuration = 60;

interface ScrapeChunk {
  url: string;
  provider: string;
  markdown: string;
}

function coerceString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.result === "string") return o.result;
    if (typeof o.markdown === "string") return o.markdown;
    if (typeof o.content === "string") return o.content;
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function stripChrome(md: string): string {
  if (!md) return "";
  return md
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^.*(skip to content|toggle navigation|cookie|subscribe to our newsletter|appearance settings|navigation menu|sign in|sign up|edit this page).*$/gim, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pick CF's partner reader based on URL shape (empirical, not fallback). */
function pickPartner(url: string): "jina" | "firecrawl" {
  const u = url.toLowerCase();
  // GitHub, raw markdown, npm — Jina wins
  if (u.includes("github.com") || u.includes("raw.githubusercontent") || u.endsWith(".md") || u.includes("npmjs.com")) {
    return "jina";
  }
  // Known JS-heavy SPAs where CF goes thin — Firecrawl wins
  if (u.includes("station.jup.ag") || u.includes("developers.metaplex") || u.includes("docs.dyno") || u.includes(".gitbook.io")) {
    return "firecrawl";
  }
  // Default: Jina (higher signal-to-noise on plain docs in the matrix)
  return "jina";
}

/** Merge multiple markdown blobs into one deduped chunk, keeping longer variants. */
function mergeMarkdown(sources: Array<{ provider: string; md: string }>): string {
  const seen = new Map<string, { text: string; provider: string }>();
  for (const { provider, md } of sources) {
    if (!md) continue;
    for (const para of md.split(/\n{2,}/)) {
      const trimmed = para.trim();
      if (trimmed.length < 40) continue;
      const key = trimmed.slice(0, 60).toLowerCase().replace(/\s+/g, " ");
      const prev = seen.get(key);
      if (!prev || trimmed.length > prev.text.length) {
        seen.set(key, { text: trimmed, provider });
      }
    }
  }
  return Array.from(seen.values()).map((v) => v.text).join("\n\n");
}

async function readOne(
  url: string,
  firecrawl: FirecrawlClient,
  jina: JinaClient
): Promise<ScrapeChunk> {
  const partner = pickPartner(url);
  const [cfRes, partnerRes] = await Promise.allSettled([
    cfMarkdown({ url }),
    partner === "jina" ? jina.readUrl(url) : firecrawl.scrape(url),
  ]);
  const cfMd = cfRes.status === "fulfilled" ? stripChrome(coerceString(cfRes.value)) : "";
  const partnerMd = partnerRes.status === "fulfilled" ? stripChrome(coerceString(partnerRes.value)) : "";

  // If CF came back very thin, promote partner + also grab the OTHER reader
  let extraMd = "";
  let extraProv = "";
  if (cfMd.length < 2000) {
    const other = partner === "jina" ? "firecrawl" : "jina";
    try {
      const r = other === "jina" ? await jina.readUrl(url) : await firecrawl.scrape(url);
      extraMd = stripChrome(coerceString(r));
      extraProv = other;
    } catch { /* noop */ }
  }

  const merged = mergeMarkdown([
    { provider: "cloudflare", md: cfMd },
    { provider: partner, md: partnerMd },
    ...(extraMd ? [{ provider: extraProv, md: extraMd }] : []),
  ]);

  const providers = [
    cfMd.length > 200 ? "cf" : "",
    partnerMd.length > 200 ? partner : "",
    extraMd.length > 200 ? extraProv : "",
  ].filter(Boolean).join("+");

  return { url, provider: providers || "none", markdown: merged };
}

function tavilyDigest(hits: TavilySearchResult[]): string {
  return hits.slice(0, 5)
    .map((h) => `### ${h.title}\n${h.url}\n${(h.content || "").slice(0, 1200)}`)
    .join("\n\n")
    .trim();
}

async function synthesize(protocol: string, prompt: string, chunks: ScrapeChunk[], tavilyBlob: string): Promise<string> {
  const parts: string[] = [];
  if (tavilyBlob) parts.push(`## Tavily digest (top hits)\n\n${tavilyBlob}`);
  for (const c of chunks) {
    if (c.markdown) parts.push(`## ${c.url}  [${c.provider}]\n\n${c.markdown.slice(0, 7000)}`);
  }
  const corpus = parts.join("\n\n---\n\n").slice(0, 28000);
  if (!corpus) return "";

  const sys = `You are a Solana SDK expert compiling a MERGED brief from multiple research sources. Combine complementary details across sources; do not discard information just because one source lacks it. Output a concise markdown brief on "${protocol}" with: (1) main JS/TS SDK package(s) with install command, (2) 2-3 real TypeScript signatures with imports, (3) one minimal end-to-end usage example, (4) gotchas. Cite package names verbatim from the notes. If a specific detail is not in the notes, omit it — never fabricate signatures.`;

  try {
    const out = await lovableAi({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Protocol: ${protocol}\nIntent: ${prompt.slice(0, 300)}\n\nMERGED NOTES:\n${corpus}` },
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
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const protocol = (body.protocol || "").trim();
  const prompt = (body.prompt || "").trim();
  if (!protocol) return NextResponse.json({ error: "Missing protocol" }, { status: 400 });

  const tavily = new TavilyClient(process.env.TAVILY_API_KEY || "");
  const firecrawl = new FirecrawlClient(process.env.FIRECRAWL_API_KEY || "");
  const jina = new JinaClient(process.env.JINA_API_KEY || "");

  const providersUsed: string[] = [];

  // 1. Tavily discovery + digest (always used as a source)
  let hits: TavilySearchResult[] = [];
  try {
    hits = await tavily.search(`${protocol} solana sdk documentation typescript`, "advanced");
    if (hits.length) providersUsed.push("tavily");
  } catch (err) { console.warn("[research] tavily failed:", err); }
  const tavBlob = tavilyDigest(hits);
  const urls = hits.slice(0, 3).map((h) => h.url).filter(Boolean);

  // 2. Per-URL merge: CF + role-picked partner (parallel)
  const results = await Promise.allSettled(urls.map((u) => readOne(u, firecrawl, jina)));
  const chunks: ScrapeChunk[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.markdown) {
      chunks.push(r.value);
      for (const p of r.value.provider.split("+")) if (p && !providersUsed.includes(p)) providersUsed.push(p);
    }
  }

  // 3. Synthesize
  const synthesized = await synthesize(protocol, prompt, chunks, tavBlob);
  if (synthesized) providersUsed.push("lovable-ai");

  const combined = synthesized ||
    (chunks.length
      ? `Research notes gathered but synthesis was unavailable. Raw sources:\n\n${chunks.map((c) => `- ${c.url} [${c.provider}]`).join("\n")}`
      : "");

  if (combined) {
    try {
      await knowledgeMemory.store({
        source: "studio_research",
        title: `Studio research: ${protocol}`,
        summary: combined.slice(0, 500),
        content: combined,
        tags: ["studio", "research", protocol.toLowerCase()],
      });
    } catch (err) { console.warn("[research] persist failed:", err); }
  }

  return NextResponse.json({
    protocol,
    markdown: combined,
    sources: chunks.map((c) => ({ url: c.url, source: c.provider })),
    providersUsed,
    hasResearch: combined.length > 0,
  });
}
