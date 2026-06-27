import { db } from "@/db";
import { sql } from "drizzle-orm";
import { pollVertexVeoOperation, submitVertexVeoOperation } from "@/lib/media-studio/google-vertex-veo";
import { pollComposeFinalAd, submitComposeFinalAd } from "@/lib/media-studio/fal";
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
  mode: "stitched_ad" | "single_ad";
  operationName?: string;
  submittedAt?: string;
  completedAt?: string;
  shotOperations?: VertexShotOperation[];
  compose?: {
    requestId: string;
    statusUrl: string;
    responseUrl: string;
    submittedAt: string;
    completedAt?: string;
    durationSec: number;
  };
};

type VertexShotOperation = {
  n: number;
  operationName: string;
  submittedAt: string;
  completedAt?: string;
  url?: string;
  key?: string;
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

function shotPrompt(shot: Shot, index: number, total: number, pack: Pack): string {
  return [
    `Create segment ${index + 1} of ${total} for a seamless vertical 9:16 Dreyv ad, pronounced DRAVE.`,
    "Duration: exactly 8 seconds. Start and end with smooth motion that can cut cleanly into adjacent segments.",
    "Visual direction: premium light SaaS ad, white environment, solid violet accents only, crisp product-like motion, no fuchsia, no pink, no gradients, no stock-looking people.",
    "Important text rule: DO NOT render any readable words, subtitles, captions, logo text, UI labels, numbers, or typography. Use only abstract interface shapes and unreadable micro-glyph lines. Captions will be added separately in post-production.",
    pack.formatLabel ? `Format: ${pack.formatLabel}.` : "",
    `Shot ${shot.n}${shot.timing ? ` (${shot.timing})` : ""}: ${shot.description}`,
    shot.toolPrompt ? `Creative intent, without rendering its written text: ${shot.toolPrompt.slice(0, 700)}` : "",
    pack.hook?.spokenLine && index === 0 ? `Voiceover idea for audio only, not on-screen text: ${pack.hook.spokenLine}` : "",
    pack.voiceoverScript ? `Voiceover direction for audio only, not captions: ${pack.voiceoverScript.slice(0, 700)}` : "",
    pack.soundSuggestion ? `Music / sound: ${pack.soundSuggestion}` : "",
    pack.whyItWorks ? `Emotional angle: ${pack.whyItWorks}` : "",
    index === total - 1 ? "End with a clean product payoff, using shapes and product motion only — no text reveal." : "Keep the final frame in motion so the next segment cuts naturally.",
  ].filter(Boolean).join("\n");
}

function usableShots(pack: Pack): Shot[] {
  return (pack.shotList ?? [])
    .filter((shot) => shot && typeof shot.description === "string" && shot.description.trim())
    .slice(0, 5);
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

async function claimQueuedJob(jobId: string, shotsTotal: number) {
  if (!db) return null;
  const result = (await db.execute(sql`
    UPDATE studio_video_jobs
    SET status = 'rendering_shots',
        shots_total = ${shotsTotal},
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
  const r2Ready = await studioVideoR2ColumnsAvailable();
  const entries = Object.entries({ ...patch, pack }).filter(([key]) => {
    const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    return r2Ready || (col !== "shot_keys" && col !== "final_key");
  });
  if (!entries.length) return;
  const jsonbCols = new Set(["pack", "shot_urls", "shot_keys"]);
  const sets = entries.map(([key, value]) => {
    const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    if (jsonbCols.has(col)) return sql`${sql.identifier(col)} = ${JSON.stringify(value)}::jsonb`;
    return sql`${sql.identifier(col)} = ${value as never}`;
  });
  await db.execute(sql`UPDATE studio_video_jobs SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${jobId}::uuid`);
}

async function saveFinal(args: {
  jobId: string;
  pack: Pack;
  finalUrl: string;
  finalKey?: string;
  shotUrls: string[];
  shotKeys: string[];
  durationSec: number;
}) {
  if (!db) return;
  const r2Ready = await studioVideoR2ColumnsAvailable();
  if (r2Ready) {
    await db.execute(sql`
      UPDATE studio_video_jobs
      SET pack = ${JSON.stringify(args.pack)}::jsonb,
          status = 'done',
          shots_done = ${args.shotUrls.length},
          shots_total = ${args.shotUrls.length},
          shot_urls = ${JSON.stringify(args.shotUrls)}::jsonb,
          shot_keys = ${JSON.stringify(args.shotKeys)}::jsonb,
          final_url = ${args.finalUrl},
          final_key = ${args.finalKey ?? null},
          duration_sec = ${args.durationSec},
          error = NULL,
          updated_at = now()
      WHERE id = ${args.jobId}::uuid
    `);
    return;
  }
  await db.execute(sql`
    UPDATE studio_video_jobs
    SET pack = ${JSON.stringify(args.pack)}::jsonb,
        status = 'done',
        shots_done = ${args.shotUrls.length},
        shots_total = ${args.shotUrls.length},
        shot_urls = ${JSON.stringify(args.shotUrls)}::jsonb,
        final_url = ${args.finalUrl},
        duration_sec = ${args.durationSec},
        error = NULL,
        updated_at = now()
    WHERE id = ${args.jobId}::uuid
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
  const shots = usableShots(pack);
  if (!shots.length) {
    const message = "Pack has no renderable shots";
    await markFailed(jobId, message);
    return { advanced: true, failed: message };
  }
  const state: VertexRenderState = {
    provider: "veo3-vertex",
    mode: "stitched_ad",
    ...(pack.__renderState ?? {}),
  };

  try {
    if (!state.shotOperations?.length && state.operationName) {
      state.shotOperations = [{
        n: 1,
        operationName: state.operationName,
        submittedAt: state.submittedAt ?? new Date().toISOString(),
      }];
    }

    if (!state.shotOperations?.length) {
      const status = typeof row.status === "string" ? row.status : "queued";
      const updatedAt = dateMs(row.updated_at);
      const staleSubmission = status === "rendering_shots" && updatedAt !== null && Date.now() - updatedAt > STALE_SUBMISSION_MS;

      if (status === "queued") {
        const claimed = await claimQueuedJob(jobId, shots.length);
        if (!claimed) return { advanced: false };
      } else if (!staleSubmission) {
        return { advanced: false };
      }

      const submittedAt = new Date().toISOString();
      const operations: VertexShotOperation[] = [];
      for (let i = 0; i < shots.length; i += 1) {
        const op = await submitVertexVeoOperation(shotPrompt(shots[i], i, shots.length, pack));
        operations.push({ n: shots[i].n ?? i + 1, operationName: op.operationName, submittedAt });
      }
      const nextPack: Pack = {
        ...pack,
        __renderState: {
          provider: "veo3-vertex",
          mode: "stitched_ad",
          submittedAt,
          shotOperations: operations,
        },
      };
      await savePack(jobId, nextPack, {
        status: "rendering_shots",
        shots_total: shots.length,
        shots_done: 0,
        error: null,
      });
      return { advanced: true };
    }

    const firstSubmittedAt = state.shotOperations
      .map((op) => dateMs(op.submittedAt))
      .filter((ms): ms is number => ms !== null)
      .sort((a, b) => a - b)[0] ?? Date.now();
    if (Date.now() - firstSubmittedAt > VERTEX_TIMEOUT_MS) {
      const message = "Vertex render timed out after 15 minutes. Start a new render; the old cloud operation stopped responding.";
      await markFailed(jobId, message);
      return { advanced: true, failed: message };
    }

    const pending = state.shotOperations.find((op) => !op.url);
    if (pending) {
      const poll = await pollVertexVeoOperation(pending.operationName);
      if (poll.done) {
        pending.url = poll.url;
        pending.key = poll.key;
        pending.completedAt = new Date().toISOString();
      }
      const shotUrls = state.shotOperations.map((op) => op.url).filter((url): url is string => Boolean(url));
      const shotKeys = state.shotOperations.map((op) => op.key).filter((key): key is string => Boolean(key));
      const nextPack: Pack = {
        ...pack,
        __renderState: { ...state, shotOperations: state.shotOperations },
      };
      await savePack(jobId, nextPack, {
        status: "rendering_shots",
        shots_total: state.shotOperations.length,
        shots_done: shotUrls.length,
        shot_urls: shotUrls,
        shot_keys: shotKeys,
      });
      return { advanced: true };
    }

    const shotUrls = state.shotOperations.map((op) => op.url).filter((url): url is string => Boolean(url));
    const shotKeys = state.shotOperations.map((op) => op.key).filter((key): key is string => Boolean(key));

    if (shotUrls.length <= 1) {
      const nextPack: Pack = {
        ...pack,
        __renderState: { ...state, completedAt: new Date().toISOString() },
      };
      await saveFinal({
        jobId,
        pack: nextPack,
        finalUrl: shotUrls[0],
        finalKey: shotKeys[0],
        shotUrls,
        shotKeys,
        durationSec: 8,
      });
      return { advanced: true };
    }

    if (!state.compose) {
      // Stitching uses fal's hosted ffmpeg API. If FAL_KEY is missing OR fal
      // rejects us (e.g. exhausted balance — we're on the Vertex path so the
      // user explicitly didn't pick fal for rendering), deliver the shots as
      // individual clips instead of failing the whole job.
      if (!process.env.FAL_KEY?.trim()) {
        const nextPack: Pack = {
          ...pack,
          __renderState: { ...state, completedAt: new Date().toISOString() },
        };
        await saveFinal({
          jobId,
          pack: nextPack,
          finalUrl: shotUrls[0],
          finalKey: shotKeys[0],
          shotUrls,
          shotKeys,
          durationSec: 8 * shotUrls.length,
        });
        return { advanced: true };
      }
      await savePack(jobId, { ...pack, __renderState: state }, {
        status: "stitching",
        shots_total: shotUrls.length,
        shots_done: shotUrls.length,
        shot_urls: shotUrls,
        shot_keys: shotKeys,
      });
      let submitted;
      try {
        submitted = await submitComposeFinalAd({ shotUrls, shotDurationSec: 8 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // fal billing/auth failures (401/402/403) — degrade to per-shot delivery
        // instead of failing the Vertex render the user already paid for.
        if (/\b(401|402|403)\b/.test(msg) || /exhausted balance|locked/i.test(msg)) {
          const nextPack: Pack = {
            ...pack,
            __renderState: { ...state, completedAt: new Date().toISOString() },
          };
          await saveFinal({
            jobId,
            pack: nextPack,
            finalUrl: shotUrls[0],
            finalKey: shotKeys[0],
            shotUrls,
            shotKeys,
            durationSec: 8 * shotUrls.length,
          });
          return { advanced: true };
        }
        throw err;
      }
      const nextPack: Pack = {
        ...pack,
        __renderState: {
          ...state,
          compose: {
            requestId: submitted.request_id,
            statusUrl: submitted.status_url,
            responseUrl: submitted.response_url,
            submittedAt: new Date().toISOString(),
            durationSec: submitted.durationSec,
          },
        },
      };
      await savePack(jobId, nextPack, { status: "stitching", duration_sec: submitted.durationSec });
      return { advanced: true };
    }


    const composed = await pollComposeFinalAd({
      statusUrl: state.compose.statusUrl,
      responseUrl: state.compose.responseUrl,
    });
    if (!composed.done) {
      await savePack(jobId, { ...pack, __renderState: state }, {
        status: "stitching",
        shots_total: shotUrls.length,
        shots_done: shotUrls.length,
        shot_urls: shotUrls,
        shot_keys: shotKeys,
        duration_sec: state.compose.durationSec,
      });
      return { advanced: true };
    }

    const nextPack: Pack = {
      ...pack,
      __renderState: {
        ...state,
        compose: { ...state.compose, completedAt: new Date().toISOString() },
        completedAt: new Date().toISOString(),
      },
    };
    await saveFinal({
      jobId,
      pack: nextPack,
      finalUrl: composed.url,
      shotUrls,
      shotKeys,
      durationSec: state.compose.durationSec,
    });
    return { advanced: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(jobId, message);
    return { advanced: true, failed: message };
  }
}
