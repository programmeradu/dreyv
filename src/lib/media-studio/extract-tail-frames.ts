/**
 * Extract the last N frames of a shot as Veo 3.1 asset reference images.
 *
 * Why: Veo's `referenceImages` slot (max 3, `referenceType: "asset"`) is the
 * model's built-in identity/scene lock. Feeding it the last 3 frames of shot N
 * (sampled across the final ~1s) hands shot N+1 the mascot pose, wardrobe,
 * environment, lighting, palette, AND camera framing in a single payload —
 * no Gemini repaint in the loop, no drift compounding shot-after-shot.
 *
 * We intentionally do NOT also send `firstFrameImage` (Veo 3.1 rejects
 * requests that set both `image` and `referenceImages`). The reference grid
 * is a stronger continuity signal than a single tail frame anyway.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";
import type { VeoReferenceImage } from "@/lib/media-studio/mascot-references";

function ffmpegBin(): string {
  if (ffmpegStaticPath && existsSync(ffmpegStaticPath)) return ffmpegStaticPath;
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function run(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += String(c);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)),
    );
  });
}

/**
 * Pull the trailing ~1s of a clip at ~2fps and return up to `count` PNGs as
 * Veo asset references (ordered earliest → latest, so the last entry is the
 * actual final frame).
 */
export async function extractTailFramesAsRefs(
  videoUrl: string,
  count = 3,
): Promise<VeoReferenceImage[]> {
  const n = Math.max(1, Math.min(3, count));
  const work = await mkdtemp(path.join(tmpdir(), "dreyv-tailframes-"));
  try {
    const inFile = path.join(work, "in.mp4");
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`extractTailFrames: download ${res.status}`);
    await writeFile(inFile, Buffer.from(await res.arrayBuffer()));

    // Seek to ~1.2s before EOF, sample at 2 fps, keep up to N frames.
    await run(
      [
        "-hide_banner", "-y",
        "-sseof", "-1.2",
        "-i", inFile,
        "-vf", `fps=2,scale=720:-2`,
        "-vsync", "0",
        "-frames:v", String(n),
        "-q:v", "2",
        path.join(work, "frame-%02d.png"),
      ],
      work,
    );

    const files = (await readdir(work))
      .filter((f) => f.startsWith("frame-") && f.endsWith(".png"))
      .sort();
    const out: VeoReferenceImage[] = [];
    for (const f of files.slice(-n)) {
      const buf = await readFile(path.join(work, f));
      out.push({
        image: { bytesBase64Encoded: buf.toString("base64"), mimeType: "image/png" },
        referenceType: "asset",
      });
    }
    if (!out.length) throw new Error("extractTailFrames: no frames extracted");
    return out;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
