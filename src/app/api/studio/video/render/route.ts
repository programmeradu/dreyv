/**
 * /api/studio/video/render
 *
 *   POST  { pack }       → creates a studio_video_jobs row, fires the
 *                          Inngest `studio.video.render.requested` event,
 *                          returns { jobId }.
 *   GET   ?id=<uuid>     → returns the row so the UI can poll progress
 *                          and surface the final mp4 url + per-shot urls.
 *
 * The actual fal.ai pipeline runs in `studioVideoRender` (Inngest) so this
 * route stays fast and never blows the Vercel 60s default.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = await requireTeamMember(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 });
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY missing — add it in project secrets." }, { status: 500 });
  }

  let body: { pack?: unknown };
  try {
    body = (await req.json()) as { pack?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pack = body.pack as {
    shotList?: Array<{ n: number; description: string; toolPrompt: string; recommendedTool: string }>;
  } | undefined;
  if (!pack || !Array.isArray(pack.shotList) || pack.shotList.length === 0) {
    return NextResponse.json({ error: "pack.shotList must be a non-empty array" }, { status: 400 });
  }
  if (pack.shotList.length > 5) {
    return NextResponse.json(
      { error: "Pack has more than 5 shots. Trim before rendering — Veo 3 Fast is billed per second." },
      { status: 400 },
    );
  }

  const inserted = (await db.execute(
    sql`INSERT INTO studio_video_jobs (status, pack, shots_total)
        VALUES ('queued', ${JSON.stringify(pack)}::jsonb, ${pack.shotList.length})
        RETURNING id`,
  )) as unknown;
  // drizzle .execute returns { rows } on neon-http; an array on pg
  const row =
    (inserted as { rows?: Array<{ id?: string }> }).rows?.[0] ??
    (Array.isArray(inserted) ? (inserted[0] as { id?: string } | undefined) : undefined);
  const jobId = row?.id;
  if (!jobId) return NextResponse.json({ error: "Failed to insert job" }, { status: 500 });

  const delivered = await publish({
    name: "studio.video.render.requested",
    data: { jobId, pack },
  });

  if (!delivered.delivered) {
    return NextResponse.json(
      {
        jobId,
        warning:
          `Job created but background worker is not linked (${delivered.reason}). ` +
          `Inngest needs INNGEST_API_KEY connector + /api/inngest registered.`,
      },
      { status: 202 },
    );
  }

  return NextResponse.json({ jobId });
}

export async function GET(req: NextRequest) {
  const auth = await requireTeamMember(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const result = (await db.execute(
    sql`SELECT id, status, shots_total, shots_done, shot_urls, final_url, duration_sec, error, created_at, updated_at
        FROM studio_video_jobs WHERE id = ${id}::uuid LIMIT 1`,
  )) as unknown;
  const row =
    (result as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
    (Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined);
  if (!row) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(row);
}
