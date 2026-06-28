/**
 * /api/studio/video/render
 *
 *   POST  { pack }       → creates a studio_video_jobs row and queues the
 *                          selected renderer in the durable worker.
 *   GET   ?id=<uuid>     → returns the row so the UI can poll progress
 *                          and surface the final mp4 url + per-shot urls.
 *   DELETE ?id=<uuid>    → abandons a stuck in-progress render so Studio can
 *                          immediately start a fresh job.
 *
 * Status checks must stay cheap. The durable worker advances Vertex operations,
 * runs QC, and stitches the finished shots so browser polling never 504s.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";
import { presignR2Get, isR2Configured } from "@/lib/agents/artifacts/r2-storage";
import { rowsFromResult, studioVideoR2ColumnsAvailable } from "@/lib/media-studio/studio-video-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[studio/video/render] POST failed:", err);
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireTeamMember(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id || !isUuid(id)) return NextResponse.json({ error: "Invalid render job id" }, { status: 400 });

    const result = (await db.execute(sql`
      UPDATE studio_video_jobs
      SET status = 'failed',
          error = 'Manually abandoned from Studio so a fresh render could be started.',
          updated_at = now()
      WHERE id = ${id}::uuid
        AND status NOT IN ('done', 'failed')
      RETURNING id, status, error, updated_at
    `)) as unknown;
    const row = rowsFromResult(result)[0];
    return NextResponse.json({ ok: true, abandoned: Boolean(row), job: row ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[studio/video/render] DELETE failed:", err);
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
  // Hard cap to 5 shots — Veo is billed per second. Trim silently rather
  // than 400ing so the UI can just hit "render" without pre-validating.
  if (pack.shotList.length > 5) {
    pack.shotList = pack.shotList.slice(0, 5);
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

  const renderUnits = pack.shotList.length;
  const inserted = (await db.execute(
    sql`INSERT INTO studio_video_jobs (status, pack, shots_total, model, created_by)
        VALUES ('queued', ${JSON.stringify(pack)}::jsonb, ${renderUnits}, ${modelLabel}, ${auth.user?.id ?? null})
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
    await db.execute(sql`
      UPDATE studio_video_jobs
      SET status = 'failed', error = ${`Background worker did not accept the event (${delivered.reason}).`}, updated_at = now()
      WHERE id = ${jobId}::uuid
    `);
    return NextResponse.json(
      {
        jobId,
        error:
          `Job created but background worker did not accept the event (${delivered.reason}). ` +
          `Check INNGEST_EVENT_KEY (direct) or LOVABLE_API_KEY+INNGEST_API_KEY (connector), and that /api/inngest is synced.`,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ jobId, mode: provider === "veo3-vertex" ? "vertex-managed-worker" : "worker" });
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function dateMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

async function nudgeVertexWorker(row: Record<string, unknown>) {
  if (!db) return;
  const id = typeof row.id === "string" ? row.id : "";
  const model = typeof row.model === "string" ? row.model : "";
  const status = typeof row.status === "string" ? row.status : "";
  if (!isUuid(id) || !model.includes("(vertex)") || status === "done" || status === "failed") return;

  const updatedAt = dateMs(row.updated_at);
  // Queued jobs get re-published immediately on any poll — the worker uses a
  // DB claim guard (`claimQueuedJob`) so duplicate events are harmless. For
  // in-flight statuses we still throttle to avoid event spam.
  const throttleMs = status === "queued" ? 5_000 : 75_000;
  if (updatedAt !== null && Date.now() - updatedAt < throttleMs) return;

  await db.execute(sql`UPDATE studio_video_jobs SET updated_at = now() WHERE id = ${id}::uuid`);
  await publish({
    name: "studio.video.render.requested",
    data: { jobId: id, pack: row.pack, provider: "veo3-vertex" },
  }).catch((err) => console.warn("[studio/video/render] vertex worker nudge failed:", err));
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTeamMember(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

    const id = req.nextUrl.searchParams.get("id");

    // List mode — recent jobs for the dashboard's "Recent renders" panel.
    if (!id) {
      const result = (await db.execute(sql`SELECT id, status, model, pack, shots_total, shots_done,
                                                  final_url, duration_sec, error, created_at, updated_at
                                           FROM studio_video_jobs
                                           ORDER BY created_at DESC
                                           LIMIT 20`)) as unknown;
      const rows = rowsFromResult(result);
      // Auto-resume any queued / in-flight Vertex jobs surfaced in the list.
      await Promise.all(rows.map((r) => nudgeVertexWorker(r).catch(() => {})));
      let finalKeys = new Map<string, unknown>();
      if (await studioVideoR2ColumnsAvailable()) {
        try {
          const ids = rows.map((r) => r.id).filter((v): v is string => typeof v === "string" && isUuid(v));
          if (ids.length > 0) {
            const keyResult = (await db.execute(sql`SELECT id, final_key FROM studio_video_jobs WHERE id = ANY(${ids}::uuid[])`)) as unknown;
            finalKeys = new Map(rowsFromResult(keyResult).map((r) => [String(r.id), r.final_key]));
          }
        } catch (err) {
          console.warn("[studio/video/render] final_key lookup skipped:", err);
        }
      }
      const jobs = await Promise.all(
        rows.map(async (r) => {
          const { pack: _pack, updated_at: _updated, ...rest } = r as Record<string, unknown>;
          return {
            ...rest,
            final_url: await refreshFinalUrl(finalKeys.get(String(r.id)), r.final_url),
          };
        }),
      );
      return NextResponse.json({ jobs });
    }

    if (!isUuid(id)) return NextResponse.json({ error: "Invalid render job id" }, { status: 400 });

    let result = (await db.execute(sql`SELECT id, status, model, pack, shots_total, shots_done, shot_urls,
                                                final_url, duration_sec, error, created_at, updated_at
                                         FROM studio_video_jobs WHERE id = ${id}::uuid LIMIT 1`)) as unknown;
    let row = rowsFromResult(result)[0];
    if (!row) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    await nudgeVertexWorker(row);

    let shotKeys: unknown = [];
    let finalKey: unknown = null;
    if (await studioVideoR2ColumnsAvailable()) {
      try {
        const keyResult = (await db.execute(sql`SELECT COALESCE(shot_keys, '[]'::jsonb) AS shot_keys,
                                                       final_key
                                                FROM studio_video_jobs WHERE id = ${id}::uuid LIMIT 1`)) as unknown;
        const keyRow = rowsFromResult(keyResult)[0];
        shotKeys = keyRow?.shot_keys ?? [];
        finalKey = keyRow?.final_key ?? null;
      } catch (err) {
        console.warn("[studio/video/render] R2 key lookup skipped:", err);
      }
    }

    const shotUrls = await refreshShotUrls(shotKeys, row.shot_urls);
    const finalUrl = await refreshFinalUrl(finalKey, row.final_url);
    const { pack: _pack, ...safeRow } = row;
    return NextResponse.json({ ...safeRow, shot_urls: shotUrls, final_url: finalUrl });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[studio/video/render] GET failed:", err);
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

