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
import { presignR2Get, isR2Configured } from "@/lib/agents/artifacts/r2-storage";

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
      { error: "Pack has more than 5 shots. Trim before rendering — Veo is billed per second." },
      { status: 400 },
    );
  }

  const ALLOWED = ["veo3-fal", "veo3-google", "veo3-vertex", "wan22-fal"] as const;
  type Provider = (typeof ALLOWED)[number];
  const provider: Provider = (ALLOWED as readonly string[]).includes(String(body.provider))
    ? (body.provider as Provider)
    : "veo3-vertex";

  // Per-provider secret guard — only the chosen provider's creds are required.
  if ((provider === "veo3-fal" || provider === "wan22-fal") && !process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY missing — required for fal-hosted providers." }, { status: 500 });
  }
  if (provider === "veo3-google" && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY missing." }, { status: 500 });
  }
  if (provider === "veo3-vertex" && !process.env.GCP_SERVICE_ACCOUNT_JSON && !process.env.GCP_VERTEX_API_KEY && !process.env.VERTEX_API_KEY) {
    return NextResponse.json(
      { error: "Vertex auth missing — set GCP_SERVICE_ACCOUNT_JSON." },
      { status: 500 },
    );
  }
  if (provider === "veo3-vertex" && !isR2Configured()) {
    return NextResponse.json(
      { error: "R2 not configured — Vertex renders are persisted to R2. Set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET." },
      { status: 500 },
    );
  }

  const modelLabel =
    provider === "veo3-vertex" ? "google/veo-3.1-generate-001 (vertex)" :
    provider === "veo3-google" ? "google/veo-3.0-generate-001" :
    provider === "wan22-fal"   ? "fal-ai/wan/v2.2-5b/fast/text-to-video" :
                                 "fal-ai/veo3/fast";

  const inserted = (await db.execute(
    sql`INSERT INTO studio_video_jobs (status, pack, shots_total, model, created_by)
        VALUES ('queued', ${JSON.stringify(pack)}::jsonb, ${pack.shotList.length}, ${modelLabel}, ${auth.user?.id ?? null})
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

// Re-presign each stored R2 key so the browser always gets working URLs,
// regardless of how long the job sat in the DB. R2 presigns are 1h TTL.
async function refreshShotUrls(keys: unknown, fallback: unknown): Promise<string[]> {
  const k = Array.isArray(keys) ? (keys as Array<string | null>) : [];
  const f = Array.isArray(fallback) ? (fallback as string[]) : [];
  const out: string[] = [];
  for (let i = 0; i < Math.max(k.length, f.length); i++) {
    const key = k[i];
    if (key && isR2Configured()) {
      try {
        out.push(
          await presignR2Get({
            key,
            filename: `shot-${i + 1}.mp4`,
            mime: "video/mp4",
            inline: true,
            ttlSeconds: 3600,
          }),
        );
        continue;
      } catch {
        // fall through to stored URL
      }
    }
    if (f[i]) out.push(f[i]);
  }
  return out;
}

async function refreshFinalUrl(key: unknown, fallback: unknown): Promise<string | null> {
  if (typeof key === "string" && key && isR2Configured()) {
    try {
      return await presignR2Get({
        key,
        filename: "final-ad.mp4",
        mime: "video/mp4",
        inline: true,
        ttlSeconds: 3600,
      });
    } catch {
      /* fall through */
    }
  }
  return typeof fallback === "string" ? fallback : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireTeamMember(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

  const id = req.nextUrl.searchParams.get("id");

  // List mode — recent jobs for the dashboard's "Recent renders" panel.
  if (!id) {
    const result = (await db.execute(
      sql`SELECT id, status, model, shots_total, shots_done, final_url, final_key, duration_sec, error, created_at
          FROM studio_video_jobs
          ORDER BY created_at DESC
          LIMIT 20`,
    )) as unknown;
    const rows =
      (result as { rows?: Array<Record<string, unknown>> }).rows ??
      (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []);
    const jobs = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        final_url: await refreshFinalUrl(r.final_key, r.final_url),
      })),
    );
    return NextResponse.json({ jobs });
  }

  const result = (await db.execute(
    sql`SELECT id, status, shots_total, shots_done, shot_urls, shot_keys,
               final_url, final_key, duration_sec, error, created_at, updated_at
        FROM studio_video_jobs WHERE id = ${id}::uuid LIMIT 1`,
  )) as unknown;
  const row =
    (result as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
    (Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined);
  if (!row) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const shotUrls = await refreshShotUrls(row.shot_keys, row.shot_urls);
  const finalUrl = await refreshFinalUrl(row.final_key, row.final_url);
  return NextResponse.json({ ...row, shot_urls: shotUrls, final_url: finalUrl });
}
