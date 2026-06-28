/**
 * Chunked ffmpeg stitcher for Vercel.
 *
 * Vercel lambdas cap at 5 min, so we never re-encode N shots in a single
 * invocation. Instead each call does ONE of:
 *   - normalizeSegment(): download shot N, normalize/grade/upscale/caption-burn,
 *     upload the segment to R2. Single 8s shot fits well under the lambda cap
 *     even with CRF19 + 1080x1920 + drawtext.
 *   - concatSegments(): download every normalized segment, run `ffmpeg -c copy`
 *     (no re-encode, just container concat), upload the final MP4.
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

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += String(c); if (stderr.length > 6000) stderr = stderr.slice(-6000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
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

export type StitchSegment = { n: number; key: string };

export async function normalizeSegment(args: {
  jobId: string;
  shotUrl: string;
  index: number; // 0-based
  caption?: string;
  colorGrade?: boolean;
  upscaleTo1080?: boolean;
}): Promise<StitchSegment> {
  if (!isR2Configured()) throw new Error("R2 must be configured for chunked stitching");
  const workdir = await mkdtemp(path.join(tmpdir(), `dreyv-seg-${args.index}-`));
  try {
    const inFile = path.join(workdir, `shot.mp4`);
    const outFile = path.join(workdir, `seg.mp4`);
    const res = await fetch(args.shotUrl);
    if (!res.ok) throw new Error(`Could not download shot ${args.index + 1} (${res.status})`);
    await writeFile(inFile, Buffer.from(await res.arrayBuffer()));

    let captionFile: string | undefined;
    if (args.caption && args.caption.trim() && (await hasDrawtextFilter())) {
      captionFile = path.join(workdir, "caption.txt");
      await writeFile(captionFile, wrapCaption(args.caption), "utf8");
    }

    const tryRun = async (keepAudio: boolean) => {
      await runFfmpeg(
        [
          "-hide_banner", "-y",
          "-i", inFile,
          "-vf", videoFilter({ caption: args.caption, captionFile, colorGrade: args.colorGrade, upscaleTo1080: args.upscaleTo1080 }),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
          ...(keepAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"] : ["-an"]),
          "-movflags", "+faststart",
          outFile,
        ],
        workdir,
      );
    };
    try { await tryRun(true); } catch { await tryRun(false); }

    const body = await readFile(outFile);
    const key = `studio/video/segments/${args.jobId}/${String(args.index + 1).padStart(2, "0")}.mp4`;
    await putR2Object({ key, body, mime: "video/mp4", filename: `seg-${args.index + 1}.mp4` });
    return { n: args.index, key };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function concatSegments(args: {
  jobId: string;
  segments: StitchSegment[]; // expected pre-sorted by n
  durationSec: number;
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
    const outFile = path.join(workdir, "final.mp4");
    // Stream copy — no re-encode, completes in seconds even for long videos.
    await runFfmpeg(
      ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outFile],
      workdir,
    );
    const body = await readFile(outFile);
    const key = `studio/video/final-${args.jobId}-${Date.now()}.mp4`;
    await putR2Object({ key, body, mime: "video/mp4", filename: "dreyv-final-ad.mp4" });
    const url = await presignR2Get({ key, filename: "dreyv-final-ad.mp4", mime: "video/mp4", inline: true, ttlSeconds: 3600 });
    return { url, key, durationSec: args.durationSec };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
