/**
 * Background renderer for the Dreyv Video Studio.
 *
 * Triggered by event `studio.video.render.requested` (sent from
 * `/api/studio/video/render` when the user clicks "Render full ad"). Runs
 * inside an Inngest function so we don't block the request and we get free
 * retries + per-step durability.
 *
 * Pipeline:
 *   1. mark job rendering_shots
 *   2. for each shot in pack.shotList: fal Veo 3 Fast text→video (8s, audio)
 *   3. mark job stitching
 *   4. fal-ai/ffmpeg-api/compose concatenates shots into a single MP4
 *   5. mark job done with final_url + duration
 *
 * Failure at any step marks job=failed with the error string so the UI
 * surfaces it in the status panel.
 */
import { inngest } from "./inngest-client";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { renderVeo3FastShot, renderWan22FastShot, composeFinalAd } from "@/lib/media-studio/fal";
import { renderGoogleVeo3Shot } from "@/lib/media-studio/google-veo";
import { renderVertexVeoShot } from "@/lib/media-studio/google-vertex-veo";
import { studioVideoR2ColumnsAvailable } from "@/lib/media-studio/studio-video-schema";

/**
 * Provider catalogue. Surfaced in the UI so the user can pick the trade-off.
 * `secondsPerShot` is the actual duration each model produces — used so the
 * ffmpeg compose timeline lines clips up correctly.
 */
export type VideoProvider = "veo3-fal" | "veo3-google" | "veo3-vertex" | "wan22-fal";
const PROVIDERS: Record<
  VideoProvider,
  { render: (p: string) => Promise<{ url: string; key?: string }>; secondsPerShot: number; stitch: "fal" | "none" }
> = {
  "veo3-fal":    { render: renderVeo3FastShot,   secondsPerShot: 8, stitch: "fal" },
  "veo3-google": { render: renderGoogleVeo3Shot, secondsPerShot: 8, stitch: "none" },
  "veo3-vertex": { render: renderVertexVeoShot,  secondsPerShot: 8, stitch: "none" },
  "wan22-fal":   { render: renderWan22FastShot,  secondsPerShot: 5, stitch: "fal" },
};

type Shot = {
  n: number;
  description: string;
  toolPrompt: string;
  recommendedTool: string;
};

type Pack = {
  formatLabel: string;
  hook: { textCard: string; spokenLine: string };
  shotList: Shot[];
  burnedCaptions?: string[];
};

async function setJob(id: string, patch: Record<string, unknown>) {
  if (!db) return;
  const r2ColumnsReady = await studioVideoR2ColumnsAvailable();
  const entries = Object.entries(patch).filter(([key]) => {
    const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    return r2ColumnsReady || (col !== "shot_keys" && col !== "final_key");
  });
  if (!entries.length) return;
  const JSONB_COLS = new Set(["shot_urls", "shot_keys", "pack"]);
  const sets = entries.map(([k, v]) => {
    const col = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    if (JSONB_COLS.has(col)) {
      return sql`${sql.identifier(col)} = ${JSON.stringify(v)}::jsonb`;
    }
    return sql`${sql.identifier(col)} = ${v as never}`;
  });
  const setExpr = sql.join(sets, sql`, `);
  await db.execute(
    sql`UPDATE studio_video_jobs SET ${setExpr}, updated_at = now() WHERE id = ${id}::uuid`,
  );
}

function buildShotPrompt(shot: Shot, pack: Pack): string {
  // Veo 3 Fast wants a vivid, cinematic description with dialogue/sfx baked
  // in. Wrap the per-shot prompt with mascot + brand consistency so every
  // clip feels like the same ad.
  const captionLine = pack.burnedCaptions?.[shot.n - 1];
  return [
    `9:16 vertical TikTok ad shot ${shot.n} of ${pack.shotList.length}. ${shot.description}`,
    `Style: soft warm 3200K indoor lighting, shallow depth of field, premium tech ad aesthetic, violet accent color (#7c3aed).`,
    `Audio: natural ambient + clear voiceover. Voiceover line: "${shot.toolPrompt.slice(0, 240)}"`,
    captionLine ? `On-screen text overlay: "${captionLine}"` : "",
    `Mascot consistency: if a mascot character appears, it is a small friendly violet abstract shape — Dreyv. Never change its color or proportions.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const studioVideoRender = inngest.createFunction(
  { id: "studio-video-render", name: "Studio • render TikTok ad", concurrency: 2, retries: 1 },
  { event: "studio.video.render.requested" },
  async ({ event, step }) => {
    const { jobId, pack, provider: providerId } = event.data as {
      jobId: string;
      pack: Pack;
      provider?: VideoProvider;
    };
    if (!jobId || !pack) throw new Error("missing jobId or pack");
    const provider = PROVIDERS[providerId ?? "veo3-fal"] ?? PROVIDERS["veo3-fal"];

    const shots = (pack.shotList ?? []).slice(0, 5); // hard cap — cost guard
    if (!shots.length) {
      await setJob(jobId, { status: "failed", error: "Pack has no shots" });
      return { ok: false };
    }

    try {
      await setJob(jobId, { status: "rendering_shots", shots_total: shots.length });

      const shotUrls: string[] = [];
      const shotKeys: (string | null)[] = [];
      for (const shot of shots) {
        const result = await step.run(`shot-${shot.n}`, async () => {
          return provider.render(buildShotPrompt(shot, pack));
        });
        shotUrls.push(result.url);
        shotKeys.push(result.key ?? null);
        await setJob(jobId, {
          shots_done: shotUrls.length,
          shot_urls: shotUrls,
          shot_keys: shotKeys,
        });
      }

      // Stitching: only fal-based providers go through fal's hosted ffmpeg.
      // Vertex / Google-direct stay as a per-shot deliverable — the UI shows
      // each clip and the operator concatenates in CapCut. We avoid spending
      // FAL credits when the user explicitly picked a non-fal provider.
      if (provider.stitch === "fal" && process.env.FAL_KEY) {
        await setJob(jobId, { status: "stitching" });
        const final = await step.run("compose", () =>
          composeFinalAd({ shotUrls, shotDurationSec: provider.secondsPerShot }),
        );
        await setJob(jobId, {
          status: "done",
          final_url: final.url,
          duration_sec: final.durationSec,
        });
        return { ok: true, url: final.url };
      }

      // No-stitch path: shots are the deliverable.
      await setJob(jobId, {
        status: "done",
        duration_sec: shots.length * provider.secondsPerShot,
      });
      return { ok: true, shots: shotUrls };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setJob(jobId, { status: "failed", error: msg.slice(0, 1000) });
      throw err;
    }
  },
);
