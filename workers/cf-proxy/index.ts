/**
 * Cloudflare Containers proxy Worker.
 *
 * Receives incoming HTTP requests and proxies them to the Next.js container binding.
 */

export interface Env {
  NEXT_APP: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.NEXT_APP.fetch(request);
  },
};
