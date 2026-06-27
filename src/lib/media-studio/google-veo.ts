/**
 * Google Veo 3 via the Gemini Generative Language API (direct, no fal).
 *
 * Uses the same `GEMINI_API_KEY` the rest of the app already has. Endpoint:
 *   POST  /v1beta/models/veo-3.0-generate-001:predictLongRunning
 *   GET   /v1beta/{operation.name}            (poll)
 *   GET   <video.uri>?key=...                 (fetch bytes — auth required)
 *
 * Reference: https://ai.google.dev/gemini-api/docs/video
 *
 * The final video URI returned by Google is gated behind the API key, which
 * means the browser <video> tag cannot stream it directly. We download the
 * bytes server-side, push them to R2, and return the public R2 URL so the
 * studio UI behaves identically to the fal.ai path.
 */
import { putR2Object, isR2Configured, presignR2Get } from "@/lib/agents/artifacts/r2-storage";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function keyOrThrow(): string {
  const k = process.env.GEMINI_API_KEY?.trim();
  if (!k) throw new Error("GEMINI_API_KEY is not configured");
  return k;
}

type Operation = {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
};

/**
 * Submit + poll one Veo 3 generation. Returns a publicly streamable URL.
 * Veo 3 returns 720p 9:16 mp4 with native synced audio.
 */
export async function renderGoogleVeo3Shot(prompt: string): Promise<{ url: string }> {
  const key = keyOrThrow();
  const submit = await fetch(
    `${BASE}/models/veo-3.0-generate-001:predictLongRunning?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          aspectRatio: "9:16",
          durationSeconds: 8,
          personGeneration: "allow_adult",
        },
      }),
    },
  );
  const submitText = await submit.text();
  if (!submit.ok) throw new Error(`Veo submit ${submit.status}: ${submitText.slice(0, 500)}`);
  const opName = (JSON.parse(submitText) as Operation).name;
  if (!opName) throw new Error("Veo: missing operation name");

  // Poll up to 8 minutes.
  const deadline = Date.now() + 8 * 60 * 1000;
  let op: Operation | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await fetch(`${BASE}/${opName}?key=${encodeURIComponent(key)}`);
    const t = await r.text();
    if (!r.ok) throw new Error(`Veo poll ${r.status}: ${t.slice(0, 300)}`);
    op = JSON.parse(t) as Operation;
    if (op.done) break;
  }
  if (!op?.done) throw new Error("Veo timed out after 8m");
  if (op.error) throw new Error(`Veo failed: ${op.error.message}`);

  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error("Veo returned no video uri");

  // The URI requires the API key as a query param. Browsers can't follow that
  // without leaking the key, so download server-side and re-host on R2.
  const dl = await fetch(`${uri}${uri.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`);
  if (!dl.ok) throw new Error(`Veo download ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());

  if (!isR2Configured()) {
    // Last-resort fallback: return a data URL so the UI can still preview
    // (works for small clips; Veo 3 8s ~5-10MB usually fits).
    const b64 = Buffer.from(bytes).toString("base64");
    return { url: `data:video/mp4;base64,${b64}` };
  }
  const key2 = `studio/video/veo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  await putR2Object(key2, bytes, "video/mp4");
  return { url: publicR2Url(key2) };
}
