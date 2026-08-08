/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests and proxies them to the Next.js container binding over HTTP.
 */

export interface Env {
  NEXT_APP: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const id = env.NEXT_APP.idFromName("next-app");
      const stub = env.NEXT_APP.get(id);
      return await stub.fetch(request);
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

      if (!container.running) {
        try {
          await container.start({ enableInternet: true });
        } catch (startErr: any) {
          const msg = String(startErr?.message || startErr);
          if (!msg.includes("already running")) {
            throw startErr;
          }
        }
      }

      const target = typeof container.getTcpPort === "function" ? container.getTcpPort(8080) : container;
      
      // Cloudflare Container TCP sockets expect http:// requests, not https://
      const url = new URL(request.url);
      url.protocol = "http:";
      const containerReq = new Request(url.toString(), request);

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
