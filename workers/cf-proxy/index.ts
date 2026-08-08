/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests and proxies them to the Next.js container binding.
 */

export interface Env {
  NEXT_APP: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.NEXT_APP.idFromName("next-app");
    return env.NEXT_APP.get(id).fetch(request);
  },
};

export class NextAppContainer {
  constructor(private readonly state: DurableObjectState) {}

  fetch(request: Request): Promise<Response> {
    const container = this.state.container;
    if (!container) {
      return Promise.resolve(new Response("Container binding not available", { status: 500 }));
    }

    container.start({ enableInternet: true });
    return container.getTcpPort(8080).fetch(request);
  }
}
