import { db } from "@/db";
import { sql } from "drizzle-orm";
import { pollVertexVeoOperation, submitVertexVeoOperation, type VeoFirstFrameImage } from "@/lib/media-studio/google-vertex-veo";
import { rowsFromResult, studioVideoR2ColumnsAvailable } from "@/lib/media-studio/studio-video-schema";
import { normalizeSegment, concatSegments, type StitchSegment } from "@/lib/media-studio/chunked-stitcher";
import { dreyvShotStylePreamble } from "@/lib/media-studio/style-bible";
import { loadDreyvMascotReferences, type VeoReferenceImage } from "@/lib/media-studio/mascot-references";
import { resolvePropRefsForShot } from "@/lib/media-studio/prop-references";
import { extractTailFramesAsRefs } from "@/lib/media-studio/extract-tail-frames";
import { observeShot, type ShotObservation } from "@/lib/media-studio/shot-qc";
import { presignR2Get } from "@/lib/agents/artifacts/r2-storage";
import {
  isElevenLabsConfigured,
  synthesizeFullNarration,
} from "@/lib/media-studio/elevenlabs-narration";

type Shot = {
  n: number;
  timing?: string;
  description: string;
  toolPrompt: string;
  recommendedTool?: string;
  mascotInShot?: boolean;
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
    narrations?: NarrationEntry[]; // ElevenLabs TTS progress per shot
    masterNarration?: MasterNarrationEntry;
  };
};

export type NarrationEntry = {
  n: number;
  status: "synthesizing" | "ready" | "skipped" | "failed" | "muxed";
  bytes?: number;
  reason?: string;
  updatedAt: string;
};

export type MasterNarrationEntry = {
  status: "synthesizing" | "ready" | "skipped" | "failed" | "muxed";
  key?: string;
  bytes?: number;
  reason?: string;
  updatedAt: string;
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

/**
 * Build the per-shot prompt as a structured JSON object serialized to a
 * string. Veo 3.1's parser treats top-level keys as typed slots (subject,
 * action, camera, lighting, audio, continuity, negative_prompt, …), which
 * produces much tighter shot-to-shot consistency than the same intent
 * expressed as one long paragraph. The cinematic detail lives INSIDE the
 * string values — pure schema with no prose underperforms.
 *
 * Critical slots for us:
 *  - `audio.dialogue: ""`     → forces silent renders so ElevenLabs owns VO
 *  - `on_screen_text.render`  → suppresses Veo's misspelled caption text
 *  - `continuity.*`           → frame-to-frame lock across the 5 shots
 *  - `negative_prompt`        → first-class slot, honored more strictly
 */
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
  const useExternalNarration = isElevenLabsConfigured();
  const phase = index === 0 ? "opening_hook" : index === total - 1 ? "final_payoff" : "continuation_beat";
  const obs = opts?.previousObservation;
  const observedLastWords = obs?.lastWords?.trim();
  const observedLastAction = obs?.lastAction?.trim();
  const observedSetting = obs?.settingFingerprint?.trim();
  const shotText = [shot.description, shot.toolPrompt].filter(Boolean).join("\n");
  const setHint = inferSetHint(shotText);
  const propHint = inferPropHint(shotText);
  const cameraHint = inferCameraHint(shotText, index);
  const motionHint = inferMotionHint(shotText, index, total);

  const masterStoryboard = (pack.shotList ?? []).map((s, i) => ({
    segment: i + 1,
    of: total,
    is_this_segment: i === index,
    beat: s.description,
  }));
  const lockedCaptionsBySegment = (pack.burnedCaptions ?? []).map((c, i) => ({
    segment: i + 1,
    spoken_line: (c ?? "").trim(),
  }));

  const promptObject = {
    style: dreyvShotStylePreamble(),

    shot: {
      index: index + 1,
      of: total,
      phase,
      duration_sec: 8,
      aspect: "9:16",
      resolution: "720p",
      role: "one chronological segment of a single continuous Dreyv ad — NOT a standalone variant, remake, recap, or alternate take",
    },

    brand: {
      name: "Dreyv",
      pronunciation: "DRAVE",
    },

    mascot_lock: {
      reference_images_attached: true,
      instruction:
        "Copy the mascot exactly from the attached reference images. Solid violet (#7c3aed) owl-fox body, cream chest, cream face, dark violet eyes. The Dreyv logo mark (a rotated violet rounded-square glyph with an inner cutout) is stamped on BOTH the cream chest and the front of the violet ball cap. The mark is a SYMBOL — never the letter 'D', never any letter, never text.",
      forbidden: ["letter D on chest or cap", "missing cap", "missing chest mark", "color shift", "realistic fox or owl rendering", "fuchsia", "pink", "orange", "brown"],
    },

    subject: {
      primary: shot.mascotInShot === false ? "Dreyv product surface and physical device props" : "canonical Dreyv mascot plus the physical prop/device required by this beat",
      rule: "The subject must change behavior per the locked beat. Do not output a generic mascot idle pose.",
    },
    action: {
      locked: shot.description,
      specific_motion: motionHint,
      rule: "The mascot/device must visibly perform this action during the 8 seconds. Standing still on a blank background is a failed render.",
    },

    physical_scene: {
      set: setHint,
      props: propHint,
      background_rule: "Use a calm physical set with surfaces and depth. No blank empty white void. No decorative abstract elements.",
      screen_rule: "If a phone/laptop appears, it is a real object in the scene. Its screen may show simple non-readable interface shapes only; no floating UI and no text.",
    },

    locked_beat_for_this_segment: {
      shot_number: shot.n,
      timing: shot.timing ?? null,
      description: shot.description,
      rule: "Render exactly this action and nothing else. Do not improvise, do not swap in ideas from other segments, do not skip ahead, do not fall back to a generic Dreyv intro.",
      creative_intent: shot.toolPrompt ? shot.toolPrompt.slice(0, 700) : null,
    },

    master_storyboard: masterStoryboard,

    continuity: index === 0
      ? {
          opening: true,
          instruction: "Start with a strong, calm opening motion and establish the cinematic world through a real set, prop, and action. Hold the frame clean — no abstract garnish, no blank mascot-on-white idle shot.",
          locked_setting: setHint,
        }
      : {
          opening: false,
          reference_images_are: "the last ~1s of frames from the previous segment — match mascot pose, wardrobe, set, lighting, camera framing, palette EXACTLY",
          previous_segment_end_action: observedLastAction || previousShot?.description || "",
          previous_segment_last_spoken_words: observedLastWords || plannedPreviousCaption || "",
          locked_setting: observedSetting || setHint || openingShot.description,
          instruction:
            "Begin from the same pose, framing, setting, lighting, and action that ended the previous segment, then visibly progress into this segment's locked action. Do not restart the story, do not repeat the hook, do not reintroduce Dreyv, do not repeat any words from the previous segment's spoken line. Continue the same sentence/thought from where it left off.",
          rule_when_in_conflict:
            "If the observed prior action seems to conflict with this segment's locked beat, smoothly transition the mascot's pose into executing the locked beat rather than abandoning it.",
        },

    leads_into_next_segment: nextShot
      ? { next_beat: nextShot.description, instruction: "End mid-motion, not resolved, so the hard cut into the next segment feels intentional." }
      : { final_payoff: true, instruction: "End with a clean product payoff using mascot and physical product motion only — no text reveal, no abstract flourish." },

    audio: {
      dialogue: currentCaption ?? "",
      narration: currentCaption ?? "",
      whispered_words: "",
      reason: useExternalNarration
        ? "Dreyv replaces the final ad audio with one full-script ElevenLabs narration track in post. If this model generates speech anyway, it must speak ONLY this segment's exact line so the raw clip remains usable as fallback."
        : "Generate the native voice track for this segment using ONLY this segment's exact line. No extra words, no phoneme soup, no invented dialogue.",
      mascot_lip_sync: currentCaption
        ? `The mascot should mouth this exact line naturally: "${currentCaption}"`
        : "The mascot may move its mouth subtly but should not invent words.",
      ambience: "Subtle room tone or motion sound is fine.",
      music: pack.soundSuggestion ?? null,
    },

    on_screen_text: {
      render: false,
      rule: "Do not render any letters, words, subtitles, captions, watermarks, UI text, signs, or written numbers inside the frame. Dreyv burns captions in post.",
    },

    locked_voiceover_per_segment: {
      this_segment_speaks: currentCaption ?? "",
      all_segments: lockedCaptionsBySegment,
      rule: `Segment ${index + 1} must correspond to segment ${index + 1}'s spoken line — for pacing only. Do not preview, tease, or jump to later beats.`,
    },

    camera: {
      framing: cameraHint,
      movement: index === 0 ? motionHint : `start continuous from previous tail frames, then ${motionHint}`,
      lens_language: "cinematic 35mm/50mm language; change framing only when the locked beat requires an insert, over-shoulder, push-in, or reveal",
      rule: "Camera must serve the selected angle/format and shot action. Do not default every segment to the same centered full-body mascot frame.",
    },

    lighting: {
      key: "match the previous segment exactly",
      palette: "violet-forward, premium tech-brand",
    },

    format: pack.formatLabel ?? null,
    emotional_angle: pack.whyItWorks ?? null,

    negative_prompt: [
      "letters", "words", "captions", "subtitles", "watermarks", "UI text", "signage with readable text",
      "invented dialogue", "wrong narration", "whispered words", "gibberish speech", "phoneme soup",
      "floating particles", "glowing orbs", "lens flares", "abstract garnish",
      "blank background", "empty white void", "standing idle", "mascot standing still", "same shot again",
      "fuchsia", "pink", "gradients", "orange or brown mascot coloring",
      "realistic fox", "realistic owl",
      "letter D on chest", "letter D on cap",
      "scene restart", "title card", "intro logo reveal mid-ad",
    ],

    reshoot_note: opts?.reshootNote
      ? { reason: opts.reshootNote, instruction: "The previous attempt at this segment failed QC for the reason above. Fix it without restarting the ad." }
      : null,
  };

  return JSON.stringify(promptObject, null, 2);
}

function inferSetHint(text: string): string {
  const t = text.toLowerCase();
  if (/rooftop|skyline|terrace|city/.test(t)) return "minimal rooftop terrace with distant soft city skyline, real floor surface, no floating graphics";
  if (/cafe|coffee|espresso|barista/.test(t)) return "quiet premium cafe table set with one cup and a phone or laptop, clean background depth";
  if (/night|late|lamp|evening/.test(t)) return "minimal night desk setup with warm desk lamp, off-white wall, real tabletop, subtle violet practical accent";
  if (/phone|mobile|wallet|phantom|app|screen|tap|swipe/.test(t)) return "premium desk or hand-held phone setup, real phone in frame, off-white wall and clean tabletop";
  if (/laptop|cursor|claude|mcp|api|developer|terminal|dashboard|command/.test(t)) return "premium developer desk with one open laptop, off-white wall, clean tabletop, subtle violet object accent";
  if (/pay|invoice|bill|checkout|usdc|card/.test(t)) return "minimal checkout desk scene with a real phone and small receipt/card prop, clean tabletop, no text";
  return "premium physical studio corner with off-white wall, real tabletop, one simple prop related to the beat, and visible depth";
}

function inferPropHint(text: string): string[] {
  const t = text.toLowerCase();
  const props = new Set<string>();
  if (/phone|mobile|wallet|phantom|tap|swipe|address/.test(t)) props.add("real phone");
  if (/laptop|cursor|claude|mcp|api|developer|terminal|dashboard|command/.test(t)) props.add("real laptop");
  if (/pay|invoice|bill|checkout|usdc|card|credit/.test(t)) props.add("small card or receipt prop with no readable text");
  if (/yield|risk|rug|token|wallet|portfolio|chart|analytics/.test(t)) props.add("single device screen with non-readable chart shapes");
  if (/coffee|cafe|late|night/.test(t)) props.add("small cup or desk lamp");
  if (!props.size) props.add("one simple physical prop tied to the scene action");
  return [...props].slice(0, 3);
}

function inferCameraHint(text: string, index: number): string {
  const t = text.toLowerCase();
  if (/phone|tap|swipe|screen|wallet|checkout/.test(t)) return "over-shoulder or close insert angle on a real phone, mascot partly visible performing the action";
  if (/laptop|cursor|claude|mcp|api|terminal|dashboard/.test(t)) return "three-quarter desk angle with laptop foreground and mascot beside it, slow push-in";
  if (/reaction|surprise|caught|rug|risk/.test(t)) return "medium close-up on mascot reaction, slight push-in, physical prop still visible";
  if (/payoff|final|cta|reveal|result/.test(t)) return "clean hero three-quarter frame with mascot and device/result prop, slow resolved dolly";
  return index === 0
    ? "three-quarter establishing frame, mascot off-center with the key prop already visible"
    : "continued three-quarter frame from previous shot with a motivated insert or push-in for the new beat";
}

function inferMotionHint(text: string, index: number, total: number): string {
  const t = text.toLowerCase();
  if (/tap|swipe|scroll|paste|enter|click/.test(t)) return "mascot actively taps, swipes, or points at the physical device while the camera slowly pushes in";
  if (/pay|checkout|bill|invoice|usdc|card/.test(t)) return "mascot confirms a payment gesture on the device, then glances up calmly as the camera moves from device insert to mascot";
  if (/rug|risk|warning|caught|security/.test(t)) return "mascot leans toward the device, notices the risk, and makes one clear cautionary gesture";
  if (/yield|rank|compare|portfolio|wallet|analytics/.test(t)) return "mascot compares one clean screen result, points once, then shifts gaze to the viewer";
  if (/mcp|api|developer|cursor|claude|agent/.test(t)) return "mascot works beside a laptop, gestures from the screen to the viewer, with small natural body movement";
  if (index === 0) return "mascot enters or turns into the scene and immediately begins the first beat's action";
  if (index === total - 1) return "mascot completes the final payoff gesture and settles without a text reveal";
  return "mascot continues from the prior pose into one new visible action for this beat";
}

function fullNarrationText(pack: Pack): string {
  const script = pack.voiceoverScript?.replace(/\s+/g, " ").trim();
  if (script) return script;
  return (pack.burnedCaptions ?? [])
    .map((caption) => caption?.replace(/\s+/g, " ").trim())
    .filter((caption): caption is string => Boolean(caption))
    .join(" ");
}

async function narrationUrlFromEntry(entry: MasterNarrationEntry | undefined): Promise<string | undefined> {
  if (!entry?.key) return undefined;
  return presignR2Get({
    key: entry.key,
    filename: "full-narration.mp3",
    mime: "audio/mpeg",
    inline: true,
    ttlSeconds: 3600,
  }).catch((err) => {
    console.warn("[vertex-render-job] full narration presign failed:", err);
    return undefined;
  });
}

async function submitNextShotOperation(args: {
  shots: Shot[];
  pack: Pack;
  index: number;
  continuityRefs?: VeoReferenceImage[];
  previousObservation?: ShotObservation;
  reshootNote?: string;
  reshootCount?: number;
}): Promise<VertexShotOperation> {
  const shot = args.shots[args.index];
  // Shot 1: lock to canonical mascot poses. Shots 2+: lock to the last few
  // frames of the previous shot so mascot + scene + camera carry forward
  // without any Gemini repaint in the loop.
  let refs = args.continuityRefs?.length ? args.continuityRefs : await loadDreyvMascotReferences();
  // On shot 1 (no continuity refs yet) blend in real prop/set anchors when the
  // beat calls for a phone/laptop/desk — Veo caps refs at 3 so we swap the
  // tail mascot poses for props rather than appending.
  if (!args.continuityRefs?.length) {
    const propRefs = await resolvePropRefsForShot(shot.description ?? "");
    if (propRefs.length) {
      refs = [...refs.slice(0, Math.max(1, 3 - propRefs.length)), ...propRefs].slice(0, 3);
    }
  }
  const op = await submitVertexVeoOperation(
    shotPrompt(shot, args.index, args.shots.length, args.pack, {
      previousObservation: args.previousObservation,
      reshootNote: args.reshootNote,
    }),
    { referenceImages: refs },
  );
  return {
    n: shot.n ?? args.index + 1,
    operationName: op.operationName,
    submittedAt: new Date().toISOString(),
    ...(args.reshootCount ? { reshootCount: args.reshootCount } : {}),
  };
}

async function tailRefsFor(url: string | undefined): Promise<VeoReferenceImage[] | undefined> {
  if (!url) return undefined;
  return extractTailFramesAsRefs(url, 3).catch((err) => {
    console.warn("[vertex-render-job] tail frame extraction failed, falling back to mascot refs:", err);
    return undefined;
  });
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
          duration_sec = ${Math.round(args.durationSec)},

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
        duration_sec = ${Math.round(args.durationSec)},
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
        const continuityRefs = await tailRefsFor(previousShot?.url);
        const replacement = await submitNextShotOperation({
          shots,
          pack,
          index: Math.max(0, Math.min(pendingIndex, shots.length - 1)),
          continuityRefs,
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
        // ElevenLabs overrides Veo's audio during normalize — don't reshoot
        // the video for Veo's gibberish audio when it'll be replaced anyway.
        const ignoreAudio = isElevenLabsConfigured();
        const observation = await observeShot(poll.url, { expectedNarration, ignoreAudio }).catch((err) => {

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
          const continuityRefs = await tailRefsFor(prevShot?.url);
          const reshoot = await submitNextShotOperation({
            shots,
            pack,
            index: reshootIndex,
            continuityRefs,
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
          const continuityRefs = await tailRefsFor(poll.url);
          const nextOperation = await submitNextShotOperation({
            shots,
            pack,
            index: completedCount,
            continuityRefs,
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
      const existingNarrations = stitchBase.narrations ?? [];
      const persistMasterNarration = async (masterNarration: MasterNarrationEntry) => {
        await savePack(
          jobId,
          {
            ...pack,
            __renderState: {
              ...state,
              stitch: { ...stitchBase, masterNarration, phase: "normalizing" },
            },
          },
          { status: "stitching" },
        );
      };
      try {
        // Correct audio architecture: synthesize ONE full-script narration for
        // the whole ad, then mux it during final concat. Per-shot TTS is what
        // made good 8s visuals shrink to one-sentence chunks.
        let masterNarration = stitchBase.masterNarration;
        const narrationText = fullNarrationText(pack);
        if (isElevenLabsConfigured() && narrationText && !masterNarration?.key && masterNarration?.status !== "failed") {
          masterNarration = { status: "synthesizing", updatedAt: new Date().toISOString() };
          await persistMasterNarration(masterNarration);
          try {
            const narration = await synthesizeFullNarration({
              jobId,
              text: narrationText,
            });
            masterNarration = {
              status: "ready",
              key: narration.key,
              bytes: narration.bytes,
              updatedAt: new Date().toISOString(),
            };
            await persistMasterNarration(masterNarration);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn("[vertex-render-job] ElevenLabs full narration failed (using Veo audio):", err);
            masterNarration = { status: "failed", reason: reason.slice(0, 200), updatedAt: new Date().toISOString() };
            await persistMasterNarration(masterNarration);
          }
        } else if (!masterNarration) {
          masterNarration = {
            status: "skipped",
            reason: !isElevenLabsConfigured() ? "ElevenLabs disabled or missing" : "no voiceover script",
            updatedAt: new Date().toISOString(),
          };
          await persistMasterNarration(masterNarration);
        }
        const segment = await normalizeSegment({
          jobId,
          shotUrl: shotUrls[nextIndex],
          index: nextIndex,
          caption: pack.burnedCaptions?.[nextIndex],
          colorGrade: false,
          upscaleTo1080: true,
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
            narrations: existingNarrations,
            masterNarration,
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
          stitch: {
            ...stitchBase,
            attempts: stitchAttempts + 1,
            phase: "normalizing",
            segments: existingSegments,
            narrations: existingNarrations,
            masterNarration: stitchBase.masterNarration,
          },
        };
        await savePack(jobId, { ...pack, __renderState: nextState }, { status: "stitching" });
        throw new Error(`normalizeSegment[${nextIndex}] failed: ${message}`);
      }
    }

    // Phase 2 — every segment present, concat-copy into the final MP4.
    let stitchBase = state.stitch ?? {
      submittedAt: new Date().toISOString(),
      durationSec: shotUrls.length * 8,
    };
    // Recovery path for jobs that normalized all segments before the new
    // master-narration pipeline existed: create the full-script track here so
    // final concat still gets the complete message instead of legacy per-shot
    // fragments or raw Veo gibberish.
    if (!stitchBase.masterNarration || stitchBase.masterNarration.status === "synthesizing") {
      const narrationText = fullNarrationText(pack);
      let masterNarration: MasterNarrationEntry;
      if (isElevenLabsConfigured() && narrationText) {
        masterNarration = { status: "synthesizing", updatedAt: new Date().toISOString() };
        await savePack(jobId, { ...pack, __renderState: { ...state, stitch: { ...stitchBase, masterNarration } } }, { status: "stitching" });
        try {
          const narration = await synthesizeFullNarration({ jobId, text: narrationText });
          masterNarration = { status: "ready", key: narration.key, bytes: narration.bytes, updatedAt: new Date().toISOString() };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn("[vertex-render-job] ElevenLabs full narration failed before concat (using Veo audio):", err);
          masterNarration = { status: "failed", reason: reason.slice(0, 200), updatedAt: new Date().toISOString() };
        }
      } else {
        masterNarration = {
          status: "skipped",
          reason: !isElevenLabsConfigured() ? "ElevenLabs disabled or missing" : "no voiceover script",
          updatedAt: new Date().toISOString(),
        };
      }
      stitchBase = { ...stitchBase, masterNarration };
      await savePack(jobId, { ...pack, __renderState: { ...state, stitch: stitchBase } }, { status: "stitching" });
    }
    const concatState: VertexRenderState = {
      ...state,
      stitch: { ...stitchBase, attempts: stitchAttempts + 1, phase: "concat", segments: existingSegments },
    };
    await savePack(jobId, { ...pack, __renderState: concatState }, { status: "stitching" });

    const narrationUrl = await narrationUrlFromEntry(stitchBase.masterNarration);

    const stitched = await concatSegments({
      jobId,
      segments: existingSegments,
      durationSec: shotUrls.length * 8,
      narrationUrl,
    });
    const masterNarration = stitchBase.masterNarration?.key
      ? { ...stitchBase.masterNarration, status: "muxed" as const, updatedAt: new Date().toISOString() }
      : stitchBase.masterNarration;
    const nextPack: Pack = {
      ...pack,
      __renderState: {
        ...concatState,
        stitch: {
          ...stitchBase,
          attempts: stitchAttempts + 1,
          phase: "done",
          segments: existingSegments,
          masterNarration,
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
