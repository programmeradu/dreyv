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
  try {
    return await handlePost(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[studio/video/render] POST failed:", err);
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

async function handlePost(req: NextRequest) {
  const auth = await requireTeamMember(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 });
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY missing — add it in project secrets." }, { status: 500 });
  }

  let body: { pack?: unknown; provider?: unknown };
  try {
    body = (await req.json()) as { pack?: unknown; provider?: unknown };
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

  // Provider selection — defaults to fal Veo 3 Fast (best quality, native audio).
  const ALLOWED = ["veo3-fal", "veo3-google", "veo3-vertex", "wan22-fal"] as const;
  type Provider = (typeof ALLOWED)[number];
  const provider: Provider = (ALLOWED as readonly string[]).includes(String(body.provider))
    ? (body.provider as Provider)
    : "veo3-fal";

  // Per-provider secret guard — fail fast with a clear message.
  if ((provider === "veo3-fal" || provider === "wan22-fal") && !process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY missing — add it in project secrets." }, { status: 500 });
  }
  if (provider === "veo3-google" && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY missing." }, { status: 500 });
  }
  if (provider === "veo3-vertex" && !process.env.GCP_VERTEX_API_KEY && !process.env.VERTEX_API_KEY && !process.env.GCP_SERVICE_ACCOUNT_JSON) {
    return NextResponse.json(
      { error: "Vertex auth missing — set GCP_VERTEX_API_KEY (Express-mode API key, simplest) or GCP_SERVICE_ACCOUNT_JSON." },
      { status: 500 },
    );
  }
  // ffmpeg compose step still runs on fal regardless of shot provider.
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY missing (required for stitching step)." }, { status: 500 });
  }

  const modelLabel =
    provider === "veo3-vertex" ? "google/veo-3.1-generate-001 (vertex)" :
    provider === "veo3-google" ? "google/veo-3.0-generate-001" :
    provider === "wan22-fal"   ? "fal-ai/wan/v2.2-5b/fast/text-to-video" :
                                 "fal-ai/veo3/fast";

  const inserted = (await db.execute(
    sql`INSERT INTO studio_video_jobs (status, pack, shots_total, model)
        VALUES ('queued', ${JSON.stringify(pack)}::jsonb, ${pack.shotList.length}, ${modelLabel})
        RETURNING id`,
  )) as unknown;
  const row =
    (inserted as { rows?: Array<{ id?: string }> }).rows?.[0] ??
    (Array.isArray(inserted) ? (inserted[0] as { id?: string } | undefined) : undefined);
  const jobId = row?.id;
  if (!jobId) return NextResponse.json({ error: "Failed to insert job" }, { status: 500 });

  const delivered = await publish({
    name: "studio.video.render.requested",
    data: { jobId, pack, provider },
  });

  if (!delivered.delivered) {
    return NextResponse.json(
      {
        jobId,
        warning:
          `Job created but background worker did not accept the event (${delivered.reason}). ` +
          `Check INNGEST_EVENT_KEY (direct) or LOVABLE_API_KEY+INNGEST_API_KEY (connector), and that /api/inngest is synced.`,
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
