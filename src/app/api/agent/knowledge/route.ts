import { NextRequest, NextResponse } from "next/server";
import { knowledgeBase } from "@/lib/knowledge";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";

export const maxDuration = 60;

const URL_RE = /https?:\/\/[^\s)]+/gi;

// Heuristic doc roots for protocols we know about — used when Tavily comes up empty.
const PROTOCOL_DOC_ROOTS: Record<string, string> = {
    jupiter: "https://station.jup.ag/docs",
    helius: "https://docs.helius.dev/",
    marinade: "https://docs.marinade.finance/",
    streamflow: "https://docs.streamflow.finance/",
    squads: "https://docs.squads.so/",
    raydium: "https://docs.raydium.io/",
    orca: "https://docs.orca.so/",
    drift: "https://docs.drift.trade/",
    kamino: "https://docs.kamino.finance/",
    meteora: "https://docs.meteora.ag/",
    pyth: "https://docs.pyth.network/",
    switchboard: "https://docs.switchboard.xyz/",
    solana: "https://solana.com/docs",
    anchor: "https://www.anchor-lang.com/docs",
    metaplex: "https://developers.metaplex.com/",
};

function findDocRoots(query: string): string[] {
    const lower = query.toLowerCase();
    const hits: string[] = [];
    for (const [name, url] of Object.entries(PROTOCOL_DOC_ROOTS)) {
        if (lower.includes(name)) hits.push(url);
    }
    return hits;
}

export async function POST(req: NextRequest) {
    try {
        const { query } = await req.json();
        if (!query) {
            return NextResponse.json({ error: "Query required" }, { status: 400 });
        }

        // 1. Primary: Tavily + Jina + Firecrawl multi-vector
        const result = await knowledgeBase.study(query);

        // 2. Augment with Cloudflare browser for any URLs in the prompt
        const urlsInQuery = Array.from(new Set((query.match(URL_RE) ?? []) as string[])).slice(0, 3);

        // 3. Fallback: if Tavily came up empty, try CF on inferred protocol doc roots
        const needsFallback = result.sources.length === 0 && !urlsInQuery.length;
        const fallbackUrls = needsFallback ? findDocRoots(query).slice(0, 2) : [];

        const cfTargets = [...urlsInQuery, ...fallbackUrls];
        if (cfTargets.length > 0) {
            const cfResults = await Promise.allSettled(
                cfTargets.map((url) => cfMarkdown({ url }).then((md) => ({ url, md })))
            );

            const cfChunks: string[] = [];
            const cfSources: Array<{ title: string; url: string }> = [];
            for (const r of cfResults) {
                if (r.status === "fulfilled" && r.value.md) {
                    cfChunks.push(`### CF /markdown — ${r.value.url}\n\n${r.value.md.slice(0, 6000)}`);
                    cfSources.push({ title: new URL(r.value.url).hostname, url: r.value.url });
                }
            }

            if (cfChunks.length > 0) {
                return NextResponse.json({
                    query,
                    summary:
                        result.summary && result.sources.length
                            ? result.summary
                            : `Researched ${cfSources.length} live source${cfSources.length === 1 ? "" : "s"} via Cloudflare browser.`,
                    sources: [...result.sources, ...cfSources],
                    rawContent: [result.rawContent, cfChunks.join("\n\n---\n\n")]
                        .filter(Boolean)
                        .join("\n\n---\n\n")
                        .slice(0, 20000),
                });
            }
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("[KnowledgeAPI] Error:", error);
        return NextResponse.json({ error: "Failed to conduct research" }, { status: 500 });
    }
}
