/**
 * Remote ffmpeg stitcher — calls the Cloudflare Container Worker
 * (workers/video-stitcher/) instead of running ffmpeg on Vercel.
 *
 * Same signature/return shape as stitchShotsLocally so vertex-render-job.ts
 * can swap implementations based on env config.
 */

type StitchResult = { url: string; key?: string; durationSec: number };

export function isRemoteStitcherConfigured(): boolean {
  return Boolean(process.env.VIDEO_STITCHER_URL && process.env.VIDEO_STITCHER_SECRET);
}

export async function stitchShotsRemote(args: {
  jobId: string;
  shotUrls: string[];
  shotDurationSec?: number;
  captions?: string[];
  colorGrade?: boolean;
  upscaleTo1080?: boolean;
}): Promise<StitchResult> {
  const base = process.env.VIDEO_STITCHER_URL;
  const secret = process.env.VIDEO_STITCHER_SECRET;
  if (!base || !secret) throw new Error("Remote stitcher not configured");

  const url = `${base.replace(/\/+$/, "")}/stitch?jobId=${encodeURIComponent(args.jobId)}`;
  // Generous timeout — Cloudflare Containers can run far longer than Vercel.
  const controller = new AbortController();
  const timeoutMs = Number(process.env.VIDEO_STITCHER_TIMEOUT_MS ?? 15 * 60 * 1000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        jobId: args.jobId,
        shotUrls: args.shotUrls,
        shotDurationSec: args.shotDurationSec,
        captions: args.captions,
        colorGrade: args.colorGrade,
        upscaleTo1080: args.upscaleTo1080,
      }),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Remote stitcher ${res.status}: ${body.slice(0, 800)}`);
    }
    let parsed: { ok?: boolean; url?: string; key?: string; durationSec?: number; error?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Remote stitcher returned non-JSON: ${body.slice(0, 400)}`);
    }
    if (!parsed.ok || !parsed.url || typeof parsed.durationSec !== "number") {
      throw new Error(`Remote stitcher failed: ${parsed.error ?? body.slice(0, 400)}`);
    }
    return { url: parsed.url, key: parsed.key, durationSec: parsed.durationSec };
  } finally {
    clearTimeout(timer);
  }
}
