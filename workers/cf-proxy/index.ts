/**
 * Cloudflare Containers proxy Worker.
 *
 * CRITICAL: getTcpPort(8080).fetch() throws "Connecting to a container using HTTPS is not
 * currently supported" if ANY V8 C++ internal slot from the original edge https:// request
 * propagates into the fetch call — even via a plain object `init`. The only safe pattern is
 * a completely sterile `new Request(http://..., {...})` where NOTHING references the original
 * request object. headers must be rebuilt from scratch, body streamed directly.
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

      // Build a sterile http:// URL for the DO stub — no https:// references
      const targetUrl = `http://dreyv.com${url.pathname}${url.search}`;

      // Sterile headers — iterate cleanly, no spread from original request
      const cleanHeaders = new Headers();
      request.headers.forEach((value, key) => {
        const lk = key.toLowerCase();
        if (lk === "cf-visitor") return; // {"scheme":"https"} — must be stripped
        cleanHeaders.set(key, value);
      });
      cleanHeaders.set("x-forwarded-host", host);
      cleanHeaders.set("x-forwarded-proto", "https"); // for Next.js app logic only

      if (env.DATABASE_URL) {
        cleanHeaders.set("x-dreyv-database-url", String(env.DATABASE_URL));
      }
      if (env.JWT_SECRET) {
        cleanHeaders.set("x-dreyv-jwt-secret", String(env.JWT_SECRET));
      }
      if (env.STRIPE_SECRET_KEY) {
        cleanHeaders.set("x-dreyv-stripe-secret", String(env.STRIPE_SECRET_KEY));
      }
      if (env.PAYSTACK_SECRET_KEY) {
        cleanHeaders.set("x-dreyv-paystack-secret", String(env.PAYSTACK_SECRET_KEY));
      }
      if (env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY) {
        cleanHeaders.set("x-dreyv-paystack-public", String(env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY));
      }

      // Sterile Request — DO NOT use new Request(request, overrides); that carries C++ TLS slots
      const sterileRequest = new Request(targetUrl, {
        method: request.method,
        headers: cleanHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        redirect: "manual",
      });

      const id = env.NEXT_APP.idFromName("dreyv_container_v8");
      const stub = env.NEXT_APP.get(id);
      return await stub.fetch(sterileRequest);
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
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.env = env;
  }

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
          // Pass the worker's env bindings as OS environment variables to the Docker container
          // Filter out DO namespaces and non-string bindings to ensure only valid env vars are passed
          const containerEnv: Record<string, string> = {};
          for (const key of Object.keys(this.env || {})) {
            if (typeof this.env[key] === "string") {
              containerEnv[key] = this.env[key];
            }
          }
          await container.start({ enableInternet: true, env: containerEnv });
        } catch (startErr: any) {
          console.warn("Container start info:", String(startErr?.message || startErr));
        }
      }

      const target = container.getTcpPort(8080);

      const reqUrl = new URL(request.url);
      // Pure http:// target URL — no https:// anywhere
      const targetUrl = `http://127.0.0.1:8080${reqUrl.pathname}${reqUrl.search}`;

      // Sterile headers rebuilt from scratch — do NOT spread or reference request.headers directly
      const cleanHeaders = new Headers();
      request.headers.forEach((value, key) => {
        const lk = key.toLowerCase();
        if (lk === "cf-visitor") return;        // strips {"scheme":"https"}
        if (lk === "x-forwarded-proto") return; // will be set explicitly to "http" below
        if (lk === "host") return;              // will be set explicitly below
        cleanHeaders.set(key, value);
      });
      // MUST be "http" — getTcpPort C++ binding throws if this is "https"
      cleanHeaders.set("x-forwarded-proto", "http");
      cleanHeaders.set("x-forwarded-host", "dreyv.com");
      cleanHeaders.set("host", "127.0.0.1:8080");

      // Sterile Request — construct entirely from primitives with no reference to original request
      const sterileRequest = new Request(targetUrl, {
        method: request.method,
        headers: cleanHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        redirect: "manual",
      });

      // Retry loop for cold-start — server.js takes a few seconds to open port 8080
      let lastErr: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          return await target.fetch(sterileRequest.clone());
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
