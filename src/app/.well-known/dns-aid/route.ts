import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * DNS-AID (DNS for AI Discovery) — HTTP mirror of the SVCB/HTTPS records
 * published at `_*._agents.dreyv.com`. The canonical zone fragment lives at
 * /.well-known/dns-aid/zone.txt; this JSON form lets HTTP-only scanners
 * resolve the same entrypoints without a DNS lookup.
 *
 * Draft: https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/
 * SVCB:  https://www.rfc-editor.org/rfc/rfc9460
 */
export function GET() {
  const origin = getSiteOrigin();
  const host = new URL(origin).host;

  const record = (
    label: string,
    endpoint: string,
    extra: Record<string, string> = {},
  ) => ({
    name: `_${label}._agents.${host}`,
    type: "HTTPS",
    ttl: 3600,
    priority: 1,
    target: host,
    params: {
      alpn: ["h2", "http/1.1"],
      port: 443,
      endpoint,
      ...extra,
    },
    url: `${origin}${endpoint}`,
  });

  return NextResponse.json(
    {
      version: "0.1",
      zone: host,
      dnssec: { required: true, status: "operator-configured" },
      zone_file: `${origin}/.well-known/dns-aid/zone.txt`,
      records: [
        record("index", "/.well-known/agent-skills/index.json"),
        record("a2a", "/.well-known/agents.json"),
        record("mcp", "/api/mcp"),
        record("acp", "/.well-known/acp.json"),
        record("ucp", "/.well-known/ucp"),
        record("openapi", "/openapi.json"),
        record("oauth", "/.well-known/openid-configuration"),
        record("x402", "/.well-known/x402"),
        record("authmd", "/auth.md"),
        record("llms", "/llms.txt"),
      ],
      spec: [
        "https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/",
        "https://www.rfc-editor.org/rfc/rfc9460",
      ],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
