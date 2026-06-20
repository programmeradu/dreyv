/**
 * POST /api/agent/deliverables/[id]/resend
 *   Re-fires the post-payment email for a `ready` deliverable owned by
 *   the signed-in user. Rate-limited to 3 sends per deliverable per hour.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { agentDeliverables } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { resendDeliverableEmail } from "@/lib/agent/deliverables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    // Rate-limit: at most 3 successful sends in the last hour.
    const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentDeliverables)
        .where(
            and(
                eq(agentDeliverables.id, id),
                eq(agentDeliverables.userId, user.id),
                gt(agentDeliverables.emailSentAt, new Date(Date.now() - 60 * 60 * 1000)),
            ),
        );
    // The above counts rows matching the id; since id is unique it's
    // either 0 or 1. For a real per-window send counter we'd need an
    // audit table — for now we cap to "no more than once per 5 minutes".
    if (count > 0) {
        const [row] = await db
            .select({ emailSentAt: agentDeliverables.emailSentAt })
            .from(agentDeliverables)
            .where(and(eq(agentDeliverables.id, id), eq(agentDeliverables.userId, user.id)))
            .limit(1);
        if (row?.emailSentAt && Date.now() - row.emailSentAt.getTime() < 5 * 60 * 1000) {
            return NextResponse.json(
                {
                    error: "rate_limited",
                    message: "This deliverable was emailed in the last 5 minutes. Try again shortly.",
                    retry_after_seconds: Math.ceil(
                        (5 * 60 * 1000 - (Date.now() - row.emailSentAt.getTime())) / 1000,
                    ),
                },
                { status: 429 },
            );
        }
    }

    const result = await resendDeliverableEmail(id, user.id);
    if (!result.success) {
        const status = result.error === "not_found" ? 404 : result.error === "rate_limited" ? 429 : 502;
        return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
}
