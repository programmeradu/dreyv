/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests, performs canonical edge 301 redirects to https://dreyv.com,
 * passes edge runtime secrets to container via request headers,
 * and proxies traffic directly to DO container TCP port using pure HTTP string URLs and headers.
 */

import { DurableObject } from "cloudflare:workers";

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

      // Format pure HTTP URL string for DO stub
      const httpUrl = `http://127.0.0.1${url.pathname}${url.search}`;

      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.set("x-forwarded-proto", "http");
      proxyHeaders.set("x-forwarded-host", host);
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

      // Bump versioned ID to dreyv_container_v6 to evict stored container instance settings
      const id = env.NEXT_APP.idFromName("dreyv_container_v6");
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

      const target = typeof container.getTcpPort === "function" ? container.getTcpPort(8080) : container;

      // Format pure HTTP URL string for container TCP port (http://127.0.0.1:8080/path)
      const url = new URL(request.url);
      const httpUrl = `http://127.0.0.1:8080${url.pathname}${url.search}`;

      const containerHeaders = new Headers(request.headers);
      containerHeaders.set("x-forwarded-proto", "http");
      if (!containerHeaders.has("x-forwarded-host")) {
        containerHeaders.set("x-forwarded-host", "dreyv.com");
      }

      const init: RequestInit = {
        method: request.method,
        headers: containerHeaders,
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        (init as any).duplex = "half";
      }

      // Pass string URL directly to target.fetch to prevent V8 Request HTTPS state inheritance
      return await target.fetch(httpUrl, init);
    } catch (err: any) {
      console.error("NextAppContainer fetch error:", err);
      return new Response(`Container Proxy Error: ${err?.stack || err?.message || String(err)}`, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  }
}
