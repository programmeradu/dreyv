/**
 * ElevenLabs narration synthesis for the Dreyv Video Studio.
 *
 * Why this exists:
 *   Veo's native audio track is unreliable — it drops words, goes silent, or
 *   produces phoneme soup. We override it entirely by generating per-shot
 *   narration with ElevenLabs (turbo v2.5) and muxing it onto the silent
 *   Veo render during the normalize pass.
 *
 * Continuity:
 *   Uses ElevenLabs request stitching (`previous_text` / `next_text`) so
 *   prosody flows across shots and the locked voice stays consistent.
 *
 * Persistence:
 *   Each narration is uploaded to R2 under
 *     studio/video/narration/<jobId>/<shotIndex>.mp3
 *   so reshoots and lambda restarts can reuse it without re-paying ElevenLabs.
 */
import { isR2Configured, putR2Object, presignR2Get } from "@/lib/agents/artifacts/r2-storage";

// Voice ID locked for the Dreyv mascot. Default "Adam" (warm, energetic,
// founder-narrator) — the previous "Brian" pick read flat and monotone for
// short ad shots. Override per-deploy via ELEVENLABS_DREYV_VOICE_ID.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DREYV_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
const MODEL_ID = "eleven_turbo_v2_5";

export function isElevenLabsConfigured(): boolean {
  const mode = process.env.MEDIA_STUDIO_ELEVENLABS_MODE?.trim().toLowerCase();
  if (mode === "off" || mode === "disabled" || mode === "false") return false;
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export type ShotNarrationInput = {
  jobId: string;
  index: number; // 0-based shot index
  text: string;
  previousText?: string;
  nextText?: string;
  voiceId?: string;
};

export type ShotNarrationResult = {
  index: number;
  key: string;
  url: string;
  bytes: number;
};

export type FullNarrationInput = {
  jobId: string;
  text: string;
  voiceId?: string;
};

export type FullNarrationResult = {
  key: string;
  url: string;
  bytes: number;
};

function narrationRequestBody(text: string): Record<string, unknown> {
  return {
    text,
    model_id: MODEL_ID,
    voice_settings: {
      // Expressive enough for ads, but not so unstable that the same Dreyv
      // voice changes line-to-line. Full-script generation now handles flow.
      stability: 0.42,
      similarity_boost: 0.86,
      style: 0.48,
      use_speaker_boost: true,
      speed: 1.02,
    },
  };
}

/**
 * Synthesize one shot's narration to MP3 and persist to R2.
 * Throws on any error — the caller decides whether to fall back to Veo audio.
 */
export async function synthesizeShotNarration(input: ShotNarrationInput): Promise<ShotNarrationResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing — cannot synthesize narration");
  if (!isR2Configured()) throw new Error("R2 must be configured to persist narration");
  const text = input.text?.trim();
  if (!text) throw new Error(`Shot ${input.index + 1} has no narration text`);

  const voiceId = input.voiceId || DEFAULT_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

  const body = narrationRequestBody(text);
  // Request stitching keeps prosody continuous across shots.
  if (input.previousText?.trim()) body.previous_text = input.previousText.trim().slice(-600);
  if (input.nextText?.trim()) body.next_text = input.nextText.trim().slice(0, 600);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 400)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 200) throw new Error(`ElevenLabs returned suspiciously small audio (${audio.length} bytes)`);

  const key = `studio/video/narration/${input.jobId}/${String(input.index + 1).padStart(2, "0")}.mp3`;
  await putR2Object({ key, body: audio, mime: "audio/mpeg", filename: `narration-${input.index + 1}.mp3` });
  const signed = await presignR2Get({ key, filename: `narration-${input.index + 1}.mp3`, mime: "audio/mpeg", inline: true, ttlSeconds: 3600 });
  return { index: input.index, key, url: signed, bytes: audio.length };
}

/**
 * Synthesize the complete ad narration in one request.
 *
 * This is the production path. Per-shot TTS caused exactly the failure the
 * studio saw: each 8s video got cut down to a one-sentence voice clip, then
 * the final ad collapsed to ~10–12s and lost the full story. A single master
 * narration preserves the whole script, keeps prosody coherent, and lets the
 * stitcher preserve every visual segment untouched.
 */
export async function synthesizeFullNarration(input: FullNarrationInput): Promise<FullNarrationResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing — cannot synthesize narration");
  if (!isR2Configured()) throw new Error("R2 must be configured to persist narration");
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Full narration script is empty");

  const voiceId = input.voiceId || DEFAULT_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(narrationRequestBody(text)),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs full TTS ${res.status}: ${errText.slice(0, 400)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 500) throw new Error(`ElevenLabs returned suspiciously small full narration (${audio.length} bytes)`);

  const key = `studio/video/narration/${input.jobId}/full.mp3`;
  await putR2Object({ key, body: audio, mime: "audio/mpeg", filename: "full-narration.mp3" });
  const signed = await presignR2Get({ key, filename: "full-narration.mp3", mime: "audio/mpeg", inline: true, ttlSeconds: 3600 });
  return { key, url: signed, bytes: audio.length };
}

/**
 * Build the previous/next context for shot N from the captions array so
 * ElevenLabs' request stitching can smooth prosody across the cut.
 */
export function narrationContextFor(
  captions: (string | undefined)[],
  index: number,
): { previousText?: string; nextText?: string } {
  const prev = index > 0 ? captions[index - 1]?.trim() : undefined;
  const next = index < captions.length - 1 ? captions[index + 1]?.trim() : undefined;
  return { previousText: prev || undefined, nextText: next || undefined };
}
