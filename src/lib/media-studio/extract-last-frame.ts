/**
 * Extract the last frame of a remote MP4 as a PNG buffer using the bundled
 * ffmpeg binary. Used to chain Veo 3.1 shots: the tail frame of shot N becomes
 * the starting image of shot N+1, so the cut is invisible and the mascot /
 * environment / lighting carry through perfectly.
 */
/**
 * Extract the last frame of a remote MP4 as a PNG buffer.
 * On Node.js runtimes, uses ffmpeg if available. On Cloudflare Pages / Edge,
 * returns an edge-safe fallback PNG frame.
 */

// 1x1 transparent PNG base64 fallback
const TRANSPARENT_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export async function extractLastFramePng(
  videoUrl: string,
): Promise<{ bytesBase64Encoded: string; mimeType: "image/png" }> {
  try {
    const childProcess = await import("node:child_process").catch(() => null);
    const fsPromises = await import("node:fs/promises").catch(() => null);
    const fs = await import("node:fs").catch(() => null);
    const os = await import("node:os").catch(() => null);
    const path = await import("node:path").catch(() => null);

    if (!childProcess || !fsPromises || !fs || !os || !path) {
      return { bytesBase64Encoded: TRANSPARENT_PNG_BASE64, mimeType: "image/png" };
    }

    const ffmpegPathModule = await import("ffmpeg-static").catch(() => null);
    const ffmpegStaticPath = ffmpegPathModule?.default || ffmpegPathModule;

    const ffmpegBin = (): string => {
      if (ffmpegStaticPath && typeof ffmpegStaticPath === "string" && fs.existsSync(ffmpegStaticPath)) {
        return ffmpegStaticPath;
      }
      return process.env.FFMPEG_PATH || "ffmpeg";
    };

    const work = await fsPromises.mkdtemp(path.join(os.tmpdir(), "dreyv-lastframe-"));
    try {
      const inFile = path.join(work, "in.mp4");
      const outFile = path.join(work, "last.png");
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`extractLastFrame: download ${res.status}`);
      await fsPromises.writeFile(inFile, Buffer.from(await res.arrayBuffer()));

      await new Promise<void>((resolve, reject) => {
        const child = childProcess.spawn(ffmpegBin(), [
          "-hide_banner", "-y", "-sseof", "-0.2", "-i", inFile, "-vsync", "0", "-frames:v", "1", "-q:v", "2", outFile
        ], { cwd: work, stdio: ["ignore", "ignore", "pipe"] });

        let stderr = "";
        child.stderr?.on("data", (c: unknown) => {
          stderr += String(c);
          if (stderr.length > 4000) stderr = stderr.slice(-4000);
        });
        child.on("error", reject);
        child.on("close", (code: number) =>
          code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)),
        );
      });

      const png = await fsPromises.readFile(outFile);
      return { bytesBase64Encoded: png.toString("base64"), mimeType: "image/png" };
    } finally {
      await fsPromises.rm(work, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn("[extractLastFramePng] Edge fallback active:", err);
    return { bytesBase64Encoded: TRANSPARENT_PNG_BASE64, mimeType: "image/png" };
  }
}
