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

const safeCwd = process.env.NEXT_RUNTIME === "edge" ? "." : (typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".");
const FONT_PATH = path.join(safeCwd, "public", "fonts", "Manrope-SemiBold.ttf");

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

/**
 * Canonical segment format. Every normalized segment is forced to these exact
 * specs so concat is a deterministic stream-copy operation — no timebase /
 * SPS-PPS / audio-frame mismatch, no retry tree.
 */
const SEG_FPS = 30;
const SEG_SAR = "1";
const SEG_SAMPLE_RATE = 48000;
const SEG_CHANNELS = 2;

export type StitchSegment = { n: number; key: string; durationSec?: number };

export async function normalizeSegment(args: {
  jobId: string;
  shotUrl: string;
  index: number; // 0-based
  caption?: string;
  colorGrade?: boolean;
  upscaleTo1080?: boolean;
  /** Ignored. Master narration is muxed at concat time. */
  narrationUrl?: string;
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

    const probed = await probeDurationSec(inFile, workdir);
    const segmentDuration = Math.round((probed || maxDuration) * 100) / 100;

    let captionFile: string | undefined;
    if (args.caption && args.caption.trim() && (await hasDrawtextFilter())) {
      captionFile = path.join(workdir, "caption.txt");
      await writeFile(captionFile, wrapCaption(args.caption), "utf8");
    }

    // Always replace Veo audio with a synthesized silent track of the exact
    // segment length. This is the key to deterministic concat: every segment
    // has identical audio codec params and frame boundaries. The master
    // narration is muxed once at concat time.
    const vf = videoFilter({
      captionFile,
      colorGrade: args.colorGrade,
      upscaleTo1080: args.upscaleTo1080,
    });
    await runFfmpeg(
      [
        "-hide_banner", "-y",
        "-i", inFile,
        "-f", "lavfi", "-t", String(segmentDuration),
        "-i", `anullsrc=channel_layout=stereo:sample_rate=${SEG_SAMPLE_RATE}`,
        "-vf", vf,
        "-map", "0:v:0", "-map", "1:a:0",
        "-r", String(SEG_FPS),
        "-vsync", "cfr",
        "-video_track_timescale", "15360",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
        "-profile:v", "high", "-level", "4.0",
        "-c:a", "aac", "-b:a", "160k",
        "-ar", String(SEG_SAMPLE_RATE), "-ac", String(SEG_CHANNELS),
        "-t", String(segmentDuration),
        "-movflags", "+faststart",
        outFile,
      ],
      workdir,
    );

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
    // Download all segments locally.
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

    // Step 1: stream-copy concat via the concat demuxer. Every segment was
    // normalized to identical specs in normalizeSegment(), so this is exact
    // and instant — no filter graph, no re-encode, no retry tree.
    const listFile = path.join(workdir, "concat.txt");
    await writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const concatFile = path.join(workdir, "concat.mp4");
    await runFfmpeg(
      [
        "-hide_banner", "-y",
        "-f", "concat", "-safe", "0",
        "-i", listFile,
        "-c", "copy",
        "-movflags", "+faststart",
        concatFile,
      ],
      workdir,
    );

    const visualDuration = Math.round(
      (args.segments.reduce((a, s) => a + (s.durationSec ?? 0), 0) || args.durationSec) * 100,
    ) / 100;

    // Step 2: if there is a master narration, mux it over the concatenated
    // video. Stream-copy the video so we never re-encode the full timeline.
    let outFile = concatFile;
    let finalDuration = visualDuration;
    if (args.narrationUrl) {
      const narrationFile = path.join(workdir, "master-narration.mp3");
      const r = await fetch(args.narrationUrl);
      if (!r.ok) throw new Error(`Could not download master narration (${r.status})`);
      await writeFile(narrationFile, Buffer.from(await r.arrayBuffer()));
      const narrationDuration = (await probeDurationSec(narrationFile, workdir)) ?? visualDuration;
      finalDuration = Math.round(Math.max(visualDuration, narrationDuration) * 100) / 100;
      const videoPad = Math.max(0, Math.round((finalDuration - visualDuration) * 100) / 100);
      const muxed = path.join(workdir, "final.mp4");
      const vMap = videoPad > 0.05 ? ["-vf", `tpad=stop_mode=clone:stop_duration=${videoPad}`] : ["-c:v", "copy"];
      await runFfmpeg(
        [
          "-hide_banner", "-y",
          "-i", concatFile,
          "-i", narrationFile,
          "-map", "0:v:0", "-map", "1:a:0",
          ...vMap,
          "-c:a", "aac", "-b:a", "160k",
          "-ar", String(SEG_SAMPLE_RATE), "-ac", String(SEG_CHANNELS),
          "-af", `apad,atrim=0:${finalDuration},aresample=async=1:first_pts=0`,
          "-t", String(finalDuration),
          "-movflags", "+faststart",
          muxed,
        ],
        workdir,
      );
      outFile = muxed;
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
