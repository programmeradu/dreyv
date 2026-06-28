/**
 * Chunked ffmpeg stitcher for Vercel.
 *
 * Vercel lambdas cap at 5 min, so we never re-encode N shots in a single
 * invocation. Instead each call does ONE of:
 *   - normalizeSegment(): download shot N, normalize/grade/upscale/caption-burn,
 *     upload the segment to R2. Single 8s shot fits well under the lambda cap.
 *   - concatSegments(): download every normalized segment, rebuild one clean
 *     timeline, optionally replace the full ad audio with a master narration,
 *     upload the final MP4.
 *
 * The caller (vertex-render-job) persists segment keys between invocations
 * and the Inngest worker loop nudges the job until every chunk is done.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";
import { isR2Configured, putR2Object, presignR2Get } from "@/lib/agents/artifacts/r2-storage";

const FONT_PATH = path.join(process.cwd(), "public", "fonts", "Manrope-SemiBold.ttf");

function ffmpegPath(): string {
  if (ffmpegStaticPath && existsSync(ffmpegStaticPath)) return ffmpegStaticPath;
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function runFfmpeg(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += String(c); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

/**
 * Probe an audio/video file's duration in seconds by decoding it to null with
 * ffmpeg. Avoids needing a separate ffprobe binary (ffmpeg-static ships only
 * ffmpeg). Returns null if duration can't be parsed.
 */
async function probeDurationSec(file: string, cwd: string): Promise<number | null> {
  try {
    const stderr = await runFfmpeg(["-hide_banner", "-i", file, "-f", "null", "-"], cwd);
    const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    if (matches.length) {
      const m = matches[matches.length - 1];
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      if (Number.isFinite(sec) && sec > 0) return sec;
    }
    const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (dm) {
      const sec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
      if (Number.isFinite(sec) && sec > 0) return sec;
    }
  } catch (err) {
    console.warn(`[stitcher] probeDurationSec failed for ${file}:`, err);
  }
  return null;
}

let drawtextAvailable: boolean | null = null;
async function hasDrawtextFilter(): Promise<boolean> {
  if (drawtextAvailable !== null) return drawtextAvailable;
  drawtextAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-filters"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (c) => { out += String(c); });
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(/\bdrawtext\b/.test(out)));
  });
  return drawtextAvailable;
}

function wrapCaption(text: string, maxChars = 26): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) { cur = w; continue; }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join("\n");
}

function videoFilter(opts: { caption?: string; captionFile?: string; colorGrade?: boolean; upscaleTo1080?: boolean }): string {
  const target = opts.upscaleTo1080 ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
  const chain: string[] = [
    `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    "fps=30",
  ];
  if (opts.colorGrade) {
    chain.push("curves=preset=increase_contrast");
    chain.push("eq=saturation=1.08:contrast=1.04:gamma=0.98");
  }
  if (opts.captionFile && existsSync(FONT_PATH)) {
    const fontfile = FONT_PATH.replace(/\\/g, "/").replace(/:/g, "\\:");
    const tf = opts.captionFile.replace(/\\/g, "/").replace(/:/g, "\\:");
    const fontsize = Math.round(target.w * 0.055);
    chain.push(
      `drawtext=fontfile='${fontfile}':textfile='${tf}':reload=0:fontcolor=white:fontsize=${fontsize}:line_spacing=10:box=1:boxcolor=black@0.55:boxborderw=28:x=(w-text_w)/2:y=h-(h*0.18)-text_h:fix_bounds=1`,
    );
  }
  return chain.join(",");
}

export type StitchSegment = { n: number; key: string; durationSec?: number };

export async function normalizeSegment(args: {
  jobId: string;
  shotUrl: string;
  index: number; // 0-based
  caption?: string;
  colorGrade?: boolean;
  upscaleTo1080?: boolean;
  /**
    * Legacy per-shot narration URL. Kept only as a fallback for old jobs.
    * New jobs use a single master narration in concatSegments() so individual
    * shots are NEVER shortened to match one short sentence.
   */
  narrationUrl?: string;
  /** Veo render's nominal length in seconds (upper bound, default 8). */
  shotDurationSec?: number;
}): Promise<StitchSegment> {
  if (!isR2Configured()) throw new Error("R2 must be configured for chunked stitching");
  const workdir = await mkdtemp(path.join(tmpdir(), `dreyv-seg-${args.index}-`));
  const maxDuration = args.shotDurationSec ?? 8;
  try {
    const inFile = path.join(workdir, `shot.mp4`);
    const outFile = path.join(workdir, `seg.mp4`);
    const res = await fetch(args.shotUrl);
    if (!res.ok) throw new Error(`Could not download shot ${args.index + 1} (${res.status})`);
    await writeFile(inFile, Buffer.from(await res.arrayBuffer()));

    // Pull narration locally so we can both probe its length and mux it in.
    let narrationFile: string | undefined;
    if (args.narrationUrl) {
      try {
        const r = await fetch(args.narrationUrl);
        if (r.ok) {
          narrationFile = path.join(workdir, "narration.mp3");
          await writeFile(narrationFile, Buffer.from(await r.arrayBuffer()));
        } else {
          console.warn(`[stitcher] narration fetch ${r.status} for shot ${args.index + 1}; falling back to Veo audio`);
        }
      } catch (err) {
        console.warn(`[stitcher] narration download failed for shot ${args.index + 1}:`, err);
      }
    }

    // Production rule: preserve the FULL generated visual clip. Do not trim a
    // good Veo shot down to the duration of a short narration sentence. That
    // was the root cause of 5×8s ads collapsing to ~10–12s after stitching.
    const probedShotDuration = await probeDurationSec(inFile, workdir);
    const segmentDuration = Math.round((probedShotDuration || maxDuration) * 100) / 100;

    let captionFile: string | undefined;
    if (args.caption && args.caption.trim() && (await hasDrawtextFilter())) {
      captionFile = path.join(workdir, "caption.txt");
      await writeFile(captionFile, wrapCaption(args.caption), "utf8");
    }

    const tryRun = async (mode: "narration" | "veo" | "silent") => {
      const ffmpegArgs: string[] = ["-hide_banner", "-y", "-i", inFile];
      if (mode === "narration" && narrationFile) ffmpegArgs.push("-i", narrationFile);
      if (mode === "silent") {
        ffmpegArgs.push("-f", "lavfi", "-t", String(segmentDuration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      }
      ffmpegArgs.push(
        "-vf", videoFilter({ caption: args.caption, captionFile, colorGrade: args.colorGrade, upscaleTo1080: args.upscaleTo1080 }),
      );
      if (mode === "narration" && narrationFile) {
        // Legacy fallback only. Keep the segment full-length and pad the
        // sentence if it is shorter; never shorten the picture to match audio.
        ffmpegArgs.push(
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-af", `apad,atrim=0:${segmentDuration},aresample=async=1:first_pts=0`,
        );
      } else if (mode === "silent") {
        // Even a silent fallback segment must carry an audio stream; the final
        // concat graph expects every segment to expose [v:0][a:0].
        ffmpegArgs.push(
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-af", `atrim=0:${segmentDuration},aresample=async=1:first_pts=0`,
        );
      }
      ffmpegArgs.push(
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
        "-t", String(segmentDuration),
      );
      ffmpegArgs.push("-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
      ffmpegArgs.push("-movflags", "+faststart", outFile);
      await runFfmpeg(ffmpegArgs, workdir);
    };

    // Prefer ElevenLabs narration → fall back to Veo audio → fall back to silent.
    if (narrationFile) {
      try { await tryRun("narration"); }
      catch (err) {
        console.warn(`[stitcher] narration mux failed for shot ${args.index + 1}, falling back to Veo audio:`, err);
        try { await tryRun("veo"); } catch { await tryRun("silent"); }
      }
    } else {
      try { await tryRun("veo"); } catch { await tryRun("silent"); }
    }

    const body = await readFile(outFile);
    const key = `studio/video/segments/${args.jobId}/${String(args.index + 1).padStart(2, "0")}.mp4`;
    await putR2Object({ key, body, mime: "video/mp4", filename: `seg-${args.index + 1}.mp4` });
    return { n: args.index, key, durationSec: segmentDuration };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function concatSegments(args: {
  jobId: string;
  segments: StitchSegment[]; // expected pre-sorted by n
  durationSec: number;
  narrationUrl?: string;
}): Promise<{ url: string; key: string; durationSec: number }> {
  if (!isR2Configured()) throw new Error("R2 must be configured for chunked stitching");
  if (args.segments.length < 2) throw new Error("At least two segments required to concat");
  const workdir = await mkdtemp(path.join(tmpdir(), `dreyv-concat-${args.jobId}-`));
  try {
    const files: string[] = [];
    for (let i = 0; i < args.segments.length; i += 1) {
      const seg = args.segments[i];
      const local = path.join(workdir, `seg-${String(i + 1).padStart(2, "0")}.mp4`);
      const signed = await presignR2Get({ key: seg.key, filename: `seg-${i + 1}.mp4`, mime: "video/mp4", inline: true, ttlSeconds: 600 });
      const res = await fetch(signed);
      if (!res.ok) throw new Error(`Missing segment ${seg.n + 1} (${seg.key}) — fetch ${res.status}`);
      await writeFile(local, Buffer.from(await res.arrayBuffer()));
      files.push(local);
    }
    const listFile = path.join(workdir, "concat.txt");
    await writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    let narrationFile: string | undefined;
    let narrationDuration: number | null = null;
    if (args.narrationUrl) {
      const r = await fetch(args.narrationUrl);
      if (!r.ok) throw new Error(`Could not download master narration (${r.status})`);
      narrationFile = path.join(workdir, "master-narration.mp3");
      await writeFile(narrationFile, Buffer.from(await r.arrayBuffer()));
      narrationDuration = await probeDurationSec(narrationFile, workdir);
    }

    const outFile = path.join(workdir, "final.mp4");
    // Re-encode the concat. Stream-copy (`-c copy`) silently truncates the
    // output to the first segment's duration when segments have mismatched
    // timebases / SPS-PPS / audio frame boundaries (the "final video is only
    // 12s" bug). Re-encoding through the concat filter rebuilds one clean
    // timeline. 5×8s of 720p/1080p fits well under the Vercel lambda cap.
    const n = files.length;
    const inputs: string[] = [];
    for (const f of files) inputs.push("-i", f);
    if (narrationFile) inputs.push("-i", narrationFile);
    const measured = args.segments.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
    const visualDuration = measured > 0 ? Math.round(measured * 100) / 100 : args.durationSec;
    // Never cut the visuals, and never cut the full-script narration. If the
    // voiceover runs slightly longer than the stitched scenes, extend only the
    // final frame instead of trimming words off the ad's message.
    const finalDuration = Math.round(Math.max(visualDuration, narrationDuration ?? 0) * 100) / 100;
    const videoPad = Math.max(0, Math.round((finalDuration - visualDuration) * 100) / 100);
    const filter = narrationFile
      ? `${files.map((_, i) => `[${i}:v:0]`).join("")}concat=n=${n}:v=1:a=0[vcat]${videoPad > 0.05 ? `;[vcat]tpad=stop_mode=clone:stop_duration=${videoPad}[vout]` : ""}`
      : `${files.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("")}concat=n=${n}:v=1:a=1[vcat][scratcha]`;
    const mapArgs = narrationFile
      ? ["-map", videoPad > 0.05 ? "[vout]" : "[vcat]", "-map", `${n}:a:0`, "-af", `apad,atrim=0:${finalDuration},aresample=async=1:first_pts=0`]
      : ["-map", "[vcat]", "-map", "[scratcha]"];
    try {
      await runFfmpeg(
        [
          "-hide_banner", "-y",
          ...inputs,
          "-filter_complex", filter,
          ...mapArgs,
          "-t", String(finalDuration),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
          "-movflags", "+faststart",
          outFile,
        ],
        workdir,
      );
    } catch (err) {
      if (narrationFile) throw err;
      // Legacy recovery: some old normalized chunks were created with no audio
      // stream. Keep the full visual timeline and attach silence rather than
      // failing or trimming scenes.
      console.warn("[stitcher] audio concat failed; retrying video-only with silent track:", err);
      await runFfmpeg(
        [
          "-hide_banner", "-y",
          ...inputs,
          "-f", "lavfi", "-t", String(finalDuration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-filter_complex", `${files.map((_, i) => `[${i}:v:0]`).join("")}concat=n=${n}:v=1:a=0[vcat]`,
          "-map", "[vcat]", "-map", `${n}:a:0`,
          "-t", String(finalDuration),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
          "-movflags", "+faststart",
          outFile,
        ],
        workdir,
      );
    }
    const body = await readFile(outFile);
    const key = `studio/video/final-${args.jobId}-${Date.now()}.mp4`;
    await putR2Object({ key, body, mime: "video/mp4", filename: "dreyv-final-ad.mp4" });
    const url = await presignR2Get({ key, filename: "dreyv-final-ad.mp4", mime: "video/mp4", inline: true, ttlSeconds: 3600 });
    return { url, key, durationSec: finalDuration };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
