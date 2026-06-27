/**
 * Google Veo 3.1 via Vertex AI (Agent Platform).
 *
 * Auth: GCP service-account JSON → signed JWT → OAuth2 access token (1h),
 * cached in-process so we don't mint one per request.
 *
 * Endpoints:
 *   POST {region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}
 *        /publishers/google/models/veo-3.1-generate-001:predictLongRunning
 *   POST .../veo-3.1-generate-001:fetchPredictOperation   (poll)
 *
 * If `GCS_OUTPUT_URI` is set, Vertex writes the mp4 to that bucket and we
 * stream it back from GCS through R2. Otherwise we request inline base64
 * bytes (works for ~8s clips, ~5-10MB).
 */
import { SignJWT, importPKCS8 } from "jose";
import { putR2Object, isR2Configured, presignR2Get } from "@/lib/agents/artifacts/r2-storage";

const REGION = process.env.GCP_VERTEX_REGION?.trim() || "us-central1";
const MODEL = process.env.GCP_VEO_MODEL?.trim() || "veo-3.1-generate-001";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("GCP_SERVICE_ACCOUNT_JSON is not configured");
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON missing client_email or private_key");
  }
  return parsed;
}

function projectId(sa: ServiceAccount): string {
  const id = process.env.GCP_PROJECT_ID?.trim() || sa.project_id;
  if (!id) throw new Error("GCP_PROJECT_ID is not configured (and service account has no project_id)");
  return id;
}

let cachedToken: { token: string; exp: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp - 60 > Math.floor(Date.now() / 1000)) {
    return cachedToken.token;
  }
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri || "https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GCP token exchange ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, exp: now + body.expires_in };
  return body.access_token;
}

type Operation = {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: {
    videos?: Array<{ gcsUri?: string; bytesBase64Encoded?: string; mimeType?: string }>;
    generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
  };
};

const VERTEX_BASE = () =>
  `https://${REGION}-aiplatform.googleapis.com/v1/projects`;

/** Express-mode endpoint — no project, auth via `x-goog-api-key`. */
const VERTEX_EXPRESS = () =>
  `https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL}`;

/**
 * Resolve auth: prefer a Vertex API key (Express mode, simplest) and fall
 * back to a service-account JSON if no key is set.
 */
async function vertexAuth(): Promise<
  | { mode: "key"; key: string; url: string }
  | { mode: "sa"; token: string; url: string }
> {
  const key = (process.env.GCP_VERTEX_API_KEY || process.env.VERTEX_API_KEY || "").trim();
  if (key) return { mode: "key", key, url: VERTEX_EXPRESS() };
  const sa = loadServiceAccount();
  const project = projectId(sa);
  const token = await getAccessToken();
  return {
    mode: "sa",
    token,
    url: `${VERTEX_BASE()}/${project}/locations/${REGION}/publishers/google/models/${MODEL}`,
  };
}

function authHeaders(a: { mode: "key"; key: string } | { mode: "sa"; token: string }): Record<string, string> {
  return a.mode === "key"
    ? { "x-goog-api-key": a.key, "Content-Type": "application/json; charset=utf-8" }
    : { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json; charset=utf-8" };
}

/**
 * Submit one Vertex Veo 3.1 generation, poll until done, persist to R2.
 * Returns a presigned R2 URL the browser can stream.
 */
export async function renderVertexVeoShot(prompt: string): Promise<{ url: string }> {
  const auth = await vertexAuth();
  const modelBase = auth.url;
  const storageUri = process.env.GCS_OUTPUT_URI?.trim(); // optional gs://bucket/prefix/

  const submitBody = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "9:16",
      durationSeconds: 8,
      resolution: "720p",
      personGeneration: "allow_adult",
      generateAudio: true,
      ...(storageUri ? { storageUri } : {}),
    },
  };

  const submit = await fetch(`${modelBase}:predictLongRunning`, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(submitBody),
  });
  const submitText = await submit.text();
  if (!submit.ok) throw new Error(`Vertex submit ${submit.status}: ${submitText.slice(0, 600)}`);
  const opName = (JSON.parse(submitText) as { name?: string }).name;
  if (!opName) throw new Error("Vertex: missing operation name");

  // Poll fetchPredictOperation up to 8 min.
  const deadline = Date.now() + 8 * 60 * 1000;
  let op: Operation | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    const poll = await fetch(`${modelBase}:fetchPredictOperation`, {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ operationName: opName }),
    });
    const pollText = await poll.text();
    if (!poll.ok) throw new Error(`Vertex poll ${poll.status}: ${pollText.slice(0, 400)}`);
    op = JSON.parse(pollText) as Operation;
    if (op.done) break;
  }
  if (!op?.done) throw new Error("Vertex Veo timed out after 8m");
  if (op.error) throw new Error(`Vertex Veo failed: ${op.error.message}`);

  const video = op.response?.videos?.[0];
  if (!video) throw new Error("Vertex returned no video");

  let bytes: Uint8Array;
  if (video.bytesBase64Encoded) {
    bytes = Uint8Array.from(Buffer.from(video.bytesBase64Encoded, "base64"));
  } else if (video.gcsUri) {
    // Download from GCS — needs an OAuth bearer; API-key auth can't read GCS.
    if (auth.mode !== "sa") {
      throw new Error("Vertex returned a gcsUri but API-key mode can't read GCS. Unset GCS_OUTPUT_URI or use a service account.");
    }
    const m = video.gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!m) throw new Error(`Bad gcsUri: ${video.gcsUri}`);
    const [, bucket, object] = m;
    const dl = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!dl.ok) throw new Error(`GCS download ${dl.status}`);
    bytes = new Uint8Array(await dl.arrayBuffer());
  } else {
    throw new Error("Vertex video has neither gcsUri nor bytesBase64Encoded");
  }

  if (!isR2Configured()) {
    const b64 = Buffer.from(bytes).toString("base64");
    return { url: `data:video/mp4;base64,${b64}` };
  }
  const objKey = `studio/video/vertex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  await putR2Object({ key: objKey, body: Buffer.from(bytes), mime: "video/mp4", filename: "shot.mp4" });
  const url = await presignR2Get({ key: objKey, filename: "shot.mp4", mime: "video/mp4", inline: true, ttlSeconds: 3600 });
  return { url };
}

/** Cheap auth/entitlement probe used by /api/debug/veo-ping?vertex=1. */
export async function vertexHealthCheck(): Promise<{
  ok: true;
  mode: "key" | "sa";
  region: string;
  model: string;
  project?: string;
}> {
  const auth = await vertexAuth();
  const res = await fetch(auth.url, { headers: authHeaders(auth) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Vertex model probe ${res.status}: ${t.slice(0, 400)}`);
  }
  return {
    ok: true,
    mode: auth.mode,
    region: REGION,
    model: MODEL,
    project: auth.mode === "sa" ? (process.env.GCP_PROJECT_ID || "(from sa)") : undefined,
  };
}
