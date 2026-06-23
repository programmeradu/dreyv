/**
 * DNS-AID SVCB records for dreyv.com.
 * Single source of truth for both the zone file mirror and the
 * one-click Cloudflare publisher.
 */

export type DnsAidRecord = {
  /** Sub-label, e.g. "_index._agents" (no trailing zone). */
  name: string;
  /** Target host, FQDN with trailing dot. */
  target: string;
  /** Endpoint path published in the SVCB params. */
  endpoint: string;
  /** TTL in seconds. */
  ttl: number;
};

export const DNS_AID_ZONE = "dreyv.com";
export const DNS_AID_TARGET = "dreyv.com.";
export const DNS_AID_ALPN = "h2,http/1.1";
export const DNS_AID_PORT = 443;
export const DNS_AID_TTL = 3600;

export const DNS_AID_RECORDS: DnsAidRecord[] = [
  { name: "_index._agents", target: DNS_AID_TARGET, endpoint: "/.well-known/agent-skills/index.json", ttl: DNS_AID_TTL },
  { name: "_mcp._agents",   target: DNS_AID_TARGET, endpoint: "/api/mcp",                              ttl: DNS_AID_TTL },
  { name: "_acp._agents",   target: DNS_AID_TARGET, endpoint: "/.well-known/acp.json",                 ttl: DNS_AID_TTL },
  { name: "_a2a._agents",   target: DNS_AID_TARGET, endpoint: "/api/mcp",                              ttl: DNS_AID_TTL },
  { name: "_oauth._agents", target: DNS_AID_TARGET, endpoint: "/.well-known/openid-configuration",     ttl: DNS_AID_TTL },
  { name: "_x402._agents",  target: DNS_AID_TARGET, endpoint: "/.well-known/x402",                     ttl: DNS_AID_TTL },
];

/**
 * Build the SVCB params value string per RFC 9460.
 * Cloudflare's structured SVCB API only accepts registered SvcParamKeys, so we
 * publish just `alpn` + `port`. The endpoint path is conveyed out-of-band via
 * the /.well-known/dns-aid zone mirror (clients resolve the underscored name,
 * then fetch the documented well-known path on the target host).
 */
export function svcbValue(_endpoint?: string): string {
  return `alpn="${DNS_AID_ALPN}" port=${DNS_AID_PORT}`;
}
