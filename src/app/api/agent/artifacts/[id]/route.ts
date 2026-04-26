import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentArtifacts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 7A — Signed download endpoint for agent-generated artifacts.
 *
 *   GET /api/agent/artifacts/:id?t=<jwt>&inline=1
 *
 * The JWT is short-lived (issued by uploadArtifact). Token mismatch / expiry /
 * missing artifact => 403 / 404. By default the file is served as an
 * attachment; pass `inline=1` to display in-browser (e.g. PDF preview).
 */
function getSecret(): Uint8Array {
    const s = process.env.ARTIFACT_SIGNING_SECRET || process.env.JWT_SECRET;
    if (!s) throw new Error("ARTIFACT_SIGNING_SECRET (or JWT_SECRET) must be configured");
    return new TextEncoder().encode(s);
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const token = request.nextUrl.searchParams.get("t");
        if (!token) return NextResponse.json({ error: "missing token" }, { status: 401 });

        let payload: { aid?: string };
        try {
            const verified = await jwtVerify(token, getSecret(), {
                issuer: "dreyv-artifacts",
                audience: "dreyv-artifact-download",
            });
            payload = verified.payload as { aid?: string };
        } catch {
            return NextResponse.json({ error: "invalid or expired token" }, { status: 403 });
        }

        if (payload.aid !== id) {
            return NextResponse.json({ error: "token/artifact mismatch" }, { status: 403 });
        }

        if (!db) return NextResponse.json({ error: "db unavailable" }, { status: 503 });

        const [row] = await db
            .select()
            .from(agentArtifacts)
            .where(eq(agentArtifacts.id, id))
            .limit(1);

        if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

        if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
            return NextResponse.json({ error: "artifact expired" }, { status: 410 });
        }

        const inline = request.nextUrl.searchParams.get("inline") === "1";
        const disposition = inline
            ? `inline; filename="${row.filename}"`
            : `attachment; filename="${row.filename}"`;

        const body = Buffer.isBuffer(row.body) ? row.body : Buffer.from(row.body as Uint8Array);
        return new NextResponse(new Uint8Array(body), {
            status: 200,
            headers: {
                "Content-Type": row.mime,
                "Content-Length": String(row.bytes),
                "Content-Disposition": disposition,
                "Cache-Control": "private, max-age=300",
            },
        });
    } catch (err) {
        console.error("[artifacts/:id] error:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "unknown" },
            { status: 500 },
        );
    }
}
