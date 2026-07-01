/**
 * GET/POST /api/studio/research/debug?topic=...
 *
 * Runs each of the 4 research "guns" INDIVIDUALLY against the same topic,
 * then runs the collective pipeline (CF-first) and returns all outputs
 * side-by-side. Protected by DEV_RESEARCH_TOKEN (via middleware bypass).
 *
 * Providers:
 *   1. Tavily     — semantic search / URL discovery
 *   2. Jina       — reader (markdown scrape) on top Tavily URL
 *   3. Firecrawl  — reader (markdown scrape) on top Tavily URL
 *   4. Cloudflare — browser rendering /markdown on top Tavily URL
 *   Collective   — CF-first pipeline + Lovable AI synthesis
 */

import { NextRequest, NextResponse } from "next/server";
import { TavilyClient } from "@/lib/tavily";
import { JinaClient } from "@/lib/jina";
import { FirecrawlClient } from "@/lib/firecrawl";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";
import { lovableAi } from "@/lib/lovable-ai-proxy";

export const maxDuration = 60;

type GunResult = {
  provider: string;
  ok: boolean;
  ms: number;
  chars: number;
  preview: string;
  error?: string;
};

async function time<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  } catch (e) {
    return { value: null, ms: Date.now() - t0, error: (e as Error)?.message || String(e) };
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "").trim() || "Jupiter swap SDK on Solana";
  return safeRun(topic);
}

export async function GET(req: NextRequest) {
  const topic = req.nextUrl.searchParams.get("topic")?.trim() || "Jupiter swap SDK on Solana";
  return safeRun(topic);
}

async function safeRun(topic: string) {
  try {
    return await runDebug(topic);
  } catch (e) {
    return NextResponse.json({
      topic,
      fatal: true,
      error: (e as Error)?.message || String(e),
      stack: (e as Error)?.stack?.split("\n").slice(0, 8).join("\n"),
      env: {
        TAVILY: !!process.env.TAVILY_API_KEY,
        JINA: !!process.env.JINA_API_KEY,
        FIRECRAWL: !!process.env.FIRECRAWL_API_KEY,
        CF_TOKEN: !!process.env.CLOUDFLARE_API_TOKEN,
        CF_ACCOUNT: !!process.env.CLOUDFLARE_ACCOUNT_ID,
        LOVABLE_PROXY: !!process.env.LOVABLE_AI_PROXY_URL || !!process.env.LOVABLE_SUPABASE_URL,
        LOVABLE_ANON: !!process.env.LOVABLE_SUPABASE_ANON_KEY,
      },
    }, { status: 200 });
  }
}

async function runDebug(topic: string) {
  const tavily = new TavilyClient(process.env.TAVILY_API_KEY || "");
  const jina = new JinaClient(process.env.JINA_API_KEY || "");
  const firecrawl = new FirecrawlClient(process.env.FIRECRAWL_API_KEY || "");

  // 1. Tavily individual
  const tav = await time(() => tavily.search(`${topic} documentation typescript`, "advanced"));
  const tavilyResult: GunResult = {
    provider: "tavily",
    ok: !!(tav.value && tav.value.length),
    ms: tav.ms,
    chars: tav.value ? JSON.stringify(tav.value).length : 0,
    preview: tav.value
      ? tav.value.slice(0, 3).map((r) => `• ${r.title} — ${r.url}`).join("\n")
      : "",
    error: tav.error,
  };

  const topUrl = tav.value?.[0]?.url || "";

  // 2, 3, 4 individual — hit the same URL with each scraper
  const [jn, fc, cf] = await Promise.all([
    topUrl ? time(() => jina.readUrl(topUrl)) : Promise.resolve({ value: "" as string, ms: 0, error: "no url" }),
    topUrl ? time(() => firecrawl.scrape(topUrl)) : Promise.resolve({ value: "" as string, ms: 0, error: "no url" }),
    topUrl ? time(() => cfMarkdown({ url: topUrl })) : Promise.resolve({ value: "" as string, ms: 0, error: "no url" }),
  ]);

  const jinaResult: GunResult = {
    provider: "jina",
    ok: !!(jn.value && jn.value.length > 200),
    ms: jn.ms,
    chars: jn.value?.length || 0,
    preview: (jn.value || "").slice(0, 400),
    error: jn.error,
  };
  const firecrawlResult: GunResult = {
    provider: "firecrawl",
    ok: !!(fc.value && fc.value.length > 200),
    ms: fc.ms,
    chars: fc.value?.length || 0,
    preview: (fc.value || "").slice(0, 400),
    error: fc.error,
  };
  const cfResult: GunResult = {
    provider: "cloudflare-browser",
    ok: !!(cf.value && cf.value.length > 200),
    ms: cf.ms,
    chars: cf.value?.length || 0,
    preview: (cf.value || "").slice(0, 400),
    error: cf.error,
  };

  // Collective — CF-first pipeline (per user preference): CF as primary reader,
  // Firecrawl+Jina as fallbacks, Tavily for discovery, Lovable AI for synthesis.
  const t0 = Date.now();
  const collectiveSources: Array<{ url: string; provider: string; chars: number }> = [];
  const collectiveChunks: string[] = [];

  const urls = (tav.value || []).slice(0, 2).map((r) => r.url);
  await Promise.all(urls.map(async (url) => {
    let md = "";
    let provider = "cloudflare-browser";
    try { md = (await cfMarkdown({ url })) || ""; } catch { md = ""; }
    if (md.length < 400) {
      const [f, j] = await Promise.allSettled([firecrawl.scrape(url), jina.readUrl(url)]);
      const fMd = f.status === "fulfilled" ? f.value : "";
      const jMd = j.status === "fulfilled" ? j.value : "";
      if (fMd.length > md.length) { md = fMd; provider = "firecrawl"; }
      if (jMd.length > md.length) { md = jMd; provider = "jina"; }
    }
    if (md) {
      collectiveSources.push({ url, provider, chars: md.length });
      collectiveChunks.push(`## Source (${provider}): ${url}\n\n${md.slice(0, 4000)}`);
    }
  }));

  let synth: unknown = null;
  let synthError: string | undefined;
  try {
    synth = await lovableAi({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `You are a Solana SDK expert. From the research notes below, write a concise markdown brief on "${topic}" covering: main SDK packages, key TypeScript signatures with imports, one minimal usage example, and any gotchas. If notes are insufficient, say so plainly — never fabricate.` },
        { role: "user", content: `Topic: ${topic}\n\nNOTES:\n${collectiveChunks.join("\n\n---\n\n").slice(0, 14000)}` },
      ],
      temperature: 0.15,
      timeoutMs: 30_000,
    });
  } catch (e) {
    synthError = (e as Error)?.message || String(e);
  }
  const collectiveMs = Date.now() - t0;

  return NextResponse.json({
    topic,
    individual: {
      tavily: tavilyResult,
      jina: jinaResult,
      firecrawl: firecrawlResult,
      cloudflare: cfResult,
    },
    collective: {
      ms: collectiveMs,
      strategy: "CF-first → Firecrawl fallback → Jina fallback → Lovable AI synthesis",
      sources: collectiveSources,
      synthesisOk: typeof synth === "string" && synth.length > 100,
      synthesisChars: typeof synth === "string" ? synth.length : 0,
      synthesis: typeof synth === "string" ? synth : null,
      synthError,
    },
  });
}
