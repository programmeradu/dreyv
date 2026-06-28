/**
 * Shot QC + observation pass.
 *
 * After Veo finishes shot N and BEFORE we submit shot N+1, this runs:
 *   1. ffmpeg probes — blackdetect / freezedetect / silencedetect / duration
 *      / resolution — catches broken clips with zero AI cost.
 *   2. Audio extract → Lovable AI STT (`openai/gpt-4o-mini-transcribe`) so
 *      we know the EXACT words spoken in the clip — not the words we asked
 *      for. The next shot's prompt continues from those real words.
 *   3. Mid + tail frame extraction → Lovable AI Gemini Flash vision call to
 *      describe the actual ending action, mascot pose, camera framing, and
 *      setting fingerprint. The next shot continues from that observed
 *      reality, not the planner's guess.
 *
 * All three providers are free under the Lovable AI Gateway (Gemini Flash is
 * uncapped for vision; gpt-4o-mini-transcribe is the default STT).
 *
 * Returns `ok=false` when ffmpeg flags a structurally broken shot (mostly
 * black, freeze > 50% of duration, no/very-short duration). The caller
 * decides whether to reshoot.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

export type ShotObservation = {
  ok: boolean;
  issues: string[];
  durationSec: number | null;
  /** What was actually spoken in the clip (whisper transcript), trimmed. */
  lastWords: string | null;
  /** 1-sentence description of the final action / mascot pose / camera. */
  lastAction: string | null;
  /** 1-sentence fingerprint of setting + lighting + palette for the next shot to match. */
  settingFingerprint: string | null;
  /** True when QC is structurally broken and the shot should be reshot. */
  needsReshoot: boolean;
  /** Structural metrics surfaced to the UI progress panel. */
  metrics?: {
    width?: number | null;
    height?: number | null;
    blackSec?: number;
    freezeSec?: number;
    silenceSec?: number;
    sceneChanges?: number;
    audioMeanDb?: number | null;
  };
};

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1";

function ffmpegBin(): string {
  if (ffmpegStaticPath && existsSync(ffmpegStaticPath)) return ffmpegStaticPath;
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function runFfmpeg(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += String(c);
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on("error", reject);
    child.on("close", () => resolve(stderr));
  });
}

function parseDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseBlackSeconds(stderr: string): number {
  let total = 0;
  for (const m of stderr.matchAll(/black_duration:(\d+\.?\d*)/g)) total += Number(m[1]);
  return total;
}

function parseFreezeSeconds(stderr: string): number {
  let total = 0;
  for (const m of stderr.matchAll(/freeze_duration:(\d+\.?\d*)/g)) total += Number(m[1]);
  return total;
}

function parseSilenceSeconds(stderr: string): number {
  let total = 0;
  for (const m of stderr.matchAll(/silence_duration:\s*(\d+\.?\d*)/g)) total += Number(m[1]);
  return total;
}

function parseSceneChanges(stderr: string): number {
  // scdet emits "scene_score:NN" — count occurrences as a rough cut count.
  let count = 0;
  for (const _ of stderr.matchAll(/lavfi\.scd\.score:/g)) count += 1;
  // Fallback: scdet stderr lines.
  if (count === 0) {
    for (const _ of stderr.matchAll(/scdet @ .*score:\s*\d/g)) count += 1;
  }
  return count;
}

function parseResolution(stderr: string): { width: number | null; height: number | null } {
  const m = stderr.match(/Stream #\d+:\d+.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!m) return { width: null, height: null };
  return { width: Number(m[1]), height: Number(m[2]) };
}

function parseAudioMeanDb(stderr: string): number | null {
  const m = stderr.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
  return m ? Number(m[1]) : null;
}

async function probe(inFile: string, cwd: string) {
  const stderr = await runFfmpeg(
    [
      "-hide_banner",
      "-i", inFile,
      "-vf", "blackdetect=d=0.4:pix_th=0.1,freezedetect=n=-60dB:d=0.5,scdet=threshold=10",
      "-af", "silencedetect=noise=-50dB:d=0.5,volumedetect",
      "-f", "null", "-",
    ],
    cwd,
  );
  const duration = parseDuration(stderr);
  const blackSec = parseBlackSeconds(stderr);
  const freezeSec = parseFreezeSeconds(stderr);
  const silenceSec = parseSilenceSeconds(stderr);
  const sceneChanges = parseSceneChanges(stderr);
  const { width, height } = parseResolution(stderr);
  const audioMeanDb = parseAudioMeanDb(stderr);
  return { duration, blackSec, freezeSec, silenceSec, sceneChanges, width, height, audioMeanDb };
}

async function extractAudioMp3(inFile: string, cwd: string): Promise<Buffer | null> {
  const outFile = path.join(cwd, "audio.mp3");
  await runFfmpeg(
    ["-hide_banner", "-y", "-i", inFile, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outFile],
    cwd,
  );
  try { return await readFile(outFile); } catch { return null; }
}

async function extractFramePng(inFile: string, cwd: string, atSec: string, name: string): Promise<Buffer | null> {
  const outFile = path.join(cwd, name);
  const stderr = await runFfmpeg(
    ["-hide_banner", "-y", "-ss", atSec, "-i", inFile, "-frames:v", "1", "-q:v", "2", outFile],
    cwd,
  );
  try { return await readFile(outFile); } catch {
    console.warn("[shot-qc] frame extract failed:", stderr.slice(-200));
    return null;
  }
}

async function transcribeAudio(mp3: Buffer): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const fd = new FormData();
    fd.append("model", "openai/gpt-4o-mini-transcribe");
    fd.append("file", new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }), "shot.mp3");
    const res = await fetch(`${LOVABLE_GATEWAY}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    if (!res.ok) {
      console.warn("[shot-qc] STT failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as { text?: string };
    return json.text?.trim() || null;
  } catch (err) {
    console.warn("[shot-qc] STT exception:", err);
    return null;
  }
}

async function describeFrames(frames: Array<{ png: Buffer; label: string }>): Promise<{
  lastAction: string | null;
  settingFingerprint: string | null;
}> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || frames.length === 0) return { lastAction: null, settingFingerprint: null };
  try {
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: [
        "These frames are sampled from a just-rendered 8-second vertical ad clip starring the Dreyv violet owl mascot.",
        "Return STRICT JSON (no prose) with exactly these keys:",
        '{"lastAction": "<one short sentence describing the mascot pose, gesture, and camera framing in the LAST frame>",',
        ' "settingFingerprint": "<one short sentence locking the environment, lighting, time of day, palette, and any key props for the next clip to match exactly>"}',
        "Be concrete. No marketing language. No quotes around the values inside the strings.",
      ].join("\n") },
    ];
    for (const f of frames) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${f.png.toString("base64")}` },
      });
    }
    const res = await fetch(`${LOVABLE_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      console.warn("[shot-qc] vision failed:", res.status, (await res.text()).slice(0, 200));
      return { lastAction: null, settingFingerprint: null };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content?.trim();
    if (!raw) return { lastAction: null, settingFingerprint: null };
    const parsed = JSON.parse(raw) as { lastAction?: string; settingFingerprint?: string };
    return {
      lastAction: parsed.lastAction?.trim() || null,
      settingFingerprint: parsed.settingFingerprint?.trim() || null,
    };
  } catch (err) {
    console.warn("[shot-qc] vision exception:", err);
    return { lastAction: null, settingFingerprint: null };
  }
}

function normalizeWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
}

function jaccardOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / new Set([...A, ...B]).size;
}

/**
 * Cheap gibberish heuristic: high ratio of tokens that have no vowels, are
 * single letters, or are long random consonant clusters → transcription of
 * Veo audio that's actually mumbled / non-English / phoneme soup.
 */
function gibberishRatio(words: string[]): number {
  if (!words.length) return 0;
  let bad = 0;
  for (const w of words) {
    const hasVowel = /[aeiouy]/.test(w);
    const longConsonants = /[bcdfghjklmnpqrstvwxz]{5,}/.test(w);
    if (!hasVowel && w.length > 2) bad += 1;
    else if (longConsonants) bad += 1;
    else if (w.length === 1 && !"ai".includes(w)) bad += 1;
  }
  return bad / words.length;
}

export async function observeShot(
  videoUrl: string,
  opts?: { expectedNarration?: string | null; ignoreAudio?: boolean },
): Promise<ShotObservation> {
  const ignoreAudio = opts?.ignoreAudio === true;

  const work = await mkdtemp(path.join(tmpdir(), "dreyv-qc-"));
  const issues: string[] = [];
  let needsReshoot = false;
  let durationSec: number | null = null;
  let lastWords: string | null = null;
  let lastAction: string | null = null;
  let settingFingerprint: string | null = null;

  try {
    const inFile = path.join(work, "in.mp4");
    const res = await fetch(videoUrl);
    if (!res.ok) {
      return { ok: false, issues: [`download ${res.status}`], durationSec: null, lastWords: null, lastAction: null, settingFingerprint: null, needsReshoot: false };
    }
    await writeFile(inFile, Buffer.from(await res.arrayBuffer()));

    // 1. Structural probe.
    const probed = await probe(inFile, work);
    durationSec = probed.duration;
    if (!durationSec || durationSec < 2) {
      issues.push(`duration ${durationSec ?? 0}s (too short)`);
      needsReshoot = true;
    }
    if (durationSec && probed.blackSec > durationSec * 0.4) {
      issues.push(`black ${probed.blackSec.toFixed(1)}s of ${durationSec.toFixed(1)}s`);
      needsReshoot = true;
    }
    if (durationSec && probed.freezeSec > durationSec * 0.5) {
      issues.push(`freeze ${probed.freezeSec.toFixed(1)}s of ${durationSec.toFixed(1)}s`);
      needsReshoot = true;
    }
    if (!ignoreAudio && durationSec && probed.silenceSec > durationSec * 0.6) {
      // More than 60% of the clip is silent — Veo dropped most of the VO.
      issues.push(`silence ${probed.silenceSec.toFixed(1)}s of ${durationSec.toFixed(1)}s`);
      needsReshoot = true;
    }
    if (!ignoreAudio && probed.audioMeanDb !== null && probed.audioMeanDb < -50) {
      issues.push(`audio mean ${probed.audioMeanDb.toFixed(1)}dB (effectively silent)`);
      needsReshoot = true;
    }

    // Detect "model recycled the same frame" — zero scene cuts AND high freeze.
    if (durationSec && probed.sceneChanges === 0 && probed.freezeSec > durationSec * 0.3) {
      issues.push(`no motion (0 scene changes, freeze ${probed.freezeSec.toFixed(1)}s)`);
      needsReshoot = true;
    }
    // Veo should always return 9:16. Anything else means the wrong aspect leaked through.
    if (probed.width && probed.height && probed.width > probed.height) {
      issues.push(`wrong aspect ${probed.width}x${probed.height} (expected portrait 9:16)`);
      needsReshoot = true;
    }

    // 2 + 3 run in parallel — independent IO.
    const mid = durationSec ? (durationSec / 2).toFixed(2) : "1";
    const tail = durationSec ? Math.max(0, durationSec - 0.2).toFixed(2) : "1";
    const [mp3, midPng, tailPng] = await Promise.all([
      extractAudioMp3(inFile, work),
      extractFramePng(inFile, work, mid, "mid.png"),
      extractFramePng(inFile, work, tail, "tail.png"),
    ]);

    const [transcript, vision] = await Promise.all([
      !ignoreAudio && mp3 && mp3.byteLength > 1024 ? transcribeAudio(mp3) : Promise.resolve(null),
      describeFrames(
        [midPng && { png: midPng, label: "mid" }, tailPng && { png: tailPng, label: "tail" }]
          .filter((x): x is { png: Buffer; label: string } => Boolean(x)),
      ),
    ]);
    lastWords = transcript;
    lastAction = vision.lastAction;
    settingFingerprint = vision.settingFingerprint;

    // 4. Narration validation — only meaningful when keeping Veo's audio.
    // When ElevenLabs overrides the track during normalize, Veo's raw audio is
    // expected to be gibberish/silence and must NOT trigger a reshoot.
    if (!ignoreAudio) {
      const expected = opts?.expectedNarration?.trim() || "";
      const expectedWords = expected ? normalizeWords(expected) : [];
      const spokenWords = transcript ? normalizeWords(transcript) : [];

      if (expectedWords.length >= 4) {
        if (spokenWords.length < Math.max(3, Math.floor(expectedWords.length * 0.4))) {
          issues.push(`spoke ${spokenWords.length}/${expectedWords.length} expected words ("${transcript ?? ""}")`);
          needsReshoot = true;
        } else {
          const overlap = jaccardOverlap(expectedWords, spokenWords);
          if (overlap < 0.2) {
            issues.push(`transcript drifted from script (overlap ${(overlap * 100).toFixed(0)}%): "${transcript ?? ""}"`);
            needsReshoot = true;
          }
        }
      } else if (spokenWords.length >= 3) {
        const ratio = gibberishRatio(spokenWords);
        if (ratio > 0.5) {
          issues.push(`gibberish transcript (${(ratio * 100).toFixed(0)}% non-words): "${transcript ?? ""}"`);
          needsReshoot = true;
        }
      }

      if (spokenWords.length >= 4 && gibberishRatio(spokenWords) > 0.55) {
        issues.push(`audio sounds non-English / phonetic soup: "${transcript ?? ""}"`);
        needsReshoot = true;
      }
    }


    return {
      ok: !needsReshoot && issues.length === 0,
      issues,
      durationSec,
      lastWords,
      lastAction,
      settingFingerprint,
      needsReshoot,
      metrics: {
        width: probed.width,
        height: probed.height,
        blackSec: probed.blackSec,
        freezeSec: probed.freezeSec,
        silenceSec: probed.silenceSec,
        sceneChanges: probed.sceneChanges,
        audioMeanDb: probed.audioMeanDb,
      },
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
