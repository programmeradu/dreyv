/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests, performs canonical edge 301 redirects to https://dreyv.com,
 * passes edge runtime secrets to container at startup and on every request,
 * and proxies traffic to DO container TCP port.
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

      // Collect all Worker runtime secrets
      const secrets: Record<string, string> = {};
      if (env) {
        for (const [k, v] of Object.entries(env)) {
          if (typeof v === "string" && k !== "NEXT_APP") {
            secrets[k] = v;
          }
        }
      }

      // Format pure HTTP URL for DO stub to avoid workerd C++ HTTPS error
      const httpUrl = `http://localhost${url.pathname}${url.search}`;

      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.set("x-forwarded-proto", "https");
      proxyHeaders.set("x-forwarded-host", host);
      proxyHeaders.set("x-container-env", JSON.stringify(secrets));
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

      const proxyReq = new Request(httpUrl, init);

      // Versioned ID forces Cloudflare to instantiate a fresh Durable Object & boot the new container image
      const id = env.NEXT_APP.idFromName("dreyv_container_v4");
      const stub = env.NEXT_APP.get(id);
      return await stub.fetch(proxyReq);
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

      let containerEnv: Record<string, string> = {};
      const envHeader = request.headers.get("x-container-env");
      if (envHeader) {
        try {
          containerEnv = JSON.parse(envHeader);
        } catch {}
      }

      // Force restart container if explicit force-reboot header is provided
      if (request.headers.has("x-force-reboot") && container.running) {
        try {
          await container.stop();
        } catch {}
      }

      if (!container.running) {
        try {
          await container.start({ enableInternet: true, env: containerEnv });
        } catch (startErr: any) {
          const msg = String(startErr?.message || startErr);
          if (!msg.includes("already running")) {
            console.warn("Container start warning:", msg);
          }
        }
      }

      const target = typeof container.getTcpPort === "function" ? container.getTcpPort(8080) : container;

      // Format pure HTTP URL for container TCP port (http://localhost:8080/path)
      const url = new URL(request.url);
      const httpUrl = `http://localhost:8080${url.pathname}${url.search}`;

      const containerHeaders = new Headers(request.headers);
      containerHeaders.delete("x-container-env");
      if (!containerHeaders.has("x-forwarded-proto")) {
        containerHeaders.set("x-forwarded-proto", "https");
      }
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

      const containerReq = new Request(httpUrl, init);

      return await target.fetch(containerReq);
    } catch (err: any) {
      console.error("NextAppContainer fetch error:", err);
      return new Response(`Container Proxy Error: ${err?.stack || err?.message || String(err)}`, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  }
}
