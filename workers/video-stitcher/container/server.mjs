/**
 * Dreyv Video Stitcher — container entrypoint.
 *
 * POST /stitch
 *   Auth:  Authorization: Bearer ${STITCHER_SECRET}
 *   Body:  {
 *     jobId: string,
 *     shotUrls: string[],            // signed Veo/R2 URLs, in order
 *     shotDurationSec?: number,      // default 8
 *     captions?: string[],           // per-shot, optional
 *     colorGrade?: boolean,
 *     upscaleTo1080?: boolean
 *   }
 *   Returns: { ok: true, key, url, durationSec }
 *
 * Mirrors src/lib/media-studio/local-video-stitcher.ts so behaviour is identical
 * — only the runtime moved off Vercel into a long-running Cloudflare container.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.STITCHER_SECRET || "";
const SHOT_DURATION_SEC = 8;
const FONT_PATH = path.join(process.cwd(), "fonts", "Manrope-SemiBold.ttf");

const R2 = {
  accountId: process.env.R2_ACCOUNT_ID || "",
  bucket: process.env.R2_BUCKET || "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  publicBase: process.env.R2_PUBLIC_BASE || "",
};

function r2Client() {
  if (!R2.accountId || !R2.accessKeyId || !R2.secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2.accessKeyId, secretAccessKey: R2.secretAccessKey },
  });
}

function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
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

async function downloadShot(url, filePath, index) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download shot ${index + 1} (${res.status})`);
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
}

function wrapCaption(text, maxChars = 26) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) { cur = w; continue; }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join("\n");
}

function buildVideoFilter(opts) {
  const target = opts.upscaleTo1080 ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
  const chain = [
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

async function normalizeShot(input, output, workdir, keepAudio, post) {
  let captionFile;
  if (post.caption && post.caption.trim()) {
    captionFile = path.join(workdir, `caption-${path.basename(output, ".mp4")}.txt`);
    await writeFile(captionFile, wrapCaption(post.caption), "utf8");
  }
  await runFfmpeg(
    [
      "-hide_banner", "-y",
      "-i", input,
      "-vf", buildVideoFilter({ ...post, captionFile }),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
      ...(keepAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"] : ["-an"]),
      "-movflags", "+faststart",
      output,
    ],
    workdir,
  );
}

async function normalizeAll(inputs, workdir, keepAudio, perShot) {
  const suffix = keepAudio ? "norm" : "silent";
  const outputs = inputs.map((_, i) => path.join(workdir, `${suffix}-${String(i + 1).padStart(2, "0")}.mp4`));
  for (let i = 0; i < inputs.length; i += 1) {
    await normalizeShot(inputs[i], outputs[i], workdir, keepAudio, perShot[i] ?? {});
  }
  return outputs;
}

function concatList(files) {
  return files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
}

async function concatCopy(files, listFile, outputFile, workdir) {
  await writeFile(listFile, concatList(files));
  await runFfmpeg(
    ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outputFile],
    workdir,
  );
}

async function stitch(args) {
  if (!Array.isArray(args.shotUrls) || args.shotUrls.length < 2) {
    throw new Error("At least two shots are required for stitching");
  }
  const workdir = await mkdtemp(path.join(tmpdir(), "dreyv-stitch-"));
  try {
    const inputs = args.shotUrls.map((_, i) => path.join(workdir, `shot-${String(i + 1).padStart(2, "0")}.mp4`));
    for (let i = 0; i < args.shotUrls.length; i += 1) {
      await downloadShot(args.shotUrls[i], inputs[i], i);
    }

    const wantsPost =
      Boolean(args.colorGrade) ||
      Boolean(args.upscaleTo1080) ||
      (args.captions ?? []).some((c) => c && String(c).trim().length > 0);

    const perShot = inputs.map((_, i) => ({
      caption: args.captions?.[i]?.trim?.() || undefined,
      colorGrade: args.colorGrade,
      upscaleTo1080: args.upscaleTo1080,
    }));

    let outputFile = path.join(workdir, "final-copy.mp4");

    if (wantsPost) {
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
      } catch {
        const normalized = await normalizeAll(inputs, workdir, true, perShot);
        outputFile = path.join(workdir, "final-normalized.mp4");
        await concatCopy(normalized, path.join(workdir, "concat-normalized.txt"), outputFile, workdir);
      }
    }

    const body = await readFile(outputFile);
    const durationSec = (args.shotDurationSec ?? SHOT_DURATION_SEC) * args.shotUrls.length;

    const s3 = r2Client();
    if (!s3 || !R2.bucket) {
      return { url: `data:video/mp4;base64,${body.toString("base64")}`, durationSec };
    }

    const key = `studio/video/final-${args.jobId}-${Date.now()}.mp4`;
    await s3.send(new PutObjectCommand({
      Bucket: R2.bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
      ContentDisposition: `inline; filename="dreyv-final-ad.mp4"`,
    }));

    const url = R2.publicBase
      ? `${R2.publicBase.replace(/\/+$/, "")}/${key}`
      : await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: R2.bucket,
            Key: key,
            ResponseContentDisposition: `inline; filename="dreyv-final-ad.mp4"`,
            ResponseContentType: "video/mp4",
          }),
          { expiresIn: 3600 },
        );

    return { url, key, durationSec };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("invalid_json"); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health" || req.url === "/healthz")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "dreyv-video-stitcher", r2: Boolean(r2Client()) }));
      return;
    }
    if (req.method === "POST" && req.url === "/stitch") {
      const auth = req.headers["authorization"];
      if (!SECRET || auth !== `Bearer ${SECRET}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      const body = await readJson(req);
      const result = await stitch(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  } catch (err) {
    console.error("[stitcher] error", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`[stitcher] listening on :${PORT}`);
});
