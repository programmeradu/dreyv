/**
 * Dreyv Video Stitcher Worker — plain Worker (no Container, no Docker).
 *
 * Forwards POST /stitch to a hosted ffmpeg server (Fly.io / Render / Railway)
 * configured via the FFMPEG_HOST_URL secret. Adds the shared bearer so the
 * ffmpeg host can authenticate the call.
 *
 * Deploy via Cloudflare API / `wrangler deploy` — no Docker required.
 * The heavy ffmpeg work lives in workers/video-stitcher/container/server.mjs,
 * which runs on Fly (see DEPLOY.md).
 */

export interface Env {
  STITCHER_SECRET: string;
  FFMPEG_HOST_URL: string; // e.g. https://dreyv-video-stitcher.fly.dev
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "dreyv-video-stitcher",
        secretConfigured: Boolean(env.STITCHER_SECRET),
        ffmpegHostConfigured: Boolean(env.FFMPEG_HOST_URL),
      });
    }

    if (url.pathname === "/stitch" && request.method === "POST") {
      if (!env.FFMPEG_HOST_URL) {
        return Response.json({ ok: false, error: "FFMPEG_HOST_URL not configured" }, { status: 500 });
      }
      // Auth: caller must present the shared bearer; we re-sign with the same
      // secret to the ffmpeg host (single source of truth).
      const incoming = request.headers.get("Authorization") ?? "";
      const expected = `Bearer ${env.STITCHER_SECRET}`;
      if (!env.STITCHER_SECRET || incoming !== expected) {
        return new Response("unauthorized", { status: 401 });
      }

      const target = `${env.FFMPEG_HOST_URL.replace(/\/+$/, "")}/stitch`;
      const body = await request.arrayBuffer();
      // No client-facing timeout here — Workers will keep the connection open
      // while the Fly host streams its response (typically 1–10 min).
      return fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: expected,
        },
        body,
      });
    }

    return new Response("not found", { status: 404 });
  },
};
