/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests, performs canonical edge 301 redirects to https://dreyv.com,
 * passes edge runtime secrets to container via request headers,
 * and proxies traffic to container using official switchPort helper from cloudflare:containers.
 */

import { DurableObject } from "cloudflare:workers";
import { switchPort } from "cloudflare:containers";

export interface Env {
  NEXT_APP: DurableObjectNamespace;
  [key: string]: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const host = url.hostname.toLowerCase();

      // Canonical 301 redirects to https://dreyv.com at edge speed
      if (
        host === "www.dreyv.com" ||
        host === "dreyv.app" ||
        host === "www.dreyv.app" ||
        host === "dreyv.finance" ||
        host === "www.dreyv.finance"
      ) {
        url.hostname = "dreyv.com";
        url.protocol = "https:";
        return Response.redirect(url.toString(), 301);
      }

      const proxyHeaders = new Headers(request.headers);
      if (!proxyHeaders.has("host")) {
        proxyHeaders.set("host", host);
      }

      if (env.DATABASE_URL) {
        proxyHeaders.set("x-dreyv-database-url", String(env.DATABASE_URL));
      }
      if (env.JWT_SECRET) {
        proxyHeaders.set("x-dreyv-jwt-secret", String(env.JWT_SECRET));
      }

      const init: RequestInit = {
        method: request.method,
        headers: proxyHeaders,
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        (init as any).duplex = "half";
      }

      const httpUrl = `http://127.0.0.1${url.pathname}${url.search}`;
      const id = env.NEXT_APP.idFromName("dreyv_container_v7");
      const stub = env.NEXT_APP.get(id);
      return await stub.fetch(httpUrl, init);
    } catch (err: any) {
      console.error("CF Proxy main fetch error:", err);
      return new Response(`Proxy Worker Error: ${err?.stack || err?.message || String(err)}`, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  },
};

export class NextAppContainer extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    try {
      const container = (this.ctx as any).container || (this as any).state?.container;
      if (!container) {
        return new Response("Container binding not available on Durable Object context", { status: 500 });
      }

      // Force restart container if explicit force-reboot header is provided
      if (request.headers.has("x-force-reboot") && container.running) {
        try {
          await container.stop();
        } catch {}
      }

      if (!container.running) {
        try {
          await container.start({ enableInternet: true });
        } catch (startErr: any) {
          console.warn("Container start info:", String(startErr?.message || startErr));
        }
      }

      // Route through official Cloudflare Containers switchPort helper to force plain HTTP on port 8080
      let lastErr: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const httpReq = typeof switchPort === "function" ? switchPort(request, 8080) : request;
          return await container.fetch(httpReq);
        } catch (fetchErr: any) {
          lastErr = fetchErr;
          const msg = String(fetchErr?.message || fetchErr);
          if (attempt < 14 && (msg.includes("Network connection lost") || msg.includes("refused") || msg.includes("reset") || msg.includes("not ready"))) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw fetchErr;
        }
      }
      throw lastErr;
    } catch (err: any) {
      console.error("NextAppContainer fetch error:", err);
      return new Response(`Container Proxy Error: ${err?.stack || err?.message || String(err)}`, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  }
}
