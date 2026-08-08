/**
 * Cloudflare Containers proxy Worker.
 *
 * Routes traffic from edge to Next.js running inside a Durable Object container on TCP port 8080.
 * All internal container fetches MUST use http:// — Cloudflare Containers' TCP binding
 * throws "Connecting to a container using HTTPS is not currently supported" if any HTTPS
 * indicator is present in the URL or headers sent to getTcpPort().fetch().
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

      // Canonical 301 redirects to https://dreyv.com
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

      // Build forwarding headers — strip cf-visitor so the container TCP layer
      // never sees {"scheme":"https"} and strip x-forwarded-proto override risk
      const proxyHeaders = new Headers();
      for (const [k, v] of request.headers) {
        const lk = k.toLowerCase();
        if (lk === "cf-visitor") continue; // strips {"scheme":"https"}
        proxyHeaders.set(k, v);
      }
      proxyHeaders.set("host", "dreyv.com");
      proxyHeaders.set("x-forwarded-host", host);
      // Tell Next.js the original external scheme was HTTPS (for redirects, cookies, etc.)
      // This header is read by Next.js app code only — not by the Cloudflare TCP port binding
      proxyHeaders.set("x-forwarded-proto", "https");

      if (env.DATABASE_URL) {
        proxyHeaders.set("x-dreyv-database-url", String(env.DATABASE_URL));
      }
      if (env.JWT_SECRET) {
        proxyHeaders.set("x-dreyv-jwt-secret", String(env.JWT_SECRET));
      }

      const init: RequestInit = { method: request.method, headers: proxyHeaders };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        (init as any).duplex = "half";
      }

      // Pass a plain http:// URL string — the DO stub routes this to NextAppContainer.fetch
      const httpUrl = `http://dreyv.com${url.pathname}${url.search}`;
      const id = env.NEXT_APP.idFromName("dreyv_container_v8");
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

      if (request.headers.has("x-force-reboot") && container.running) {
        try { await container.stop(); } catch {}
      }

      if (!container.running) {
        try {
          await container.start({ enableInternet: true });
        } catch (startErr: any) {
          console.warn("Container start info:", String(startErr?.message || startErr));
        }
      }

      // getTcpPort(8080) binding — MUST receive a pure http:// URL with NO https indicators
      // in either the URL string or headers. The C++ layer throws if it detects HTTPS.
      const target = container.getTcpPort(8080);

      const reqUrl = new URL(request.url);
      // Force http:// scheme in the target URL
      const targetUrl = `http://127.0.0.1:8080${reqUrl.pathname}${reqUrl.search}`;

      // Build minimal headers — strip EVERYTHING that could signal HTTPS to the C++ binding
      const containerHeaders = new Headers();
      for (const [k, v] of request.headers) {
        const lk = k.toLowerCase();
        if (lk === "cf-visitor") continue;        // {"scheme":"https"} — triggers HTTPS check
        if (lk === "x-forwarded-proto") continue; // will set explicitly to "http" below
        containerHeaders.set(k, v);
      }
      containerHeaders.set("x-forwarded-proto", "http"); // MUST be http for getTcpPort binding
      containerHeaders.set("x-forwarded-host", "dreyv.com");
      containerHeaders.set("host", "127.0.0.1:8080");

      const fetchInit: RequestInit = { method: request.method, headers: containerHeaders };
      if (request.method !== "GET" && request.method !== "HEAD") {
        fetchInit.body = request.body;
        (fetchInit as any).duplex = "half";
      }

      // Retry loop to handle cold-start delay while server.js initialises on port 8080
      let lastErr: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          return await target.fetch(targetUrl, fetchInit);
        } catch (fetchErr: any) {
          lastErr = fetchErr;
          const msg = String(fetchErr?.message || fetchErr);
          const isTransient = msg.includes("Network connection lost") || msg.includes("refused") || msg.includes("reset") || msg.includes("not ready");
          if (attempt < 14 && isTransient) {
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
