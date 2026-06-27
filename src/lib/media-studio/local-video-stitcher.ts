import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";
import { isR2Configured, putR2Object, presignR2Get } from "@/lib/agents/artifacts/r2-storage";

type StitchResult = { url: string; key?: string; durationSec: number };

const SHOT_DURATION_SEC = 8;

function ffmpegPath(): string {
  return ffmpegStaticPath || process.env.FFMPEG_PATH || "ffmpeg";
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

async function downloadShot(url: string, filePath: string, index: number): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download shot ${index + 1} (${res.status})`);
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
}

function concatList(files: string[]): string {
  return files
    .map((file) => `file '${file.replace(/'/g, "'\\''")}'`)
    .join("\n");
}

/**
 * Stitch Vertex shots locally with ffmpeg, then persist the single MP4 to R2.
 * This keeps the Vertex path independent from fal credits/billing.
 */
export async function stitchShotsLocally(args: {
  jobId: string;
  shotUrls: string[];
  shotDurationSec?: number;
}): Promise<StitchResult> {
  if (args.shotUrls.length < 2) throw new Error("At least two shots are required for stitching");
  const workdir = await mkdtemp(path.join(tmpdir(), "dreyv-video-stitch-"));
  try {
    const inputs = args.shotUrls.map((_, i) => path.join(workdir, `shot-${String(i + 1).padStart(2, "0")}.mp4`));
    for (let i = 0; i < args.shotUrls.length; i += 1) {
      await downloadShot(args.shotUrls[i], inputs[i], i);
    }

    const listFile = path.join(workdir, "concat.txt");
    const outputFile = path.join(workdir, "final-ad.mp4");
    await writeFile(listFile, concatList(inputs));

    try {
      await runFfmpeg([
        "-hide_banner",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputFile,
      ], workdir);
    } catch {
      await runFfmpeg([
        "-hide_banner",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-vf",
        "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        outputFile,
      ], workdir);
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