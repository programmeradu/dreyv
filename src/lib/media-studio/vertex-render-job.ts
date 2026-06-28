import { db } from "@/db";
import { sql } from "drizzle-orm";
import { pollVertexVeoOperation, submitVertexVeoOperation, type VeoFirstFrameImage } from "@/lib/media-studio/google-vertex-veo";
import { rowsFromResult, studioVideoR2ColumnsAvailable } from "@/lib/media-studio/studio-video-schema";
import { normalizeSegment, concatSegments, type StitchSegment } from "@/lib/media-studio/chunked-stitcher";
import { dreyvShotStylePreamble } from "@/lib/media-studio/style-bible";
import { loadDreyvMascotReferences } from "@/lib/media-studio/mascot-references";
import { extractLastFramePng } from "@/lib/media-studio/extract-last-frame";
import { observeShot, type ShotObservation } from "@/lib/media-studio/shot-qc";
import { presignR2Get } from "@/lib/agents/artifacts/r2-storage";
import {
  isElevenLabsConfigured,
  narrationContextFor,
  synthesizeShotNarration,
} from "@/lib/media-studio/elevenlabs-narration";

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
  stitch?: {
    submittedAt: string;
    completedAt?: string;
    durationSec: number;
    finalKey?: string;
    attempts?: number;
    phase?: "normalizing" | "concat" | "done";
    segments?: StitchSegment[]; // normalized per-shot segments on R2
    lastChunkAt?: string;       // when the most recent chunk finished
  };
};


type VertexShotOperation = {
  n: number;
  operationName: string;
  submittedAt: string;
  completedAt?: string;
  url?: string;
  key?: string;
  observation?: ShotObservation;
  reshootCount?: number;
};

const VERTEX_TIMEOUT_MS_PER_SHOT = 15 * 60 * 1000;
const STALE_SUBMISSION_MS = 2 * 60 * 1000;
const STITCH_TIMEOUT_MS = 12 * 60 * 1000;

function packFrom(value: unknown): Pack {
  if (value && typeof value === "object") return value as Pack;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Pack; } catch { return {}; }
  }
  return {};
}

function shotPrompt(
  shot: Shot,
  index: number,
  total: number,
  pack: Pack,
  opts?: { previousObservation?: ShotObservation; reshootNote?: string },
): string {
  const previousShot = index > 0 ? pack.shotList?.[index - 1] : null;
  const nextShot = index < total - 1 ? pack.shotList?.[index + 1] : null;
  const openingShot = pack.shotList?.[0] ?? shot;
  const plannedPreviousCaption = index > 0 ? pack.burnedCaptions?.[index - 1]?.trim() : "";
  const currentCaption = pack.burnedCaptions?.[index]?.trim();
  const phase = index === 0 ? "opening hook" : index === total - 1 ? "final payoff" : `continuation beat ${index + 1}`;
  const obs = opts?.previousObservation;
  // Prefer what was ACTUALLY said + shown over what we planned.
  const observedLastWords = obs?.lastWords?.trim();
  const observedLastAction = obs?.lastAction?.trim();
  const observedSetting = obs?.settingFingerprint?.trim();
  const ultimateScript = pack.voiceoverScript?.trim();
  const masterArc = (pack.shotList ?? [])
    .map((s, i) => `  ${i + 1}/${total}${i === index ? " (THIS SEGMENT)" : ""}: ${s.description}`)
    .join("\n");
  const remainingBeats = (pack.shotList ?? [])
    .slice(index + 1)
    .map((s, i) => `  ${index + 2 + i}: ${s.description}`)
    .join("\n");
  const allCaptions = (pack.burnedCaptions ?? [])
    .map((c, i) => `  ${i + 1}: "${(c ?? "").trim()}"`)
    .join("\n");
  return [
    dreyvShotStylePreamble(),
    "",
    "MASCOT REFERENCE IMAGES ARE ATTACHED — copy the mascot from those images exactly. Match the violet owl body, the cream chest with the Dreyv logo mark on it (a rotated violet rounded-square glyph with an inner cutout — NOT a letter, NOT the letter 'D'), the violet ball cap also stamped with the same Dreyv logo mark, the cream face, the dark violet eyes, and the overall proportions. Do not invent a new mascot. Do not replace the logo with any letter. Do not omit the chest logo or the cap. Do not change the colors.",
    "",
    `Create ONLY segment ${index + 1} of ${total} (${phase}) for one continuous vertical 9:16 Dreyv ad, pronounced DRAVE.`,
    "Duration: exactly 8 seconds. This is not a standalone variant, remake, recap, or alternate take. It must be the next chronological beat in the same ad.",
    ultimateScript ? `ULTIMATE SCRIPT (the complete ad's voiceover — your job is to advance it, never restart it, never repeat already-spoken lines): ${ultimateScript.slice(0, 1200)}` : "",
    masterArc ? `MASTER STORYBOARD — the locked plan for the whole ad. Execute THIS SEGMENT'S beat exactly as written below. Do NOT improvise a different beat, do NOT swap in ideas from other segments, do NOT skip ahead, do NOT fall back to a generic Dreyv intro:\n${masterArc}` : "",
    allCaptions ? `LOCKED VOICEOVER PER SEGMENT (segment ${index + 1} must speak segment ${index + 1}'s line, not any other):\n${allCaptions}` : "",
    remainingBeats ? `Beats that come LATER — do not preview, tease, or jump to them in this segment:\n${remainingBeats}` : "",
    observedSetting
      ? `Setting lock — match this exact world observed in the previous segment: ${observedSetting}`
      : `Locked setting from segment 1 — keep this exact world, location, lighting, time of day, wardrobe, props, lens language, and palette: ${openingShot.description}`,
    "Continuity lock: identical mascot (solid violet #7c3aed owl per the MASCOT LOCK above), identical environment, identical camera language, identical lighting, identical palette as the previous segment.",
    index === 0
      ? "Start with a strong, calm opening motion and establish the cinematic world. Hold the frame clean — no abstract garnish."
      : `You are receiving the exact final frame of segment ${index} as the first image. Begin from that same pose, framing, setting, lighting, and action. Do not restart the story, do not repeat the hook, and do not reintroduce Dreyv.`,
    observedLastAction
      ? `What the mascot and camera were ACTUALLY doing at the end of the previous segment (continue directly from this, do not rewind or reset): ${observedLastAction}`
      : previousShot ? `Previous segment action that just finished — continue directly from its final pose, gesture, and camera movement, do not rewind: ${previousShot.description}` : "",
    observedLastWords
      ? `What was ACTUALLY just spoken in the previous segment (do NOT repeat any of these words; continue the sentence/thought from where it left off): "${observedLastWords}"`
      : plannedPreviousCaption ? `What was just said in the previous segment (do NOT repeat it; continue the thought): "${plannedPreviousCaption}"` : "",
    nextShot ? `Leave the final motion ready to flow into this next segment: ${nextShot.description}` : "",
    pack.formatLabel ? `Format: ${pack.formatLabel}.` : "",
    `LOCKED BEAT FOR THIS SEGMENT — render exactly this action and nothing else. Shot ${shot.n}${shot.timing ? ` (${shot.timing})` : ""}: ${shot.description}`,
    currentCaption ? `What is being said during this segment for pacing only (captions are burned by Dreyv after rendering; do NOT render any letters or subtitles inside the video): "${currentCaption}"` : "",
    shot.toolPrompt ? `Creative intent, without rendering its written text: ${shot.toolPrompt.slice(0, 700)}` : "",
    pack.hook?.spokenLine && index === 0 ? `Voiceover idea for audio only, not on-screen text: ${pack.hook.spokenLine}` : "",
    // Audio is post-produced by Dreyv with ElevenLabs; Veo's own voice track
    // is unreliable and will be discarded. Keep the render visually clean —
    // the mascot can mouth/gesture along but no spoken dialogue should be
    // generated in the audio track and no caption letters in the frame.
    "AUDIO RULE: Render this segment effectively SILENT — no spoken dialogue, no narration, no whispered words. Ambient room tone or subtle motion sound is fine. The mascot may MOUTH the line above to sync lips, but do not generate any spoken audio — Dreyv replaces the audio track in post.",
    pack.soundSuggestion ? `Music / sound: ${pack.soundSuggestion}` : "",
    pack.whyItWorks ? `Emotional angle: ${pack.whyItWorks}` : "",
    opts?.reshootNote ? `RESHOOT NOTE — the previous attempt at this segment failed QC for these reasons, fix them: ${opts.reshootNote}` : "",
    "ON-SCRIPT RULE: continuity with the previous segment's final frame is mandatory, but the WHAT-HAPPENS in this segment must come from the LOCKED BEAT above and the MASTER STORYBOARD — not from improvisation. If the observed prior action seems to conflict with this segment's locked beat, smoothly transition the mascot's pose into executing the locked beat rather than abandoning it.",
    index === total - 1
      ? "End with a clean product payoff using mascot and physical product motion only — no text reveal, no abstract flourish."
      : "End mid-motion, not resolved, so a hard cut to the next segment feels intentional.",
  ].filter(Boolean).join("\n");
}

async function submitNextShotOperation(args: {
  shots: Shot[];
  pack: Pack;
  index: number;
  firstFrameImage?: VeoFirstFrameImage;
  previousObservation?: ShotObservation;
  reshootNote?: string;
  reshootCount?: number;
}): Promise<VertexShotOperation> {
  const mascotRefs = await loadDreyvMascotReferences();
  const shot = args.shots[args.index];
  const op = await submitVertexVeoOperation(
    shotPrompt(shot, args.index, args.shots.length, args.pack, {
      previousObservation: args.previousObservation,
      reshootNote: args.reshootNote,
    }),
    {
      referenceImages: mascotRefs,
      ...(args.firstFrameImage ? { firstFrameImage: args.firstFrameImage } : {}),
    },
  );
  return {
    n: shot.n ?? args.index + 1,
    operationName: op.operationName,
    submittedAt: new Date().toISOString(),
    ...(args.reshootCount ? { reshootCount: args.reshootCount } : {}),
  };
}

async function freshShotUrls(operations: VertexShotOperation[]): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    if (op.key) {
      try {
        urls.push(await presignR2Get({
          key: op.key,
          filename: `shot-${i + 1}.mp4`,
          mime: "video/mp4",
          inline: true,
          ttlSeconds: 3600,
        }));
        continue;
      } catch {
        // Fall back to the operation URL if re-signing is unavailable.
      }
    }
    if (op.url) urls.push(op.url);
  }
  return urls;
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
  await db.execute(sql`
    UPDATE studio_video_jobs
    SET ${sql.join(sets, sql`, `)}, updated_at = now()
    WHERE id = ${jobId}::uuid
      AND status <> 'failed'
  `);
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
        AND status <> 'failed'
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
      AND status <> 'failed'
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

      const firstOperation = await submitNextShotOperation({ shots, pack, index: 0 });
      const nextPack: Pack = {
        ...pack,
        __renderState: {
          provider: "veo3-vertex",
          mode: "stitched_ad",
          submittedAt: firstOperation.submittedAt,
          shotOperations: [firstOperation],
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
    const timeoutMs = Math.max(1, shots.length) * VERTEX_TIMEOUT_MS_PER_SHOT;
    if (Date.now() - firstSubmittedAt > timeoutMs) {
      const message = `Vertex render timed out after ${Math.round(timeoutMs / 60000)} minutes. Start a new render; the old cloud operation stopped responding.`;
      await markFailed(jobId, message);
      return { advanced: true, failed: message };
    }

    const pending = state.shotOperations.find((op) => !op.url);
    if (pending) {
      const pendingIndex = state.shotOperations.findIndex((op) => op === pending);
      const pendingSubmittedAt = dateMs(pending.submittedAt);
      const pendingAgeMs = pendingSubmittedAt === null ? 0 : Date.now() - pendingSubmittedAt;
      if (pendingSubmittedAt !== null && pendingAgeMs > VERTEX_TIMEOUT_MS_PER_SHOT) {
        const retryCount = pending.reshootCount ?? 0;
        if (retryCount >= 1) {
          const message = `Vertex shot ${pendingIndex + 1} timed out twice after ${Math.round(VERTEX_TIMEOUT_MS_PER_SHOT / 60000)} minutes. Start a new render; the cloud operation stopped responding.`;
          await markFailed(jobId, message);
          return { advanced: true, failed: message };
        }

        const previousShot = pendingIndex > 0 ? state.shotOperations[pendingIndex - 1] : null;
        const firstFrameImage = previousShot?.url ? await extractLastFramePng(previousShot.url).catch(() => undefined) : undefined;
        const replacement = await submitNextShotOperation({
          shots,
          pack,
          index: Math.max(0, Math.min(pendingIndex, shots.length - 1)),
          firstFrameImage,
          previousObservation: previousShot?.observation,
          reshootNote: `The prior Vertex operation did not complete within ${Math.round(VERTEX_TIMEOUT_MS_PER_SHOT / 60000)} minutes; continue the same locked storyboard beat without restarting the ad.`,
          reshootCount: retryCount + 1,
        });
        pending.operationName = replacement.operationName;
        pending.submittedAt = replacement.submittedAt;
        pending.completedAt = undefined;
        pending.url = undefined;
        pending.key = undefined;
        pending.observation = undefined;
        pending.reshootCount = retryCount + 1;

        const shotUrls = state.shotOperations.map((op) => op.url).filter((url): url is string => Boolean(url));
        const shotKeys = state.shotOperations.map((op) => op.key).filter((key): key is string => Boolean(key));
        await savePack(jobId, { ...pack, __renderState: { ...state, shotOperations: state.shotOperations } }, {
          status: "rendering_shots",
          shots_total: shots.length,
          shots_done: shotUrls.length,
          shot_urls: shotUrls,
          shot_keys: shotKeys,
          error: `Shot ${pendingIndex + 1} cloud operation stalled; resubmitted once.`,
        });
        return { advanced: true };
      }

      const poll = await pollVertexVeoOperation(pending.operationName);
      if (poll.done) {
        pending.url = poll.url;
        pending.key = poll.key;
        pending.completedAt = new Date().toISOString();

        // QC + observation pass: probe with ffmpeg, transcribe audio (Lovable
        // STT), describe last action + setting via Gemini Flash. Feeds the
        // next shot's prompt with what was ACTUALLY said and shown.
        const expectedNarration = pack.burnedCaptions?.[pending.n - 1] ?? null;
        const observation = await observeShot(poll.url, { expectedNarration }).catch((err) => {
          console.warn("[vertex-render-job] QC failed (non-fatal):", err);
          return undefined;
        });
        if (observation) pending.observation = observation;

        const completedCount = state.shotOperations.filter((op) => Boolean(op.url)).length;
        const reshootCount = pending.reshootCount ?? 0;

        // Reshoot once when QC flags the clip as structurally broken.
        if (observation?.needsReshoot && reshootCount < 1) {
          const reshootIndex = pending.n - 1;
          const prevShot = reshootIndex > 0 ? state.shotOperations.find((o) => o.n === reshootIndex) : null;
          const firstFrameImage = prevShot?.url ? await extractLastFramePng(prevShot.url).catch(() => undefined) : undefined;
          const reshoot = await submitNextShotOperation({
            shots,
            pack,
            index: reshootIndex,
            firstFrameImage,
            previousObservation: prevShot?.observation,
            reshootNote: observation.issues.join("; "),
            reshootCount: reshootCount + 1,
          });
          // Replace the broken op so the loop polls the reshoot, not the broken one.
          pending.url = undefined;
          pending.key = undefined;
          pending.operationName = reshoot.operationName;
          pending.submittedAt = reshoot.submittedAt;
          pending.completedAt = undefined;
          pending.observation = undefined;
          pending.reshootCount = reshootCount + 1;
        } else if (completedCount < shots.length) {
          const firstFrameImage = await extractLastFramePng(poll.url);
          const nextOperation = await submitNextShotOperation({
            shots,
            pack,
            index: completedCount,
            firstFrameImage,
            previousObservation: observation,
          });
          state.shotOperations.push(nextOperation);
        }
      }
      const shotUrls = state.shotOperations.map((op) => op.url).filter((url): url is string => Boolean(url));
      const shotKeys = state.shotOperations.map((op) => op.key).filter((key): key is string => Boolean(key));
      const nextPack: Pack = {
        ...pack,
        __renderState: { ...state, shotOperations: state.shotOperations },
      };
      await savePack(jobId, nextPack, {
        status: "rendering_shots",
        shots_total: shots.length,
        shots_done: shotUrls.length,
        shot_urls: shotUrls,
        shot_keys: shotKeys,
      });
      return { advanced: true };
    }

    const shotUrls = await freshShotUrls(state.shotOperations);
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

    // ────────────────────────────────────────────────────────────────────────
    // Chunked stitching — Vercel lambdas cap at 5 min, so we never stitch the
    // whole video in one invocation. Each advance() does AT MOST one chunk:
    //   • normalize shot N (re-encode + caption burn + grade + upscale) → R2
    //   • once every shot has a segment, concat-copy them into the final MP4
    // The Inngest worker loop nudges us until phase === "done".
    // ────────────────────────────────────────────────────────────────────────
    const stitchAttempts = state.stitch?.attempts ?? 0;
    if (stitchAttempts >= 8) {
      await markFailed(jobId, `Stitching failed after ${stitchAttempts} chunk attempts. Start a new render.`);
      return { advanced: true, failed: "stitch_attempts_exhausted" };
    }

    const existingSegments = state.stitch?.segments ?? [];
    const nextIndex = shotUrls.findIndex((_, i) => !existingSegments.some((s) => s.n === i));

    // Phase 1 — normalize the next missing segment.
    if (nextIndex !== -1) {
      const stitchBase = state.stitch ?? {
        submittedAt: new Date().toISOString(),
        durationSec: shotUrls.length * 8,
      };
      try {
        // Synthesize ElevenLabs narration for this shot so the stitcher can
        // mux it in. Falls back to Veo's native audio if ElevenLabs is not
        // configured or the request fails.
        let narrationUrl: string | undefined;
        const captions = pack.burnedCaptions ?? [];
        const narrationText = captions[nextIndex]?.trim();
        if (isElevenLabsConfigured() && narrationText) {
          try {
            const ctx = narrationContextFor(captions, nextIndex);
            const narration = await synthesizeShotNarration({
              jobId,
              index: nextIndex,
              text: narrationText,
              previousText: ctx.previousText,
              nextText: ctx.nextText,
            });
            narrationUrl = narration.url;
          } catch (err) {
            console.warn(`[vertex-render-job] ElevenLabs narration failed for shot ${nextIndex + 1} (using Veo audio):`, err);
          }
        }
        const segment = await normalizeSegment({
          jobId,
          shotUrl: shotUrls[nextIndex],
          index: nextIndex,
          caption: pack.burnedCaptions?.[nextIndex],
          colorGrade: true,
          upscaleTo1080: true,
          narrationUrl,
          shotDurationSec: 8,
        });
        const segments = [...existingSegments, segment].sort((a, b) => a.n - b.n);
        const nextState: VertexRenderState = {
          ...state,
          stitch: {
            ...stitchBase,
            attempts: stitchAttempts + 1,
            phase: "normalizing",
            segments,
            lastChunkAt: new Date().toISOString(),
          },
        };
        await savePack(jobId, { ...pack, __renderState: nextState }, {
          status: "stitching",
          shots_total: shotUrls.length,
          shots_done: shotUrls.length,
          shot_urls: shotUrls,
          shot_keys: shotKeys,
        });
        return { advanced: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const nextState: VertexRenderState = {
          ...state,
          stitch: { ...stitchBase, attempts: stitchAttempts + 1, phase: "normalizing", segments: existingSegments },
        };
        await savePack(jobId, { ...pack, __renderState: nextState }, { status: "stitching" });
        throw new Error(`normalizeSegment[${nextIndex}] failed: ${message}`);
      }
    }

    // Phase 2 — every segment present, concat-copy into the final MP4.
    const stitchBase = state.stitch ?? {
      submittedAt: new Date().toISOString(),
      durationSec: shotUrls.length * 8,
    };
    const concatState: VertexRenderState = {
      ...state,
      stitch: { ...stitchBase, attempts: stitchAttempts + 1, phase: "concat", segments: existingSegments },
    };
    await savePack(jobId, { ...pack, __renderState: concatState }, { status: "stitching" });

    const stitched = await concatSegments({
      jobId,
      segments: existingSegments,
      durationSec: shotUrls.length * 8,
    });
    const nextPack: Pack = {
      ...pack,
      __renderState: {
        ...concatState,
        stitch: {
          ...stitchBase,
          attempts: stitchAttempts + 1,
          phase: "done",
          segments: existingSegments,
          completedAt: new Date().toISOString(),
          durationSec: stitched.durationSec,
          finalKey: stitched.key,
        },
        completedAt: new Date().toISOString(),
      },
    };
    await saveFinal({
      jobId,
      pack: nextPack,
      finalUrl: stitched.url,
      finalKey: stitched.key,
      shotUrls,
      shotKeys,
      durationSec: stitched.durationSec,
    });
    return { advanced: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(jobId, message);
    return { advanced: true, failed: message };
  }
}
