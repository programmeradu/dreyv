/**
 * Dreyv Video Stitcher Worker.
 *
 * Thin reverse proxy in front of the ffmpeg container. The Worker exists to:
 *   1. Give the container a stable HTTPS endpoint.
 *   2. Pin one container instance per job (via Durable Object id) so a single
 *      stitch fully runs in one place.
 *   3. Pass through the Authorization bearer to the container.
 *
 * All real work happens inside container/server.mjs. See wrangler.toml.
 */
import { Container, getContainer } from "@cloudflare/containers";

export class VideoStitcher extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  envVars = {
    STITCHER_SECRET: this.env.STITCHER_SECRET ?? "",
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID ?? "",
    R2_BUCKET: this.env.R2_BUCKET ?? "",
    R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID ?? "",
    R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY ?? "",
    R2_PUBLIC_BASE: this.env.R2_PUBLIC_BASE ?? "",
  } as Record<string, string>;
}

export interface Env {
  VIDEO_STITCHER: DurableObjectNamespace<VideoStitcher>;
  STITCHER_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_PUBLIC_BASE: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "dreyv-video-stitcher",
        secretConfigured: Boolean(env.STITCHER_SECRET),
      });
    }

    if (url.pathname === "/stitch" && request.method === "POST") {
      // Pin by jobId so retries hit the same container instance. Fallback to a
      // random id if the caller didn't provide one (shouldn't happen).
      let jobId = url.searchParams.get("jobId") ?? "";
      let payload: ArrayBuffer | null = null;
      if (!jobId) {
        payload = await request.arrayBuffer();
        try {
          const parsed = JSON.parse(new TextDecoder().decode(payload));
          jobId = String(parsed?.jobId ?? "");
        } catch {
          /* ignore */
        }
      }
      const key = jobId || crypto.randomUUID();
      const container = getContainer(env.VIDEO_STITCHER, key);
      const forwarded = new Request("http://container/stitch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: request.headers.get("Authorization") ?? "",
        },
        body: payload ?? (await request.arrayBuffer()),
      });
      return container.fetch(forwarded);
    }

    return new Response("not found", { status: 404 });
  },
};
