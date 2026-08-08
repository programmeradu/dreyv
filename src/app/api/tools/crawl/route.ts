export const runtime = "edge";
/**
 * Cloudflare Browser Rendering /crawl — async multi-page crawl.
 *
 * POST   /api/tools/crawl              → start a crawl job (returns jobId)
 * GET    /api/tools/crawl?jobId=...    → poll job status / paginate records
 *                                        Optional: cursor, limit, status
 * DELETE /api/tools/crawl?jobId=...    → cancel an in-progress job
 *
 * Crawls run for up to 7 days on CF; this route is fire-and-poll so the
 * Next request returns immediately. For "start + wait + persist to memory"
 * use `KnowledgeBase.crawlSite()` from a server action.
 */

import { NextRequest, NextResponse } from "next/server";
import {
    startCrawl,
    getCrawlStatus,
    cancelCrawl,
    type CrawlRecordStatus,
    type CrawlStartOptions,
} from "@/lib/cloudflare/cf-browser";


export const maxDuration = 60;

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as Partial<CrawlStartOptions>;
        if (!body?.url) {
            return NextResponse.json({ error: "'url' is required" }, { status: 400 });
        }
        const data = await startCrawl(body as CrawlStartOptions);
        return NextResponse.json({
            success: data.success,
            jobId: data.result,
            poll: `/api/tools/crawl?jobId=${data.result}&limit=1`,
        });
    } catch (error) {
        console.error("[CrawlAPI POST] Error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const jobId = searchParams.get("jobId");
        if (!jobId) {
            return NextResponse.json({ error: "'jobId' query param required" }, { status: 400 });
        }
        const cursor = searchParams.get("cursor");
        const limit = searchParams.get("limit");
        const status = searchParams.get("status") as CrawlRecordStatus | null;

        const data = await getCrawlStatus(jobId, {
            cursor: cursor ? Number(cursor) : undefined,
            limit: limit ? Number(limit) : undefined,
            status: status ?? undefined,
        });
        return NextResponse.json(data);
    } catch (error) {
        console.error("[CrawlAPI GET] Error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const jobId = searchParams.get("jobId");
        if (!jobId) {
            return NextResponse.json({ error: "'jobId' query param required" }, { status: 400 });
        }
        const data = await cancelCrawl(jobId);
        return NextResponse.json(data);
    } catch (error) {
        console.error("[CrawlAPI DELETE] Error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
