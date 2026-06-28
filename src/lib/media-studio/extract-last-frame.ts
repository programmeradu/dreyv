/**
 * Extract the last frame of a remote MP4 as a PNG buffer using the bundled
 * ffmpeg binary. Used to chain Veo 3.1 shots: the tail frame of shot N becomes
 * the starting image of shot N+1, so the cut is invisible and the mascot /
 * environment / lighting carry through perfectly.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

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

export async function extractLastFramePng(
  videoUrl: string,
): Promise<{ bytesBase64Encoded: string; mimeType: "image/png" }> {
  const work = await mkdtemp(path.join(tmpdir(), "dreyv-lastframe-"));
  try {
    const inFile = path.join(work, "in.mp4");
    const outFile = path.join(work, "last.png");
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`extractLastFrame: download ${res.status}`);
    await writeFile(inFile, Buffer.from(await res.arrayBuffer()));

    // -sseof -0.1 seeks to ~100ms before EOF, then grabs the final frame.
    // Far cheaper than decoding the whole clip just to scrub to the end.
    await run(
      ["-hide_banner", "-y", "-sseof", "-0.2", "-i", inFile, "-vsync", "0", "-frames:v", "1", "-q:v", "2", outFile],
      work,
    );
    const png = await readFile(outFile);
    return { bytesBase64Encoded: png.toString("base64"), mimeType: "image/png" };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
