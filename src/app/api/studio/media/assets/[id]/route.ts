export const runtime = "edge";
/**
 * DELETE /api/studio/media/assets/[id]
 * Removes an asset row owned by the current team member. Does NOT delete
 * the underlying R2 object yet — left for a periodic GC job.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { db } from "@/db";
import { mediaStudioAssets } from "@/db/schema";
import { and, eq } from "drizzle-orm";


export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  const { id } = await ctx.params;
  const deleted = await db
    .delete(mediaStudioAssets)
    .where(and(eq(mediaStudioAssets.id, id), eq(mediaStudioAssets.userId, gate.user.id)))
    .returning({ id: mediaStudioAssets.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
