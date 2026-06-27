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
 *   2. for each shot in pack.shotList: selected provider renders one segment
 *   3. mark job stitching
 *   4. local ffmpeg concatenates shots into a single MP4
 *   5. mark job done with final_url + duration
 *
 * Failure at any step marks job=failed with the error string so the UI
 * surfaces it in the status panel.
 */
import { inngest } from "./inngest-client";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { renderVeo3FastShot, renderWan22FastShot } from "@/lib/media-studio/fal";
import { renderGoogleVeo3Shot } from "@/lib/media-studio/google-veo";
import { renderVertexVeoShot } from "@/lib/media-studio/google-vertex-veo";
import { loadDreyvMascotReferences } from "@/lib/media-studio/mascot-references";
import { studioVideoR2ColumnsAvailable } from "@/lib/media-studio/studio-video-schema";
import { stitchShotsLocally } from "@/lib/media-studio/local-video-stitcher";
import { dreyvShotStylePreamble } from "@/lib/media-studio/style-bible";

// Vertex Veo 3.1 accepts up to 3 asset reference images per generation. We
// feed the canonical Dreyv mascot PNGs directly so the model copies the real
// design (violet body, cream chest with the "D" mark, violet cap) instead of
// inventing one from text.
async function renderVertexVeoShotWithMascot(prompt: string) {
  const referenceImages = await loadDreyvMascotReferences();
  return renderVertexVeoShot(prompt, { referenceImages });
}

/**
 * Provider catalogue. Surfaced in the UI so the user can pick the trade-off.
 * `secondsPerShot` is the actual duration each model produces — used for final
 * duration metadata after local ffmpeg stitching.
 */
export type VideoProvider = "veo3-fal" | "veo3-google" | "veo3-vertex" | "wan22-fal";
const PROVIDERS: Record<
  VideoProvider,
  { render: (p: string) => Promise<{ url: string; key?: string }>; secondsPerShot: number; stitch: "local" | "none" }
> = {
  "veo3-fal":    { render: renderVeo3FastShot,   secondsPerShot: 8, stitch: "local" },
  "veo3-google": { render: renderGoogleVeo3Shot, secondsPerShot: 8, stitch: "local" },
  "veo3-vertex": { render: renderVertexVeoShotWithMascot, secondsPerShot: 8, stitch: "local" },
  "wan22-fal":   { render: renderWan22FastShot,  secondsPerShot: 5, stitch: "local" },
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
  const shotIndex = Math.max(0, (shot.n ?? 1) - 1);
  const previousShot = shotIndex > 0 ? pack.shotList[shotIndex - 1] : null;
  const nextShot = shotIndex < pack.shotList.length - 1 ? pack.shotList[shotIndex + 1] : null;
  return [
    dreyvShotStylePreamble(),
    "",
    `9:16 vertical ad segment ${shot.n} of ${pack.shotList.length} for ONE continuous Dreyv ad, pronounced DRAVE.`,
    `This is not a variant, restart, recap, or alternate take. It must be the next chronological scene in the same ad.`,
    previousShot ? `Previous scene context to continue from, not repeat: ${previousShot.description}` : `Opening scene: establish the cinematic world and motion hook — clean frame, no abstract garnish.`,
    `Current scene action: ${shot.description}`,
    nextShot ? `End with motion that hands off into this next scene: ${nextShot.description}` : `Final scene: resolve into a clean product payoff without text.`,
    `Continuity lock: identical mascot, identical environment, identical lighting, identical camera language across all segments.`,
    `Creative intent, without rendering written text: ${shot.toolPrompt.slice(0, 700)}`,
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

      // Stitching happens inside Dreyv with the bundled ffmpeg binary. fal may
      // render a shot, but it is never required for the final compose step.
      if (provider.stitch === "local" && shotUrls.length > 1) {
        await setJob(jobId, { status: "stitching" });
        const final = await step.run("compose", () =>
          stitchShotsLocally({ jobId, shotUrls, shotDurationSec: provider.secondsPerShot }),
        );
        await setJob(jobId, {
          status: "done",
          final_url: final.url,
          final_key: final.key ?? null,
          duration_sec: final.durationSec,
        });
        return { ok: true, url: final.url };
      }

      // Single-shot path: the rendered clip is already the final deliverable.
      await setJob(jobId, {
        status: "done",
        final_url: shotUrls[0] ?? null,
        final_key: shotKeys[0] ?? null,
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
