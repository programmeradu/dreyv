/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests, performs canonical redirects to https://dreyv.com,
 * forwards Worker runtime secrets to the container, and proxies non-redirect requests over HTTP.
 */

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

      // Collect Worker runtime secrets
      const secrets: Record<string, string> = {};
      if (env) {
        for (const [k, v] of Object.entries(env)) {
          if (typeof v === "string" && k !== "NEXT_APP") {
            secrets[k] = v;
          }
        }
      }

      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.set("x-container-env", JSON.stringify(secrets));

      const proxyReq = new Request(request.url, {
        method: request.method,
        headers: proxyHeaders,
        body: request.body,
        duplex: "half" as any,
      });

      const id = env.NEXT_APP.idFromName("next-app");
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

export class NextAppContainer {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const container = (this.state as any).container;
      if (!container) {
        return new Response("Container binding not available on Durable Object state", { status: 500 });
      }

      let containerEnv: Record<string, string> = {};
      const envHeader = request.headers.get("x-container-env");
      if (envHeader) {
        try {
          containerEnv = JSON.parse(envHeader);
        } catch {}
      }

      if (!container.running) {
        try {
          await container.start({ enableInternet: true, env: containerEnv });
        } catch (startErr: any) {
          const msg = String(startErr?.message || startErr);
          if (!msg.includes("already running")) {
            throw startErr;
          }
        }
      }

      const target = typeof container.getTcpPort === "function" ? container.getTcpPort(8080) : container;

      // Clean internal header before passing to container
      const containerHeaders = new Headers(request.headers);
      containerHeaders.delete("x-container-env");

      // Cloudflare Container TCP sockets expect http:// requests, not https://
      const url = new URL(request.url);
      url.protocol = "http:";

      const containerReq = new Request(url.toString(), {
        method: request.method,
        headers: containerHeaders,
        body: request.body,
        duplex: "half" as any,
      });

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
