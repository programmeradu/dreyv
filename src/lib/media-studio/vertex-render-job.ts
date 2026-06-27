import { db } from "@/db";
import { sql } from "drizzle-orm";
import { pollVertexVeoOperation, submitVertexVeoOperation } from "@/lib/media-studio/google-vertex-veo";
import { rowsFromResult, studioVideoR2ColumnsAvailable } from "@/lib/media-studio/studio-video-schema";

type Shot = {
  n: number;
  timing?: string;
  description: string;
  toolPrompt: string;
  recommendedTool?: string;
};

type Pack = {
  formatLabel?: string;
  hook?: { textCard?: string; spokenLine?: string };
  shotList?: Shot[];
  voiceoverScript?: string;
  burnedCaptions?: string[];
  soundSuggestion?: string;
  whyItWorks?: string;
  __renderState?: VertexRenderState;
};

type VertexRenderState = {
  provider: "veo3-vertex";
  mode: "single_ad";
  operationName?: string;
  submittedAt?: string;
  completedAt?: string;
  lockId?: string;
  lockUntil?: string;
};

const VERTEX_TIMEOUT_MS = 15 * 60 * 1000;
const STALE_SUBMISSION_MS = 2 * 60 * 1000;

function packFrom(value: unknown): Pack {
  if (value && typeof value === "object") return value as Pack;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Pack; } catch { return {}; }
  }
  return {};
}

function fullAdPrompt(pack: Pack): string {
  const shots = (pack.shotList ?? []).slice(0, 5);
  return [
    "Create one complete 8-second vertical 9:16 TikTok ad for Dreyv, pronounced DRAVE.",
    "Visual direction: premium light SaaS ad, white environment, solid violet accents only, crisp product-like motion, no fuchsia, no pink, no gradients, no stock-looking people.",
    pack.formatLabel ? `Format: ${pack.formatLabel}.` : "",
    pack.hook?.textCard ? `Opening text card in the first second: ${pack.hook.textCard}` : "",
    pack.hook?.spokenLine ? `Spoken opener: ${pack.hook.spokenLine}` : "",
    shots.length
      ? `Compress these beats into one continuous clip: ${shots.map((s) => `Shot ${s.n}${s.timing ? ` (${s.timing})` : ""}: ${s.description}`).join(" | ")}`
      : "Show Dreyv turning a chaotic crypto workflow into a calm automated treasury action.",
    pack.voiceoverScript ? `Voiceover: ${pack.voiceoverScript.slice(0, 900)}` : "",
    pack.burnedCaptions?.length ? `Use concise on-screen captions: ${pack.burnedCaptions.slice(0, 4).join(" / ")}` : "",
    pack.soundSuggestion ? `Music / sound: ${pack.soundSuggestion}` : "",
    pack.whyItWorks ? `Emotional angle: ${pack.whyItWorks}` : "",
    "End with a clean product payoff, not a generic logo reveal. Keep text legible and minimal.",
  ].filter(Boolean).join("\n");
}

function dateMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

async function loadActiveJob(jobId: string) {
  if (!db) return null;
  const result = (await db.execute(sql`
    SELECT id, status, pack, shot_urls, final_url, shots_done, shots_total, updated_at
    FROM studio_video_jobs
    WHERE id = ${jobId}::uuid
      AND status NOT IN ('done', 'failed')
    LIMIT 1
  `)) as unknown;
  return rowsFromResult(result)[0] ?? null;
}

async function claimQueuedJob(jobId: string) {
  if (!db) return null;
  const result = (await db.execute(sql`
    UPDATE studio_video_jobs
    SET status = 'rendering_shots',
        shots_total = 1,
        shots_done = 0,
        error = NULL,
        updated_at = now()
    WHERE id = ${jobId}::uuid
      AND status = 'queued'
    RETURNING id, status, pack, shot_urls, final_url, shots_done, shots_total
  `)) as unknown;
  return rowsFromResult(result)[0] ?? null;
}

async function savePack(jobId: string, pack: Pack, patch: Record<string, unknown>) {
  if (!db) return;
  const entries = Object.entries({ ...patch, pack }).filter(([key]) => {
    const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    return col !== "shot_keys" && col !== "final_key";
  });
  const jsonbCols = new Set(["pack", "shot_urls"]);
  const sets = entries.map(([key, value]) => {
    const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    if (jsonbCols.has(col)) return sql`${sql.identifier(col)} = ${JSON.stringify(value)}::jsonb`;
    return sql`${sql.identifier(col)} = ${value as never}`;
  });
  await db.execute(sql`UPDATE studio_video_jobs SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${jobId}::uuid`);
}

async function saveFinal(jobId: string, pack: Pack, url: string, key?: string) {
  if (!db) return;
  const r2Ready = await studioVideoR2ColumnsAvailable();
  if (r2Ready) {
    await db.execute(sql`
      UPDATE studio_video_jobs
      SET pack = ${JSON.stringify(pack)}::jsonb,
          status = 'done',
          shots_done = 1,
          shots_total = 1,
          shot_urls = ${JSON.stringify([url])}::jsonb,
          shot_keys = ${JSON.stringify(key ? [key] : [])}::jsonb,
          final_url = ${url},
          final_key = ${key ?? null},
          duration_sec = 8,
          error = NULL,
          updated_at = now()
      WHERE id = ${jobId}::uuid
    `);
    return;
  }
  await db.execute(sql`
    UPDATE studio_video_jobs
    SET pack = ${JSON.stringify(pack)}::jsonb,
        status = 'done',
        shots_done = 1,
        shots_total = 1,
        shot_urls = ${JSON.stringify([url])}::jsonb,
        final_url = ${url},
        duration_sec = 8,
        error = NULL,
        updated_at = now()
    WHERE id = ${jobId}::uuid
  `);
}

async function markFailed(jobId: string, message: string) {
  if (!db) return;
  await db.execute(sql`
    UPDATE studio_video_jobs
    SET status = 'failed', error = ${message.slice(0, 1000)}, updated_at = now()
    WHERE id = ${jobId}::uuid
  `);
}

/**
 * Vertex-managed renderer: submit once, then each poll checks the LRO once.
 * No Inngest dependency, no long-held serverless request, no endless spinner.
 */
export async function advanceVertexRenderJob(jobId: string): Promise<{ advanced: boolean; failed?: string }> {
  const row = await loadActiveJob(jobId);
  if (!row) return { advanced: false };

  const pack = packFrom(row.pack);
  const state: VertexRenderState = {
    provider: "veo3-vertex",
    mode: "single_ad",
    ...(pack.__renderState ?? {}),
  };

  try {
    if (!state.operationName) {
      const status = typeof row.status === "string" ? row.status : "queued";
      const updatedAt = dateMs(row.updated_at);
      const staleSubmission = status === "rendering_shots" && updatedAt !== null && Date.now() - updatedAt > STALE_SUBMISSION_MS;

      if (status === "queued") {
        const claimed = await claimQueuedJob(jobId);
        if (!claimed) return { advanced: false };
      } else if (!staleSubmission) {
        return { advanced: false };
      }

      const op = await submitVertexVeoOperation(fullAdPrompt(pack));
      const nextPack: Pack = {
        ...pack,
        __renderState: {
          provider: "veo3-vertex",
          mode: "single_ad",
          operationName: op.operationName,
          submittedAt: new Date().toISOString(),
        },
      };
      await savePack(jobId, nextPack, {
        status: "rendering_shots",
        shots_total: 1,
        shots_done: 0,
        error: null,
      });
      return { advanced: true };
    }

    const submittedAt = state.submittedAt ? new Date(state.submittedAt).getTime() : Date.now();
    if (Date.now() - submittedAt > VERTEX_TIMEOUT_MS) {
      const message = "Vertex render timed out after 15 minutes. Start a new render; the old cloud operation stopped responding.";
      await markFailed(jobId, message);
      return { advanced: true, failed: message };
    }

    const poll = await pollVertexVeoOperation(state.operationName);
    if (!poll.done) {
      const nextPack: Pack = {
        ...pack,
        __renderState: { ...state },
      };
      await savePack(jobId, nextPack, { status: "rendering_shots", shots_total: 1, shots_done: 0 });
      return { advanced: true };
    }

    const nextPack: Pack = {
      ...pack,
      __renderState: { ...state, completedAt: new Date().toISOString() },
    };
    await saveFinal(jobId, nextPack, poll.url, poll.key);
    return { advanced: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(jobId, message);
    return { advanced: true, failed: message };
  }
}
