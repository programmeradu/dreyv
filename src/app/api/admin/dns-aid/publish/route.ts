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

export const runtime = "nodejs";
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
};

async function upsertOne(
  token: string,
  zoneId: string,
  rec: DnsAidRecord
): Promise<RecordReport> {
  const fullName = fqdn(rec.name);
  const desiredValue = svcbValue(rec.endpoint);
  const desiredData = { priority: 1, target: rec.target, value: desiredValue };

  // Cloudflare's list endpoint matches on the FQDN.
  const list = await cf<CfDnsRecord[]>(
    token,
    `/zones/${zoneId}/dns_records?type=SVCB&name=${encodeURIComponent(fullName)}&per_page=50`
  );

  const matches = list.result.filter((r) => r.type === "SVCB" && r.name === fullName);

  // Find one that already equals our desired payload.
  const same = matches.find(
    (r) =>
      r.data?.priority === 1 &&
      (r.data?.target === rec.target || r.data?.target === rec.target.replace(/\.$/, "")) &&
      r.data?.value === desiredValue
  );

  // Delete any stale duplicates (different value or extras).
  for (const r of matches) {
    if (same && r.id === same.id) continue;
    await cf<{ id: string }>(token, `/zones/${zoneId}/dns_records/${r.id}`, { method: "DELETE" });
  }

  if (same) {
    return { name: fullName, endpoint: rec.endpoint, action: "unchanged", id: same.id };
  }

  const created = await cf<CfDnsRecord>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "SVCB",
      name: fullName,
      ttl: rec.ttl,
      proxied: false,
      data: desiredData,
    }),
  });

  return {
    name: fullName,
    endpoint: rec.endpoint,
    action: matches.length > 0 ? "updated" : "created",
    id: created.result.id,
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
      // Sequential — the Cloudflare API rate limit is generous but 6 records
      // is small enough that ordering also keeps the response easy to read.
      results.push(await upsertOne(token, zoneId, rec));
    }
    const summary = {
      created: results.filter((r) => r.action === "created").length,
      updated: results.filter((r) => r.action === "updated").length,
      unchanged: results.filter((r) => r.action === "unchanged").length,
    };
    return NextResponse.json({ ok: true, zone: DNS_AID_ZONE, summary, records: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Cloudflare error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    zone: DNS_AID_ZONE,
    records: DNS_AID_RECORDS.map((r) => ({
      name: fqdn(r.name),
      endpoint: r.endpoint,
      value: svcbValue(r.endpoint),
      ttl: r.ttl,
    })),
    configured: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID),
  });
}
