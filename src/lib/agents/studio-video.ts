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
import { renderVeo3FastShot, composeFinalAd } from "@/lib/media-studio/fal";

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
  const entries = Object.entries(patch);
  if (!entries.length) return;
  const sets = entries.map(([k, v], i) => {
    const col = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    return sql`${sql.identifier(col)} = ${v as never}`;
  });
  // Build a parameterised UPDATE manually so we can mix multiple columns.
  // Drizzle's tagged sql lets us join fragments with commas.
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
    const { jobId, pack } = event.data as { jobId: string; pack: Pack };
    if (!jobId || !pack) throw new Error("missing jobId or pack");

    const shots = (pack.shotList ?? []).slice(0, 5); // hard cap — cost guard
    if (!shots.length) {
      await setJob(jobId, { status: "failed", error: "Pack has no shots" });
      return { ok: false };
    }

    try {
      await setJob(jobId, { status: "rendering_shots", shots_total: shots.length });

      const shotUrls: string[] = [];
      for (const shot of shots) {
        const url = await step.run(`shot-${shot.n}`, async () => {
          const r = await renderVeo3FastShot(buildShotPrompt(shot, pack));
          return r.url;
        });
        shotUrls.push(url);
        await setJob(jobId, { shots_done: shotUrls.length, shot_urls: shotUrls });
      }

      await setJob(jobId, { status: "stitching" });

      const final = await step.run("compose", () =>
        composeFinalAd({ shotUrls, shotDurationSec: 8 }),
      );

      await setJob(jobId, {
        status: "done",
        final_url: final.url,
        duration_sec: final.durationSec,
      });
      return { ok: true, url: final.url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setJob(jobId, { status: "failed", error: msg.slice(0, 1000) });
      throw err;
    }
  },
);
