/**
 * Minimal fal.ai client for the Video Studio.
 *
 * We only need three things for fal-hosted render models:
 *   1) submit a job to a model and get a request_id back
 *   2) poll its status until COMPLETED / FAILED
 *   3) fetch the final result
 *
 * The fal SDK adds bundle weight + a singleton config we don't want in
 * server routes, so we hand-roll the REST surface. See
 * https://docs.fal.ai/model-apis/queue
 *
 * Auth: `Authorization: Key <FAL_KEY>` (FAL_KEY = "key_id:key_secret").
 */

const QUEUE = "https://queue.fal.run";

function keyOrThrow(): string {
  const k = process.env.FAL_KEY?.trim();
  if (!k) throw new Error("FAL_KEY is not configured");
  return k;
}

export type FalStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type FalSubmitResult = {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url: string;
};

/** POST /<model> — submit a request to the queue. */
export async function falSubmit(
  model: string,
  input: Record<string, unknown>,
): Promise<FalSubmitResult> {
  const res = await fetch(`${QUEUE}/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${keyOrThrow()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fal submit ${model} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as FalSubmitResult;
}

/** GET status_url — returns { status, logs?, queue_position? }. */
export async function falStatus(statusUrl: string): Promise<{ status: FalStatus; queue_position?: number }> {
  const res = await fetch(statusUrl, {
    headers: { Authorization: `Key ${keyOrThrow()}` },
  });
  if (!res.ok) throw new Error(`fal status ${res.status}`);
  return res.json();
}

/** GET response_url — final payload. Shape varies per model. */
export async function falResult<T = unknown>(responseUrl: string): Promise<T> {
  const res = await fetch(responseUrl, {
    headers: { Authorization: `Key ${keyOrThrow()}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fal result ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

/**
 * Submit + poll until terminal. Returns the parsed response payload.
 * Default budget: 8 minutes (Veo 3 Fast at 8s = ~30–90s).
 */
export async function falRun<T = unknown>(
  model: string,
  input: Record<string, unknown>,
  opts: { maxMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const maxMs = opts.maxMs ?? 8 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 4000;
  const sub = await falSubmit(model, input);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const s = await falStatus(sub.status_url).catch(() => ({ status: "IN_PROGRESS" as FalStatus }));
    if (s.status === "COMPLETED") return falResult<T>(sub.response_url);
    if (s.status === "FAILED") throw new Error(`fal ${model} FAILED`);
  }
  throw new Error(`fal ${model} timed out after ${Math.round(maxMs / 1000)}s`);
}

/**
 * Veo 3 Fast — text-to-video, 8s clips, native synced audio (dialogue + sfx
 * + ambient). Pricier than Kling/Wan but the audio bake makes it the right
 * default for an ad pipeline that has no separate TTS step.
 *
 * https://fal.ai/models/fal-ai/veo3/fast
 */
export async function renderVeo3FastShot(prompt: string): Promise<{ url: string }> {
  const out = await falRun<{ video: { url: string } }>("fal-ai/veo3/fast", {
    prompt,
    aspect_ratio: "9:16",
    duration: "8s",
    generate_audio: true,
    resolution: "720p",
  });
  if (!out?.video?.url) throw new Error("Veo3 Fast returned no video url");
  return { url: out.video.url };
}

/**
 * Wan 2.2 Fast — text-to-video, ~$0.05/sec, no native audio.
 * The cheapest production-grade option on fal. We render silent 5s clips
 * here; Dreyv's local ffmpeg stitcher concatenates them. If the user wants
 * voice they can layer their own TTS in the next post-production pass.
 *
 * https://fal.ai/models/fal-ai/wan/v2.2-5b/fast/text-to-video
 */
export async function renderWan22FastShot(prompt: string): Promise<{ url: string }> {
  const out = await falRun<{ video: { url: string } }>(
    "fal-ai/wan/v2.2-5b/fast/text-to-video",
    {
      prompt,
      aspect_ratio: "9:16",
      num_frames: 81, // ~5s at 16fps
      resolution: "720p",
    },
    { maxMs: 4 * 60 * 1000 },
  );
  if (!out?.video?.url) throw new Error("Wan 2.2 returned no video url");
  return { url: out.video.url };
}
