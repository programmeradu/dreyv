/**
 * Local ffmpeg stitch + post pipeline for the Dreyv Video Studio.
 *
 * Tight v2 post stack (runs after Veo 3.1 returns each shot):
 *   1. Download every shot to a temp workdir.
 *   2. Normalize each shot to a consistent 720x1280 / 30fps / AAC frame.
 *      - Optional cinematic LUT pass (curves + subtle saturation/contrast).
 *      - Optional burned caption per shot via drawtext + bundled Manrope.
 *      - Optional 1080x1920 upscale (lanczos).
 *   3. Concat with stream copy when no post is needed, otherwise concat the
 *      re-encoded normalized shots.
 *   4. Push the final MP4 to R2 and return a presigned inline URL.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";
import { isR2Configured, putR2Object, presignR2Get } from "@/lib/agents/artifacts/r2-storage";

type StitchResult = { url: string; key?: string; durationSec: number };

const SHOT_DURATION_SEC = 8;

const FONT_PATH = path.join(process.cwd(), "public", "fonts", "Manrope-SemiBold.ttf");

function ffmpegPath(): string {
  if (ffmpegStaticPath && existsSync(ffmpegStaticPath)) return ffmpegStaticPath;
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

/**
 * The bundled ffmpeg-static binary is compiled WITHOUT libfreetype on some
 * platforms, so the `drawtext` filter is missing. Probe once per process and
 * cache. When absent, caption burn-in is silently skipped so the stitch still
 * succeeds — captions just won't render on that deploy.
 */
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
  if (!drawtextAvailable) {
    console.warn("[stitcher] ffmpeg lacks drawtext filter — captions skipped");
  }
  return drawtextAvailable;
}

async function downloadShot(url: string, filePath: string, index: number): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download shot ${index + 1} (${res.status})`);
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
}

function concatList(files: string[]): string {
  return files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
}

async function concatCopy(files: string[], listFile: string, outputFile: string, workdir: string) {
  await writeFile(listFile, concatList(files));
  await runFfmpeg(
    ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outputFile],
    workdir,
  );
}

/** Hard-wrap a caption to ~maxChars per line on word boundaries. */
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
  // Cap at 3 lines so a runaway caption never covers the whole frame.
  return lines.slice(0, 3).join("\n");
}

type PostOptions = {
  caption?: string;
  captionFile?: string; // resolved by normalizeShot — path to a UTF-8 text file
  colorGrade?: boolean;
  upscaleTo1080?: boolean;
};

function buildVideoFilter(opts: PostOptions): string {
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
  // textfile= reads the caption from disk, so we sidestep every drawtext
  // escaping pitfall (commas, quotes, colons, percent signs, newlines that
  // were previously silently breaking the filter and causing the stitcher to
  // fall back to a no-caption, sometimes-silent re-encode).
  if (opts.captionFile && existsSync(FONT_PATH)) {
    const fontfile = FONT_PATH.replace(/\\/g, "/").replace(/:/g, "\\:");
    const tf = opts.captionFile.replace(/\\/g, "/").replace(/:/g, "\\:");
    const fontsize = Math.round(target.w * 0.055);
    chain.push(
      [
        "drawtext=",
        `fontfile='${fontfile}'`,
        `:textfile='${tf}'`,
        `:reload=0`,
        `:fontcolor=white`,
        `:fontsize=${fontsize}`,
        `:line_spacing=10`,
        `:box=1:boxcolor=black@0.55:boxborderw=28`,
        `:x=(w-text_w)/2`,
        `:y=h-(h*0.18)-text_h`,
        `:fix_bounds=1`,
      ].join(""),
    );
  }
  return chain.join(",");
}

async function normalizeShot(input: string, output: string, workdir: string, keepAudio: boolean, post: PostOptions) {
  let captionFile: string | undefined;
  if (post.caption && post.caption.trim() && (await hasDrawtextFilter())) {
    captionFile = path.join(workdir, `caption-${path.basename(output, ".mp4")}.txt`);
    await writeFile(captionFile, wrapCaption(post.caption), "utf8");
  }
  await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-i",
      input,
      "-vf",
      buildVideoFilter({ ...post, captionFile }),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "19",
      ...(keepAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"] : ["-an"]),
      "-movflags",
      "+faststart",
      output,
    ],
    workdir,
  );
}

async function normalizeAll(inputs: string[], workdir: string, keepAudio: boolean, perShot: PostOptions[]): Promise<string[]> {
  const suffix = keepAudio ? "norm" : "silent";
  const outputs = inputs.map((_, i) => path.join(workdir, `${suffix}-${String(i + 1).padStart(2, "0")}.mp4`));
  for (let i = 0; i < inputs.length; i += 1) {
    await normalizeShot(inputs[i], outputs[i], workdir, keepAudio, perShot[i] ?? {});
  }
  return outputs;
}

/**
 * Stitch Veo shots locally with ffmpeg, then persist the single MP4 to R2.
 * Captions, color grade, and upscaling are applied per-shot during the
 * normalize pass so the final concat is always a clean stream copy.
 */
export async function stitchShotsLocally(args: {
  jobId: string;
  shotUrls: string[];
  shotDurationSec?: number;
  captions?: string[];
  colorGrade?: boolean;
  upscaleTo1080?: boolean;
}): Promise<StitchResult> {
  if (args.shotUrls.length < 2) throw new Error("At least two shots are required for stitching");
  const workdir = await mkdtemp(path.join(tmpdir(), "dreyv-video-stitch-"));
  try {
    const inputs = args.shotUrls.map((_, i) => path.join(workdir, `shot-${String(i + 1).padStart(2, "0")}.mp4`));
    for (let i = 0; i < args.shotUrls.length; i += 1) {
      await downloadShot(args.shotUrls[i], inputs[i], i);
    }

    const wantsPost =
      Boolean(args.colorGrade) ||
      Boolean(args.upscaleTo1080) ||
      (args.captions ?? []).some((c) => c && c.trim().length > 0);

    const perShot: PostOptions[] = inputs.map((_, i) => ({
      caption: args.captions?.[i]?.trim() || undefined,
      colorGrade: args.colorGrade,
      upscaleTo1080: args.upscaleTo1080,
    }));

    let outputFile = path.join(workdir, "final-copy.mp4");

    if (wantsPost) {
      // Post requires re-encode, so we go straight to normalize.
      try {
        const normalized = await normalizeAll(inputs, workdir, true, perShot);
        outputFile = path.join(workdir, "final-normalized.mp4");
        await concatCopy(normalized, path.join(workdir, "concat-normalized.txt"), outputFile, workdir);
      } catch {
        const silent = await normalizeAll(inputs, workdir, false, perShot);
        outputFile = path.join(workdir, "final-silent.mp4");
        await concatCopy(silent, path.join(workdir, "concat-silent.txt"), outputFile, workdir);
      }
    } else {
      try {
        await concatCopy(inputs, path.join(workdir, "concat-copy.txt"), outputFile, workdir);
      } catch (copyErr) {
        try {
          const normalized = await normalizeAll(inputs, workdir, true, perShot);
          outputFile = path.join(workdir, "final-normalized.mp4");
          await concatCopy(normalized, path.join(workdir, "concat-normalized.txt"), outputFile, workdir);
        } catch {
          const silent = await normalizeAll(inputs, workdir, false, perShot);
          outputFile = path.join(workdir, "final-silent.mp4");
          try {
            await concatCopy(silent, path.join(workdir, "concat-silent.txt"), outputFile, workdir);
          } catch (silentErr) {
            const primary = copyErr instanceof Error ? copyErr.message : String(copyErr);
            const fallback = silentErr instanceof Error ? silentErr.message : String(silentErr);
            throw new Error(`Local stitch failed. copy=${primary}; normalized=${fallback}`);
          }
        }
      }
    }

    const body = await readFile(outputFile);
    if (!isR2Configured()) {
      return {
        url: `data:video/mp4;base64,${body.toString("base64")}`,
        durationSec: (args.shotDurationSec ?? SHOT_DURATION_SEC) * args.shotUrls.length,
      };
    }
    const key = `studio/video/final-${args.jobId}-${Date.now()}.mp4`;
    await putR2Object({ key, body, mime: "video/mp4", filename: "dreyv-final-ad.mp4" });
    const url = await presignR2Get({ key, filename: "dreyv-final-ad.mp4", mime: "video/mp4", inline: true, ttlSeconds: 3600 });
    return { url, key, durationSec: (args.shotDurationSec ?? SHOT_DURATION_SEC) * args.shotUrls.length };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export const stitchVertexShotsLocally = stitchShotsLocally;
