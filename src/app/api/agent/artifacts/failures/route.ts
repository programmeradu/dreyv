export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { artifactFailures } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/artifacts/failures?ownerKey=...&commandId=...
 *
 * Lists recent artifact-pipeline failures for a given owner/command so the
 * UI can render "retry PDF" actions. The actual re-render is performed by
 * the originating capability (we don't have the source data here) — the UI
 * dispatches the appropriate command again.
 */
export async function GET(request: NextRequest) {
    if (!db) return NextResponse.json({ failures: [] });
    const ownerKey = request.nextUrl.searchParams.get("ownerKey");
    const commandId = request.nextUrl.searchParams.get("commandId");
    if (!ownerKey) {
        return NextResponse.json({ error: "ownerKey required" }, { status: 400 });
    }
    try {
        const where = commandId
            ? and(eq(artifactFailures.ownerKey, ownerKey), eq(artifactFailures.commandId, commandId))
            : eq(artifactFailures.ownerKey, ownerKey);
        const rows = await db
            .select()
            .from(artifactFailures)
            .where(where)
            .orderBy(desc(artifactFailures.createdAt))
            .limit(50);
        return NextResponse.json({ failures: rows });
    } catch (err) {
        console.error("[artifacts/failures] error:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "unknown" },
            { status: 500 },
        );
    }
}
