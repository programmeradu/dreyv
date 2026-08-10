import { TavilyClient } from "@/lib/tavily";
import { JinaClient } from "@/lib/jina";
import { FirecrawlClient } from "@/lib/firecrawl";
import { knowledgeMemory } from "@/lib/knowledge-memory";
import {
    startCrawl,
    waitForCrawl,
    type CrawlStartOptions,
    type CrawlRecord,
} from "@/lib/cloudflare/cf-browser";

export interface KnowledgeResult {
    query: string;
    summary: string;
    sources: Array<{ title: string; url: string }>;
    rawContent: string;
}

export interface CrawlSiteResult {
    rootUrl: string;
    jobId: string;
    status: string;
    pagesCollected: number;
    records: CrawlRecord[];
    rawContent: string;
}

export class KnowledgeBase {
    private tavily: TavilyClient;
    private jina: JinaClient;
    private firecrawl: FirecrawlClient;

    constructor() {
        const tavilyKey = process.env.TAVILY_API_KEY || "";
        const jinaKey = process.env.JINA_API_KEY || "";
        const firecrawlKey = process.env.FIRECRAWL_API_KEY || "";
        this.tavily = new TavilyClient(tavilyKey);
        this.jina = new JinaClient(jinaKey);
        this.firecrawl = new FirecrawlClient(firecrawlKey);
    }

    /**
     * Conducts deep research on a topic:
     * 1. Searches for documentation via Tavily
     * 2. Reads the top source via Jina
     * 3. Reads the secondary source via Firecrawl for multi-vector accuracy
     * 4. Returns consolidated intelligence
     */
    async study(topic: string): Promise<KnowledgeResult> {
        // 1. Search for deep documentation
        const searchResults = await this.tavily.search(`${topic} technical documentation SDK code examples`, "advanced");

        if (!searchResults.length) {
            return { query: topic, summary: "No intelligence found in current sector.", sources: [], rawContent: "" };
        }

        const topSources = searchResults.slice(0, 3);

        // 2. Multi-Vector Scraping
        // We use Jina for the primary and Firecrawl for the secondary to cross-reference
        const [primaryContent, secondaryContent] = await Promise.all([
            this.jina.readUrl(topSources[0].url),
            topSources[1] ? this.firecrawl.scrape(topSources[1].url) : Promise.resolve("")
        ]);

        const consolidatedIntelligence = `
SOURCE_A (JINA): ${topSources[0].url}
---
${primaryContent}

${topSources[1] ? `
SOURCE_B (FIRECRAWL): ${topSources[1].url}
---
${secondaryContent}
` : ""}
        `.trim();

        const result: KnowledgeResult = {
            query: topic,
            summary: searchResults[0].content, // Executive summary from Tavily
            sources: topSources.map(s => ({ title: s.title, url: s.url })),
            rawContent: consolidatedIntelligence.slice(0, 15000) // Support larger context for multi-source
        };

        // Persist to Knowledge Memory for future recall
        try {
            await knowledgeMemory.store({
                source: "kb_study",
                sourceUrl: topSources[0].url,
                title: `Research: ${topic}`,
                summary: result.summary?.slice(0, 500),
                content: result.rawContent,
                contentType: "markdown",
                tags: ["kb_study", topic.split(" ")[0]?.toLowerCase()].filter(Boolean),
            });
        } catch (memErr) {
            console.warn("[KnowledgeBase] Failed to persist study to memory:", memErr);
        }

        return result;
    }

    /**
     * Multi-page crawl via Cloudflare Browser Rendering /crawl.
     * Starts the job, polls until terminal, paginates records, and stores
     * each page in knowledgeMemory for GraphRAG-style recall.
     *
     * Defaults are tuned for docs sites: render=false, markdown format,
     * limit 25, depth 3, same-domain only.
     */
    async crawlSite(
        rootUrl: string,
        opts: Partial<CrawlStartOptions> & {
            tags?: string[];
            maxAttempts?: number;
            delayMs?: number;
            persist?: boolean;
        } = {}
    ): Promise<CrawlSiteResult> {
        const startOpts: CrawlStartOptions = {
            url: rootUrl,
            limit: opts.limit ?? 25,
            depth: opts.depth ?? 3,
            formats: opts.formats ?? ["markdown"],
            render: opts.render ?? false,
            source: opts.source ?? "all",
            crawlPurposes: opts.crawlPurposes ?? ["search", "ai-input"],
            options: opts.options,
            maxAge: opts.maxAge,
            modifiedSince: opts.modifiedSince,
            jsonOptions: opts.jsonOptions,
        };

        const { result: jobId } = await startCrawl(startOpts);
        console.log(`[KnowledgeBase] CF /crawl started job=${jobId} root=${rootUrl}`);

        const job = await waitForCrawl(jobId, {
            maxAttempts: opts.maxAttempts ?? 60,
            delayMs: opts.delayMs ?? 5000,
        });

        const records = job.records ?? [];
        const rawContent = records
            .filter((r) => r.markdown || r.html)
            .map(
                (r) =>
                    `### ${r.metadata?.title || r.url}\n` +
                    `URL: ${r.url}\n\n${r.markdown ?? r.html ?? ""}`
            )
            .join("\n\n---\n\n");

        // Persist each successful page individually so embeddings/recall work per-URL
        if (opts.persist !== false) {
            const tags = ["cf_crawl", ...(opts.tags ?? [])];
            await Promise.allSettled(
                records
                    .filter((r) => r.status === "completed" && (r.markdown || r.html))
                    .map((r) =>
                        knowledgeMemory.store({
                            source: "cf_crawl",
                            sourceUrl: r.url,
                            title: r.metadata?.title || r.url,
                            summary: (r.markdown ?? r.html ?? "").slice(0, 500),
                            content: r.markdown ?? r.html ?? "",
                            contentType: r.markdown ? "markdown" : "html",
                            tags,
                        })
                    )
            );
        }

        return {
            rootUrl,
            jobId,
            status: job.status,
            pagesCollected: records.filter((r) => r.status === "completed").length,
            records,
            rawContent: rawContent.slice(0, 60000),
        };
    }
}

export const knowledgeBase = new KnowledgeBase();
