/**
 * One-click DNS-AID publisher for dreyv.com on Cloudflare.
 *
 * Requires two env vars (project secrets, never client-exposed):
 *   - CLOUDFLARE_API_TOKEN  (Zone:DNS:Edit, scoped to dreyv.com)
 *   - CLOUDFLARE_ZONE_ID    (zone id for dreyv.com)
 *
 * Gated by the existing team-member guard so only signed-in admins/creators
 * (or a session with the studio pass) can trigger DNS writes.
 *
 * Behaviour: idempotent upsert. For each DNS_AID_RECORDS entry we list the
 * existing SVCB records that match `type=SVCB` + `name`, delete any that
 * don't match the desired value, and create the record if it's missing.
 */

import { NextResponse } from "next/server";
import {
  DNS_AID_RECORDS,
  DNS_AID_ZONE,
  svcbValue,
  type DnsAidRecord,
} from "@/lib/dns-aid/records";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CF_BASE = "https://api.cloudflare.com/client/v4";

type CfResp<T> = { success: boolean; errors?: { code: number; message: string }[]; result: T };

type CfDnsRecord = {
  id: string;
  type: string;
  name: string;
  content?: string;
  data?: { priority?: number; target?: string; value?: string };
};

function fqdn(name: string): string {
  return `${name}.${DNS_AID_ZONE}`;
}

async function cf<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<CfResp<T>> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as CfResp<T>;
  if (!res.ok || !json.success) {
    const msg = json?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
    throw new Error(`Cloudflare ${res.status} on ${path} — ${msg}`);
  }
  return json;
}

type RecordReport = {
  name: string;
  endpoint: string;
  action: "created" | "updated" | "unchanged";
  id: string;
  kind: "SVCB" | "TXT";
};

async function upsertSvcb(
  token: string,
  zoneId: string,
  rec: DnsAidRecord
): Promise<RecordReport> {
  const fullName = fqdn(rec.name);
  const desiredValue = svcbValue(rec.endpoint);
  const desiredData = { priority: 1, target: rec.target, value: desiredValue };

  const list = await cf<CfDnsRecord[]>(
    token,
    `/zones/${zoneId}/dns_records?type=SVCB&name=${encodeURIComponent(fullName)}&per_page=50`
  );
  const matches = list.result.filter((r) => r.type === "SVCB" && r.name === fullName);

  const same = matches.find(
    (r) =>
      r.data?.priority === 1 &&
      (r.data?.target === rec.target || r.data?.target === rec.target.replace(/\.$/, "")) &&
      r.data?.value === desiredValue
  );

  for (const r of matches) {
    if (same && r.id === same.id) continue;
    await cf<{ id: string }>(token, `/zones/${zoneId}/dns_records/${r.id}`, { method: "DELETE" });
  }

  if (same) {
    return { name: fullName, endpoint: rec.endpoint, action: "unchanged", id: same.id, kind: "SVCB" };
  }

  const created = await cf<CfDnsRecord>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "SVCB", name: fullName, ttl: rec.ttl, proxied: false, data: desiredData }),
  });

  return {
    name: fullName,
    endpoint: rec.endpoint,
    action: matches.length > 0 ? "updated" : "created",
    id: created.result.id,
    kind: "SVCB",
  };
}

async function upsertTxt(
  token: string,
  zoneId: string,
  rec: DnsAidRecord
): Promise<RecordReport> {
  const fullName = fqdn(rec.name);
  const desiredContent = `endpoint=${rec.endpoint}`;

  const list = await cf<CfDnsRecord[]>(
    token,
    `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(fullName)}&per_page=50`
  );
  const matches = list.result.filter((r) => r.type === "TXT" && r.name === fullName);

  const norm = (s?: string) => (s ?? "").replace(/^"|"$/g, "");
  const same = matches.find((r) => norm(r.content) === desiredContent);

  for (const r of matches) {
    if (same && r.id === same.id) continue;
    if (!norm(r.content).startsWith("endpoint=")) continue;
    await cf<{ id: string }>(token, `/zones/${zoneId}/dns_records/${r.id}`, { method: "DELETE" });
  }

  if (same) {
    return { name: fullName, endpoint: rec.endpoint, action: "unchanged", id: same.id, kind: "TXT" };
  }

  const created = await cf<CfDnsRecord>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "TXT", name: fullName, ttl: rec.ttl, proxied: false, content: desiredContent }),
  });

  return {
    name: fullName,
    endpoint: rec.endpoint,
    action: matches.some((r) => norm(r.content).startsWith("endpoint=")) ? "updated" : "created",
    id: created.result.id,
    kind: "TXT",
  };
}

export async function POST() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    return NextResponse.json(
      {
        error:
          "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be set as project secrets before publishing.",
      },
      { status: 500 }
    );
  }

  try {
    const results: RecordReport[] = [];
    for (const rec of DNS_AID_RECORDS) {
      // Sequential keeps the response easy to read; Cloudflare's rate limit is generous.
      // SVCB advertises transport (alpn/port); a companion TXT carries the endpoint path,
      // since `endpoint` isn't a registered SvcParamKey that Cloudflare's validator accepts.
      results.push(await upsertSvcb(token, zoneId, rec));
      results.push(await upsertTxt(token, zoneId, rec));
    }

    // DNS-AID requires DNSSEC. Enable it on the zone (idempotent — Cloudflare
    // returns success even if it was already active).
    let dnssec: { status: string; enabled: boolean } = { status: "unknown", enabled: false };
    try {
      const ds = await cf<{ status: string }>(token, `/zones/${zoneId}/dnssec`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      });
      dnssec = { status: ds.result.status, enabled: ds.result.status === "active" };
    } catch (e) {
      dnssec = { status: e instanceof Error ? e.message : "error", enabled: false };
    }

    const summary = {
      created: results.filter((r) => r.action === "created").length,
      updated: results.filter((r) => r.action === "updated").length,
      unchanged: results.filter((r) => r.action === "unchanged").length,
    };
    return NextResponse.json({ ok: true, zone: DNS_AID_ZONE, summary, dnssec, records: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Cloudflare error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    zone: DNS_AID_ZONE,
    records: DNS_AID_RECORDS.flatMap((r) => [
      { type: "SVCB", name: fqdn(r.name), endpoint: r.endpoint, value: svcbValue(r.endpoint), ttl: r.ttl },
      { type: "TXT", name: fqdn(r.name), endpoint: r.endpoint, value: `endpoint=${r.endpoint}`, ttl: r.ttl },
    ]),
    configured: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID),
  });
}
