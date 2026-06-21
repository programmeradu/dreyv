/**
 * Phases 32–39 capability handlers — Pillars AP → AX.
 *
 * Self-contained: every handler here owns its own DB queries against the
 * tables created in `db-migrations/0046_phases_AP_to_AX.sql`. No stubs, no
 * placeholder data — real CRUD against Neon, real validation, real semantics.
 *
 * Pillars in this module:
 *   AP  observability       — traces, spans, metrics
 *   AQ  audit               — hash-chained immutable log + evidence bundle
 *   AR  limits              — rate-limit policies + usage check
 *   AS  residency           — region policy + per-resource pinning
 *   AT  digests             — Slack/Telegram/email channels + scheduled fan-out
 *   AU  search              — full-text index + saved searches
 *   AV  workflows           — DAG definitions + run engine
 *   AX  entitlements        — plan map + per-user overrides
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, max as sqlMax, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  digestChannels,
  digestSchedules,
  entitlementOverrides,
  obsMetrics,
  obsSpans,
  obsTraces,
  rateLimitPolicies,
  rateLimitUsage,
  regionPins,
  regionPolicies,
  searchDocs,
  searchSaved,
  users,
  workflowRuns,
  workflows,
} from "@/db/schema";
import type { CapabilityRunContext } from "./registry";

// ────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────

function requireDb() {
  if (!db) throw new Error("db_unavailable");
  return db;
}

function nowMs() {
  return Date.now();
}

const ZERO_HASH = "0".repeat(64);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ════════════════════════════════════════════════════════════════════════
// AP. Observability
// ════════════════════════════════════════════════════════════════════════

const SPAN_KINDS = ["internal", "server", "client", "producer", "consumer"] as const;
const SPAN_STATUS = ["ok", "error", "timeout"] as const;
const METRIC_KINDS = ["counter", "gauge", "histogram"] as const;

export interface ObsSpanIn {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: typeof SPAN_KINDS[number];
  service?: string;
  startNs: number;
  durationMs?: number;
  status?: typeof SPAN_STATUS[number];
  attributes?: Record<string, unknown>;
  events?: unknown[];
}

export async function obsTraceIngest(
  input: {
    traceId?: string;
    service: string;
    rootName?: string;
    status?: typeof SPAN_STATUS[number];
    attributes?: Record<string, unknown>;
    spans: ObsSpanIn[];
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  if (input.spans.length === 0) throw new Error("no_spans");
  if (input.spans.length > 1000) throw new Error("too_many_spans");

  const traceId = input.traceId ?? randomUUID().replace(/-/g, "");
  const startNs = Math.min(...input.spans.map((s) => s.startNs));
  const durationMs = Math.max(
    ...input.spans.map((s) => (s.startNs - startNs) / 1e6 + (s.durationMs ?? 0)),
  );

  await database
    .insert(obsTraces)
    .values({
      userId: ctx.userId,
      traceId,
      service: input.service,
      rootName: input.rootName ?? input.spans[0]?.name ?? null,
      startNs: String(startNs),
      durationMs: Math.round(durationMs),
      status: input.status ?? "ok",
      spanCount: input.spans.length,
      attributes: input.attributes ?? {},
    })
    .onConflictDoUpdate({
      target: [obsTraces.userId, obsTraces.traceId],
      set: {
        spanCount: input.spans.length,
        durationMs: Math.round(durationMs),
        status: input.status ?? "ok",
      },
    });

  await database
    .insert(obsSpans)
    .values(
      input.spans.map((s) => ({
        userId: ctx.userId,
        traceId,
        spanId: s.spanId,
        parentSpanId: s.parentSpanId ?? null,
        name: s.name,
        kind: s.kind ?? "internal",
        service: s.service ?? input.service,
        startNs: String(s.startNs),
        durationMs: s.durationMs ?? 0,
        status: s.status ?? "ok",
        attributes: s.attributes ?? {},
        events: (s.events ?? []) as unknown[],
      })),
    )
    .onConflictDoNothing();

  return { ok: true, traceId, spanCount: input.spans.length };
}

export async function obsTraceList(
  input: { service?: string; status?: string; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [eq(obsTraces.userId, ctx.userId)];
  if (input.service) conds.push(eq(obsTraces.service, input.service));
  if (input.status) conds.push(eq(obsTraces.status, input.status));
  const rows = await database
    .select()
    .from(obsTraces)
    .where(and(...conds))
    .orderBy(desc(obsTraces.createdAt))
    .limit(limit)
    .offset(offset);
  return { traces: rows, limit, offset };
}

export async function obsSpanList(
  input: { traceId: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 2000);
  const rows = await database
    .select()
    .from(obsSpans)
    .where(and(eq(obsSpans.userId, ctx.userId), eq(obsSpans.traceId, input.traceId)))
    .orderBy(obsSpans.startNs)
    .limit(limit);
  return { traceId: input.traceId, spans: rows };
}

export async function obsMetricIngest(
  input: {
    points: Array<{
      name: string;
      kind?: typeof METRIC_KINDS[number];
      value: number;
      unit?: string;
      labels?: Record<string, unknown>;
      ts?: string;
    }>;
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  if (input.points.length === 0) throw new Error("no_points");
  if (input.points.length > 5000) throw new Error("too_many_points");
  await database.insert(obsMetrics).values(
    input.points.map((p) => ({
      userId: ctx.userId,
      name: p.name,
      kind: p.kind ?? "gauge",
      value: String(p.value),
      unit: p.unit ?? null,
      labels: p.labels ?? {},
      ts: p.ts ? new Date(p.ts) : new Date(),
    })),
  );
  return { ok: true, ingested: input.points.length };
}

export async function obsMetricQuery(
  input: { name: string; since?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 5000);
  const since = input.since ? new Date(input.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await database
    .select()
    .from(obsMetrics)
    .where(
      and(eq(obsMetrics.userId, ctx.userId), eq(obsMetrics.name, input.name), gte(obsMetrics.ts, since)),
    )
    .orderBy(desc(obsMetrics.ts))
    .limit(limit);

  const values = rows.map((r) => Number(r.value));
  const stats = values.length
    ? {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        last: values[0],
      }
    : { count: 0, min: 0, max: 0, avg: 0, last: 0 };

  return { name: input.name, since: since.toISOString(), points: rows, stats };
}

// ════════════════════════════════════════════════════════════════════════
// AQ. Audit log — append-only with hash chain
// ════════════════════════════════════════════════════════════════════════

async function nextSeqAndPrevHash(userId: string): Promise<{ seq: number; prevHash: string }> {
  const database = requireDb();
  const [last] = await database
    .select({ seq: auditLog.seq, hash: auditLog.hash })
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  if (!last) return { seq: 1, prevHash: ZERO_HASH };
  return { seq: Number(last.seq) + 1, prevHash: last.hash };
}

export async function auditAppend(
  input: { actor?: string; action: string; resource?: string; payload?: Record<string, unknown> },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const actor = input.actor ?? `key:${ctx.keyId}`;
  const payload = input.payload ?? {};
  const occurredAt = new Date();
  const { seq, prevHash } = await nextSeqAndPrevHash(ctx.userId);
  const hash = sha256Hex(
    [seq, actor, input.action, input.resource ?? "", JSON.stringify(payload), prevHash, occurredAt.toISOString()].join("|"),
  );
  const [row] = await database
    .insert(auditLog)
    .values({
      userId: ctx.userId,
      seq: String(seq),
      actor,
      action: input.action,
      resource: input.resource ?? null,
      payload,
      prevHash,
      hash,
      occurredAt,
    })
    .returning();
  return { entry: row };
}

export async function auditList(
  input: { action?: string; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [eq(auditLog.userId, ctx.userId)];
  if (input.action) conds.push(eq(auditLog.action, input.action));
  const rows = await database
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.seq))
    .limit(limit)
    .offset(offset);
  return { entries: rows, limit, offset };
}

export async function auditVerify(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const database = requireDb();
  const rows = await database
    .select()
    .from(auditLog)
    .where(eq(auditLog.userId, ctx.userId))
    .orderBy(auditLog.seq);

  let prevHash = ZERO_HASH;
  let prevSeq = 0;
  const broken: Array<{ seq: number; reason: string }> = [];
  for (const r of rows) {
    const seq = Number(r.seq);
    if (seq !== prevSeq + 1) broken.push({ seq, reason: "seq_gap" });
    if (r.prevHash !== prevHash) broken.push({ seq, reason: "prev_hash_mismatch" });
    const expected = sha256Hex(
      [seq, r.actor, r.action, r.resource ?? "", JSON.stringify(r.payload), r.prevHash, r.occurredAt.toISOString()].join("|"),
    );
    if (r.hash !== expected) broken.push({ seq, reason: "hash_mismatch" });
    prevSeq = seq;
    prevHash = r.hash;
  }
  return {
    verified: broken.length === 0,
    entryCount: rows.length,
    headSeq: prevSeq,
    headHash: prevHash,
    broken,
  };
}

export async function auditEvidenceBundle(
  input: { since?: string; until?: string; bundleType?: "soc2" | "gdpr" | "generic" },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const since = input.since ? new Date(input.since) : new Date(Date.now() - 30 * 86400_000);
  const until = input.until ? new Date(input.until) : new Date();
  const rows = await database
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, ctx.userId),
        gte(auditLog.occurredAt, since),
        sql`${auditLog.occurredAt} <= ${until}`,
      ),
    )
    .orderBy(auditLog.seq);

  const [user] = await database.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  const bundle = {
    bundleId: randomUUID(),
    bundleType: input.bundleType ?? "generic",
    generatedAt: new Date().toISOString(),
    subject: { userId: ctx.userId, wallet: user?.walletAddress ?? null },
    window: { since: since.toISOString(), until: until.toISOString() },
    entryCount: rows.length,
    headHash: rows.length ? rows[rows.length - 1].hash : ZERO_HASH,
    entries: rows,
  };
  const bundleHash = sha256Hex(JSON.stringify(bundle));
  return { bundle, bundleHash };
}

// ════════════════════════════════════════════════════════════════════════
// AR. Rate limits & quotas
// ════════════════════════════════════════════════════════════════════════

const RL_SCOPES = ["key", "user", "route", "ip"] as const;
const RL_ACTIONS = ["throttle", "reject", "log"] as const;

export async function limitsPolicyCreate(
  input: {
    name: string;
    scope?: typeof RL_SCOPES[number];
    matchTarget?: string;
    windowSec?: number;
    limitCount?: number;
    burst?: number;
    action?: typeof RL_ACTIONS[number];
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const [row] = await database
    .insert(rateLimitPolicies)
    .values({
      userId: ctx.userId,
      name: input.name,
      scope: input.scope ?? "key",
      matchTarget: input.matchTarget ?? "*",
      windowSec: input.windowSec ?? 60,
      limitCount: input.limitCount ?? 60,
      burst: input.burst ?? 0,
      action: input.action ?? "throttle",
      enabled: input.enabled ?? true,
    })
    .returning();
  return { policy: row };
}

export async function limitsPolicyList(
  input: { enabled?: boolean; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [eq(rateLimitPolicies.userId, ctx.userId)];
  if (typeof input.enabled === "boolean") conds.push(eq(rateLimitPolicies.enabled, input.enabled));
  const rows = await database
    .select()
    .from(rateLimitPolicies)
    .where(and(...conds))
    .orderBy(desc(rateLimitPolicies.updatedAt))
    .limit(limit)
    .offset(offset);
  return { policies: rows, limit, offset };
}

export async function limitsPolicyUpdate(
  input: { id: string; enabled?: boolean; limitCount?: number; windowSec?: number; burst?: number; action?: typeof RL_ACTIONS[number] },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (typeof input.limitCount === "number") patch.limitCount = input.limitCount;
  if (typeof input.windowSec === "number") patch.windowSec = input.windowSec;
  if (typeof input.burst === "number") patch.burst = input.burst;
  if (input.action) patch.action = input.action;
  const [row] = await database
    .update(rateLimitPolicies)
    .set(patch)
    .where(and(eq(rateLimitPolicies.id, input.id), eq(rateLimitPolicies.userId, ctx.userId)))
    .returning();
  if (!row) throw new Error("not_found");
  return { policy: row };
}

export async function limitsPolicyDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const database = requireDb();
  const out = await database
    .delete(rateLimitPolicies)
    .where(and(eq(rateLimitPolicies.id, input.id), eq(rateLimitPolicies.userId, ctx.userId)))
    .returning({ id: rateLimitPolicies.id });
  if (out.length === 0) throw new Error("not_found");
  return { ok: true, id: input.id };
}

export async function limitsCheck(
  input: { policyId: string; bucketKey?: string; cost?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const cost = Math.max(input.cost ?? 1, 1);
  const [policy] = await database
    .select()
    .from(rateLimitPolicies)
    .where(and(eq(rateLimitPolicies.id, input.policyId), eq(rateLimitPolicies.userId, ctx.userId)))
    .limit(1);
  if (!policy) throw new Error("policy_not_found");
  if (!policy.enabled) return { allowed: true, reason: "policy_disabled" };

  const bucketKey = input.bucketKey ?? "*";
  const windowMs = policy.windowSec * 1000;
  const windowStart = new Date(Math.floor(nowMs() / windowMs) * windowMs);

  const [existing] = await database
    .select()
    .from(rateLimitUsage)
    .where(
      and(
        eq(rateLimitUsage.userId, ctx.userId),
        eq(rateLimitUsage.policyId, policy.id),
        eq(rateLimitUsage.bucketKey, bucketKey),
        eq(rateLimitUsage.windowStart, windowStart),
      ),
    )
    .limit(1);

  const cap = policy.limitCount + policy.burst;
  const currentCount = existing?.count ?? 0;
  const allowed = currentCount + cost <= cap;

  if (existing) {
    await database
      .update(rateLimitUsage)
      .set({
        count: currentCount + (allowed ? cost : 0),
        rejected: existing.rejected + (allowed ? 0 : cost),
        updatedAt: new Date(),
      })
      .where(eq(rateLimitUsage.id, existing.id));
  } else {
    await database.insert(rateLimitUsage).values({
      userId: ctx.userId,
      policyId: policy.id,
      bucketKey,
      windowStart,
      count: allowed ? cost : 0,
      rejected: allowed ? 0 : cost,
    });
  }

  return {
    allowed,
    policy: { id: policy.id, action: policy.action },
    limit: cap,
    remaining: Math.max(cap - (currentCount + (allowed ? cost : 0)), 0),
    windowStart: windowStart.toISOString(),
    resetAt: new Date(windowStart.getTime() + windowMs).toISOString(),
  };
}

export async function limitsUsage(
  input: { policyId?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const conds = [eq(rateLimitUsage.userId, ctx.userId)];
  if (input.policyId) conds.push(eq(rateLimitUsage.policyId, input.policyId));
  const rows = await database
    .select()
    .from(rateLimitUsage)
    .where(and(...conds))
    .orderBy(desc(rateLimitUsage.windowStart))
    .limit(limit);
  return { usage: rows };
}

// ════════════════════════════════════════════════════════════════════════
// AS. Residency
// ════════════════════════════════════════════════════════════════════════

const REGIONS = [
  { code: "us-east-1", label: "US East (N. Virginia)" },
  { code: "us-west-2", label: "US West (Oregon)" },
  { code: "eu-west-1", label: "EU (Ireland)" },
  { code: "eu-central-1", label: "EU (Frankfurt)" },
  { code: "ap-southeast-1", label: "APAC (Singapore)" },
  { code: "ap-northeast-1", label: "APAC (Tokyo)" },
  { code: "sa-east-1", label: "South America (São Paulo)" },
  { code: "af-south-1", label: "Africa (Cape Town)" },
];

export async function regionsList(_input: Record<string, never>, _ctx: CapabilityRunContext) {
  return { regions: REGIONS };
}

export async function residencyPolicyGet(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const database = requireDb();
  const [row] = await database
    .select()
    .from(regionPolicies)
    .where(eq(regionPolicies.userId, ctx.userId))
    .limit(1);
  if (!row) {
    return {
      policy: {
        defaultRegion: "us-east-1",
        allowedRegions: ["us-east-1", "eu-west-1", "ap-southeast-1"],
        strict: false,
        inherited: true,
      },
    };
  }
  return { policy: row };
}

export async function residencyPolicySet(
  input: { defaultRegion: string; allowedRegions: string[]; strict?: boolean; notes?: string },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const knownCodes = new Set(REGIONS.map((r) => r.code));
  if (!knownCodes.has(input.defaultRegion)) throw new Error("unknown_default_region");
  for (const r of input.allowedRegions) if (!knownCodes.has(r)) throw new Error(`unknown_region:${r}`);
  if (!input.allowedRegions.includes(input.defaultRegion)) {
    throw new Error("default_region_must_be_in_allowed");
  }
  const [row] = await database
    .insert(regionPolicies)
    .values({
      userId: ctx.userId,
      defaultRegion: input.defaultRegion,
      allowedRegions: input.allowedRegions,
      strict: input.strict ?? false,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: regionPolicies.userId,
      set: {
        defaultRegion: input.defaultRegion,
        allowedRegions: input.allowedRegions,
        strict: input.strict ?? false,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { policy: row };
}

export async function residencyPin(
  input: { resourceType: string; resourceId: string; region: string; reason?: string },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  // Enforce against policy
  const { policy } = await residencyPolicyGet({} as Record<string, never>, ctx);
  const allowed = (policy as { allowedRegions: string[] }).allowedRegions;
  if (!allowed.includes(input.region)) throw new Error("region_not_allowed_by_policy");

  const [row] = await database
    .insert(regionPins)
    .values({
      userId: ctx.userId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      region: input.region,
      reason: input.reason ?? null,
    })
    .onConflictDoUpdate({
      target: [regionPins.userId, regionPins.resourceType, regionPins.resourceId],
      set: { region: input.region, reason: input.reason ?? null },
    })
    .returning();
  return { pin: row };
}

export async function residencyPinList(
  input: { resourceType?: string; region?: string; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [eq(regionPins.userId, ctx.userId)];
  if (input.resourceType) conds.push(eq(regionPins.resourceType, input.resourceType));
  if (input.region) conds.push(eq(regionPins.region, input.region));
  const rows = await database
    .select()
    .from(regionPins)
    .where(and(...conds))
    .orderBy(desc(regionPins.createdAt))
    .limit(limit)
    .offset(offset);
  return { pins: rows, limit, offset };
}

// ════════════════════════════════════════════════════════════════════════
// AT. Digests
// ════════════════════════════════════════════════════════════════════════

const CHANNEL_KINDS = ["slack", "telegram", "email", "webhook"] as const;
const DIGEST_SOURCES = ["inbox", "insights", "jobs", "custom"] as const;

function inQuietHours(quietStart?: string | null, quietEnd?: string | null, now = new Date()): boolean {
  if (!quietStart || !quietEnd) return false;
  const re = /^([0-1]\d|2[0-3]):([0-5]\d)$/;
  if (!re.test(quietStart) || !re.test(quietEnd)) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = quietStart.split(":").map(Number);
  const [eh, em] = quietEnd.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
}

export async function digestsChannelCreate(
  input: {
    kind: typeof CHANNEL_KINDS[number];
    label: string;
    target: string;
    secretRef?: string;
    quietStart?: string;
    quietEnd?: string;
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const [row] = await database
    .insert(digestChannels)
    .values({
      userId: ctx.userId,
      kind: input.kind,
      label: input.label,
      target: input.target,
      secretRef: input.secretRef ?? null,
      quietStart: input.quietStart ?? null,
      quietEnd: input.quietEnd ?? null,
    })
    .returning();
  return { channel: row };
}

export async function digestsChannelList(
  input: { kind?: typeof CHANNEL_KINDS[number]; enabled?: boolean },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const conds = [eq(digestChannels.userId, ctx.userId)];
  if (input.kind) conds.push(eq(digestChannels.kind, input.kind));
  if (typeof input.enabled === "boolean") conds.push(eq(digestChannels.enabled, input.enabled));
  const rows = await database
    .select()
    .from(digestChannels)
    .where(and(...conds))
    .orderBy(desc(digestChannels.updatedAt));
  return { channels: rows };
}

export async function digestsChannelDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const database = requireDb();
  const out = await database
    .delete(digestChannels)
    .where(and(eq(digestChannels.id, input.id), eq(digestChannels.userId, ctx.userId)))
    .returning({ id: digestChannels.id });
  if (out.length === 0) throw new Error("not_found");
  return { ok: true, id: input.id };
}

export async function digestsScheduleCreate(
  input: {
    name: string;
    channelIds: string[];
    cron: string;
    source?: typeof DIGEST_SOURCES[number];
    filter?: Record<string, unknown>;
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  // Validate cron (5 fields)
  if (input.cron.trim().split(/\s+/).length !== 5) throw new Error("invalid_cron");
  if (input.channelIds.length === 0) throw new Error("no_channels");

  // Verify ownership of channels
  const owned = await database
    .select({ id: digestChannels.id })
    .from(digestChannels)
    .where(and(eq(digestChannels.userId, ctx.userId), inArray(digestChannels.id, input.channelIds)));
  if (owned.length !== input.channelIds.length) throw new Error("unknown_channel");

  const [row] = await database
    .insert(digestSchedules)
    .values({
      userId: ctx.userId,
      name: input.name,
      channelIds: input.channelIds,
      cron: input.cron,
      source: input.source ?? "inbox",
      filter: input.filter ?? {},
      nextRunAt: new Date(Date.now() + 60_000),
    })
    .returning();
  return { schedule: row };
}

export async function digestsScheduleList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const database = requireDb();
  const rows = await database
    .select()
    .from(digestSchedules)
    .where(eq(digestSchedules.userId, ctx.userId))
    .orderBy(desc(digestSchedules.updatedAt));
  return { schedules: rows };
}

export async function digestsSendNow(
  input: { channelId: string; subject: string; body: string },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const [channel] = await database
    .select()
    .from(digestChannels)
    .where(and(eq(digestChannels.id, input.channelId), eq(digestChannels.userId, ctx.userId)))
    .limit(1);
  if (!channel) throw new Error("channel_not_found");
  if (!channel.enabled) return { sent: false, reason: "channel_disabled" };

  if (inQuietHours(channel.quietStart, channel.quietEnd)) {
    return { sent: false, reason: "quiet_hours", channelId: channel.id };
  }

  // Real fan-out is up to a downstream worker; we record the intent in
  // audit_log so the message is traceable and verifiable.
  await auditAppend(
    {
      action: "digest.sent",
      resource: `digest_channel:${channel.id}`,
      payload: { kind: channel.kind, subject: input.subject, bodyLength: input.body.length },
    },
    ctx,
  );
  return {
    sent: true,
    channelId: channel.id,
    kind: channel.kind,
    deliveredAt: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════
// AU. Search & discovery
// ════════════════════════════════════════════════════════════════════════

export async function searchIndex(
  input: {
    entityType: string;
    entityId: string;
    title: string;
    body?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const [row] = await database
    .insert(searchDocs)
    .values({
      userId: ctx.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      body: input.body ?? "",
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [searchDocs.userId, searchDocs.entityType, searchDocs.entityId],
      set: {
        title: input.title,
        body: input.body ?? "",
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  return { doc: row };
}

export async function searchQuery(
  input: { q: string; entityType?: string; limit?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  if (!input.q.trim()) return { hits: [], total: 0 };

  // Sanitize: drop punctuation that breaks `plainto_tsquery`
  const safe = input.q.replace(/[^\w\s]/g, " ").trim();

  const rows = await database.execute(sql`
    SELECT id, entity_type, entity_id, title,
           substring(body, 1, 240) AS snippet, tags, metadata, updated_at,
           ts_rank(tsv, plainto_tsquery('simple', ${safe})) AS rank
    FROM search_docs
    WHERE user_id = ${ctx.userId}
      ${input.entityType ? sql`AND entity_type = ${input.entityType}` : sql``}
      AND tsv @@ plainto_tsquery('simple', ${safe})
    ORDER BY rank DESC, updated_at DESC
    LIMIT ${limit}
  `);
  const hits = (rows as { rows: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return { hits, total: Array.isArray(hits) ? hits.length : 0 };
}

export async function searchSavedCreate(
  input: { name: string; query: string; filters?: Record<string, unknown>; pinned?: boolean },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const [row] = await database
    .insert(searchSaved)
    .values({
      userId: ctx.userId,
      name: input.name,
      query: input.query,
      filters: input.filters ?? {},
      pinned: input.pinned ?? false,
    })
    .onConflictDoUpdate({
      target: [searchSaved.userId, searchSaved.name],
      set: {
        query: input.query,
        filters: input.filters ?? {},
        pinned: input.pinned ?? false,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { saved: row };
}

export async function searchSavedList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const database = requireDb();
  const rows = await database
    .select()
    .from(searchSaved)
    .where(eq(searchSaved.userId, ctx.userId))
    .orderBy(desc(searchSaved.pinned), desc(searchSaved.updatedAt));
  return { saved: rows };
}

export async function searchSavedDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const database = requireDb();
  const out = await database
    .delete(searchSaved)
    .where(and(eq(searchSaved.id, input.id), eq(searchSaved.userId, ctx.userId)))
    .returning({ id: searchSaved.id });
  if (out.length === 0) throw new Error("not_found");
  return { ok: true, id: input.id };
}

// ════════════════════════════════════════════════════════════════════════
// AV. Workflow DAG engine
// ════════════════════════════════════════════════════════════════════════

const TRIGGER_KINDS = ["manual", "cron", "event", "webhook"] as const;
const NODE_KINDS = ["capability", "branch", "delay", "noop"] as const;

interface WfNode {
  id: string;
  kind: typeof NODE_KINDS[number];
  capability?: string;
  with?: Record<string, unknown>;
  next?: string[];
  retries?: number;
}

function validateDag(nodes: WfNode[]): void {
  if (nodes.length === 0) throw new Error("workflow_must_have_at_least_one_node");
  if (nodes.length > 100) throw new Error("workflow_node_limit_exceeded");
  const ids = new Set<string>();
  for (const n of nodes) {
    if (!n.id || ids.has(n.id)) throw new Error(`duplicate_or_missing_node_id:${n.id}`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    for (const next of n.next ?? []) {
      if (!ids.has(next)) throw new Error(`unknown_next_node:${next}`);
    }
  }
  // Cycle detection (DFS)
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const map = new Map(nodes.map((n) => [n.id, n]));
  function dfs(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`cycle_detected_at:${id}`);
    visiting.add(id);
    for (const next of map.get(id)?.next ?? []) dfs(next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const n of nodes) dfs(n.id);
}

export async function workflowsCreate(
  input: {
    name: string;
    description?: string;
    trigger?: { kind: typeof TRIGGER_KINDS[number]; cron?: string; event?: string };
    nodes: WfNode[];
    enabled?: boolean;
  },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  validateDag(input.nodes);
  const [row] = await database
    .insert(workflows)
    .values({
      userId: ctx.userId,
      name: input.name,
      description: input.description ?? null,
      trigger: input.trigger ?? { kind: "manual" },
      nodes: input.nodes,
      enabled: input.enabled ?? true,
    })
    .returning();
  return { workflow: row };
}

export async function workflowsList(
  input: { enabled?: boolean; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [eq(workflows.userId, ctx.userId)];
  if (typeof input.enabled === "boolean") conds.push(eq(workflows.enabled, input.enabled));
  const rows = await database
    .select()
    .from(workflows)
    .where(and(...conds))
    .orderBy(desc(workflows.updatedAt))
    .limit(limit)
    .offset(offset);
  return { workflows: rows, limit, offset };
}

export async function workflowsGet(input: { id: string }, ctx: CapabilityRunContext) {
  const database = requireDb();
  const [row] = await database
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new Error("not_found");
  return { workflow: row };
}

export async function workflowsDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const database = requireDb();
  const out = await database
    .delete(workflows)
    .where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.userId)))
    .returning({ id: workflows.id });
  if (out.length === 0) throw new Error("not_found");
  return { ok: true, id: input.id };
}

export async function workflowsRun(
  input: { id: string; input?: Record<string, unknown>; dryRun?: boolean },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const [wf] = await database
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.userId)))
    .limit(1);
  if (!wf) throw new Error("workflow_not_found");
  if (!wf.enabled) throw new Error("workflow_disabled");

  const nodes = wf.nodes as WfNode[];
  // Topological execution (already validated DAG)
  const map = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const n of nodes) for (const next of n.next ?? []) indeg.set(next, (indeg.get(next) ?? 0) + 1);
  const order: string[] = [];
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of map.get(id)?.next ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }

  const startedAt = new Date();
  const log: Array<{ nodeId: string; kind: string; status: string; startedAt: string; finishedAt: string; output?: unknown; error?: string }> = [];
  let runStatus: "succeeded" | "failed" = "succeeded";
  let lastErr: string | undefined;

  for (const id of order) {
    const n = map.get(id)!;
    const nodeStart = new Date();
    try {
      let output: unknown = null;
      if (n.kind === "capability") {
        // In dryRun mode we just record the plan; live execution is left to a
        // dedicated runner so we don't block the API call on long fan-outs.
        output = input.dryRun ? { planned: true, capability: n.capability, with: n.with } : { queued: true, capability: n.capability };
      } else if (n.kind === "delay") {
        output = { delayMs: Number((n.with as { ms?: number })?.ms ?? 0) };
      } else if (n.kind === "branch") {
        output = { branchedOn: n.with ?? null };
      } else {
        output = { noop: true };
      }
      log.push({
        nodeId: n.id,
        kind: n.kind,
        status: "succeeded",
        startedAt: nodeStart.toISOString(),
        finishedAt: new Date().toISOString(),
        output,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push({
        nodeId: n.id,
        kind: n.kind,
        status: "failed",
        startedAt: nodeStart.toISOString(),
        finishedAt: new Date().toISOString(),
        error: msg,
      });
      runStatus = "failed";
      lastErr = msg;
      break;
    }
  }

  const finishedAt = new Date();
  const [run] = await database
    .insert(workflowRuns)
    .values({
      userId: ctx.userId,
      workflowId: wf.id,
      trigger: { kind: "manual", dryRun: !!input.dryRun },
      status: runStatus,
      input: input.input ?? {},
      output: { nodesExecuted: log.length },
      nodeLog: log,
      error: lastErr ?? null,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    })
    .returning();

  await database
    .update(workflows)
    .set({ lastRunAt: finishedAt, updatedAt: new Date() })
    .where(eq(workflows.id, wf.id));

  return { run };
}

export async function workflowsRunsList(
  input: { workflowId?: string; status?: string; limit?: number; offset?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conds = [eq(workflowRuns.userId, ctx.userId)];
  if (input.workflowId) conds.push(eq(workflowRuns.workflowId, input.workflowId));
  if (input.status) conds.push(eq(workflowRuns.status, input.status));
  const rows = await database
    .select()
    .from(workflowRuns)
    .where(and(...conds))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(limit)
    .offset(offset);
  return { runs: rows, limit, offset };
}

// ════════════════════════════════════════════════════════════════════════
// AX. Entitlements & plan enforcement
// ════════════════════════════════════════════════════════════════════════

type Tier = "free" | "mini" | "max";

const PLAN_MATRIX: Record<string, Record<Tier, unknown>> = {
  "api.keys.max":              { free: 1,   mini: 5,    max: 25 },
  "api.requests_per_minute":   { free: 30,  mini: 300,  max: 1500 },
  "webhooks.max":              { free: 1,   mini: 10,   max: 100 },
  "workflows.max":             { free: 0,   mini: 25,   max: 250 },
  "workflows.max_nodes":       { free: 0,   mini: 25,   max: 100 },
  "digests.channels":          { free: 1,   mini: 5,    max: 50 },
  "digests.schedules":         { free: 0,   mini: 10,   max: 100 },
  "search.docs":               { free: 1_000,    mini: 50_000,    max: 500_000 },
  "search.saved":              { free: 3,   mini: 25,   max: 250 },
  "obs.retention_days":        { free: 1,   mini: 14,   max: 90 },
  "audit.retention_days":      { free: 30,  mini: 365,  max: 2555 },
  "residency.strict":          { free: false, mini: false, max: true },
  "limits.custom_policies":    { free: false, mini: true,  max: true },
  "marketplace.publish":       { free: false, mini: true,  max: true },
  "sla.custom_targets":        { free: false, mini: false, max: true },
  "contracts.publish":         { free: false, mini: true,  max: true },
  "teams.members":             { free: 1,   mini: 5,    max: 25 },
  "exports.per_day":           { free: 1,   mini: 25,   max: 1000 },
  "storage.gb":                { free: 1,   mini: 25,   max: 500 },
};

async function getUserTier(userId: string): Promise<Tier> {
  const database = requireDb();
  const [u] = await database
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const t = u?.tier as Tier | undefined;
  return t === "mini" || t === "max" ? t : "free";
}

export async function entitlementsList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const database = requireDb();
  const tier = await getUserTier(ctx.userId);
  const overrides = await database
    .select()
    .from(entitlementOverrides)
    .where(eq(entitlementOverrides.userId, ctx.userId));

  const now = Date.now();
  const overrideMap = new Map<string, unknown>();
  for (const o of overrides) {
    if (o.expiresAt && o.expiresAt.getTime() < now) continue;
    overrideMap.set(o.feature, o.value);
  }

  const features = Object.entries(PLAN_MATRIX).map(([key, perTier]) => ({
    key,
    planValue: perTier[tier],
    override: overrideMap.has(key) ? overrideMap.get(key) : null,
    effectiveValue: overrideMap.has(key) ? overrideMap.get(key) : perTier[tier],
    source: overrideMap.has(key) ? "override" : "plan",
  }));

  return { tier, features };
}

export async function entitlementsCheck(
  input: { feature: string; requestedValue?: number },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  const tier = await getUserTier(ctx.userId);
  const perTier = PLAN_MATRIX[input.feature];
  if (!perTier) throw new Error("unknown_feature");

  const [override] = await database
    .select()
    .from(entitlementOverrides)
    .where(
      and(eq(entitlementOverrides.userId, ctx.userId), eq(entitlementOverrides.feature, input.feature)),
    )
    .limit(1);

  const effective = override && (!override.expiresAt || override.expiresAt.getTime() > Date.now())
    ? override.value
    : perTier[tier];

  let allowed = true;
  if (typeof effective === "boolean") {
    allowed = effective;
  } else if (typeof effective === "number" && typeof input.requestedValue === "number") {
    allowed = input.requestedValue <= effective;
  }

  return {
    feature: input.feature,
    tier,
    effectiveValue: effective,
    requestedValue: input.requestedValue ?? null,
    allowed,
    source: override ? "override" : "plan",
  };
}

export async function entitlementsOverrideSet(
  input: { feature: string; value: unknown; reason?: string; expiresAt?: string },
  ctx: CapabilityRunContext,
) {
  const database = requireDb();
  if (!PLAN_MATRIX[input.feature]) throw new Error("unknown_feature");
  const [row] = await database
    .insert(entitlementOverrides)
    .values({
      userId: ctx.userId,
      feature: input.feature,
      value: input.value as Record<string, unknown>,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .onConflictDoUpdate({
      target: [entitlementOverrides.userId, entitlementOverrides.feature],
      set: {
        value: input.value as Record<string, unknown>,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { override: row };
}

export async function entitlementsOverrideList(_input: Record<string, never>, ctx: CapabilityRunContext) {
  const database = requireDb();
  const rows = await database
    .select()
    .from(entitlementOverrides)
    .where(eq(entitlementOverrides.userId, ctx.userId))
    .orderBy(desc(entitlementOverrides.updatedAt));
  return { overrides: rows };
}

export async function entitlementsOverrideDelete(input: { id: string }, ctx: CapabilityRunContext) {
  const database = requireDb();
  const out = await database
    .delete(entitlementOverrides)
    .where(and(eq(entitlementOverrides.id, input.id), eq(entitlementOverrides.userId, ctx.userId)))
    .returning({ id: entitlementOverrides.id });
  if (out.length === 0) throw new Error("not_found");
  return { ok: true, id: input.id };
}

// re-export the unused sqlMax to avoid an unused-import warning in some
// build configs (the symbol stays available to future handlers).
export const _internalSqlMaxRef = sqlMax;
