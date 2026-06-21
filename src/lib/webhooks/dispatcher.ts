/**
 * Phase 5 — Outbound webhook dispatcher.
 *
 * `emitWebhookEvent({ userId, event, data })` fans the event out to every
 * active webhook owned by that user whose subscription matches. Delivery is
 * synchronous best-effort with up to 3 in-process retries (immediate +
 * 2s + 8s) and persists every attempt in `webhook_deliveries`. Failed rows
 * are left with `next_retry_at` so an out-of-band cron can sweep them
 * (Cloudflare worker) without us blocking the caller longer.
 *
 * Strict no-fallback semantics:
 *   - DB unavailable → throw, do not silently swallow.
 *   - Target returns non-2xx → row stored as `failed`, exception NOT raised
 *     to the caller (we don't want a downstream's flaky endpoint to break
 *     a primary user action).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { publicApiWebhooks, webhookDeliveries } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type WebhookEventName =
  | "watcher.delta"
  | "monitor.tripped"
  | "proposal.created"
  | "proposal.approved"
  | "x402.paid"
  | "delegation.expiring"
  | "notification.created"
  | "team.created"
  | "team.deleted"
  | "team.member_invited"
  | "team.member_joined"
  | "team.member_role_changed"
  | "team.member_removed"
  | "team.invite_revoked"
  | "billing.invoice_created"
  | "billing.invoice_paid"
  | "billing.tier_changed"
  | "privacy.export_ready"
  | "privacy.deletion_requested"
  | "privacy.consent_changed"
  | "storage.artifact_created"
  | "storage.artifact_deleted"
  | "storage.quota_exceeded"
  | "job.scheduled"
  | "job.completed"
  | "job.failed"
  | "job.cancelled"
  | "export.created"
  | "export.completed"
  | "export.failed"
  | "inbox.digest_ready"
  | "inbox.notification_archived"
  | "inbox.notification_snoozed"
  | "test.ping";

export const ALL_WEBHOOK_EVENTS: WebhookEventName[] = [
  "watcher.delta",
  "monitor.tripped",
  "proposal.created",
  "proposal.approved",
  "x402.paid",
  "delegation.expiring",
  "notification.created",
  "team.created",
  "team.deleted",
  "team.member_invited",
  "team.member_joined",
  "team.member_role_changed",
  "team.member_removed",
  "team.invite_revoked",
  "billing.invoice_created",
  "billing.invoice_paid",
  "billing.tier_changed",
  "privacy.export_ready",
  "privacy.deletion_requested",
  "privacy.consent_changed",
  "storage.artifact_created",
  "storage.artifact_deleted",
  "storage.quota_exceeded",
  "job.scheduled",
  "job.completed",
  "job.failed",
  "job.cancelled",
  "export.created",
  "export.completed",
  "export.failed",
  "inbox.digest_ready",
  "inbox.notification_archived",
  "inbox.notification_snoozed",
  "test.ping",
];

const MAX_BODY_BYTES = 256 * 1024;          // 256 KiB request body cap
const MAX_RESP_CAPTURE_BYTES = 4096;        // capture first 4 KiB of response
const ATTEMPT_TIMEOUTS_MS = [4000, 4000, 6000];
const RETRY_DELAYS_MS = [0, 2000, 8000];

export function generateSigningSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}

function subscriptionMatches(events: string, name: string): boolean {
  if (!events) return false;
  const list = events.split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes("*") || list.includes(name);
}

function signPayload(secret: string, timestamp: string, body: string): string {
  const h = createHmac("sha256", secret);
  h.update(`${timestamp}.${body}`);
  return `t=${timestamp},v1=${h.digest("hex")}`;
}

/** Verify a signature string produced by signPayload. */
export function verifySignature(
  secret: string,
  signatureHeader: string,
  body: string,
  toleranceSec = 300,
): boolean {
  try {
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((kv) => {
        const i = kv.indexOf("=");
        return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
      }),
    ) as Record<string, string>;
    const t = Number(parts.t);
    if (!Number.isFinite(t)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
    const expectedHex = createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
    const got = Buffer.from(parts.v1 ?? "", "hex");
    const exp = Buffer.from(expectedHex, "hex");
    if (got.length !== exp.length) return false;
    return timingSafeEqual(got, exp);
  } catch {
    return false;
  }
}

interface EmitArgs {
  userId: string;
  event: WebhookEventName;
  data: Record<string, unknown>;
}

interface DeliveryResult {
  webhookId: string;
  status: "ok" | "failed";
  httpStatus?: number;
  attempts: number;
  error?: string;
}

export async function emitWebhookEvent(args: EmitArgs): Promise<DeliveryResult[]> {
  if (!db) throw new Error("Webhook emit: database unavailable");
  const hooks = await db
    .select()
    .from(publicApiWebhooks)
    .where(and(eq(publicApiWebhooks.userId, args.userId), eq(publicApiWebhooks.active, true)));

  const targets = hooks.filter((h) => subscriptionMatches(h.events, args.event));
  if (targets.length === 0) return [];

  const results: DeliveryResult[] = [];
  await Promise.all(
    targets.map(async (h) => {
      const r = await deliverWithRetries(h, args.event, args.data);
      results.push({ webhookId: h.id, ...r });
    }),
  );
  return results;
}

async function deliverWithRetries(
  hook: typeof publicApiWebhooks.$inferSelect,
  event: string,
  data: Record<string, unknown>,
): Promise<Omit<DeliveryResult, "webhookId">> {
  const deliveryId = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: deliveryId,
    event,
    created_at: new Date().toISOString(),
    data,
  });

  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    if (db) await db.insert(webhookDeliveries).values({
      webhookId: hook.id,
      userId: hook.userId,
      event,
      payload: { event, data: "[oversized payload truncated]" },
      attempt: 1,
      status: "failed",
      error: "payload exceeds 256KiB",
    });
    return { status: "failed", attempts: 1, error: "payload too large" };
  }

  const signature = signPayload(hook.signingSecret, ts, body);
  let lastError: string | undefined;
  let lastHttp: number | undefined;
  let lastRespBody: string | undefined;

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUTS_MS[attempt - 1]);

    try {
      const res = await fetch(hook.targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Dreyv-Webhooks/1.0 (+https://dreyv.com/developers/api)",
          "x-dreyv-event": event,
          "x-dreyv-delivery-id": deliveryId,
          "x-dreyv-signature": signature,
          "x-dreyv-timestamp": ts,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(to);
      const respText = (await res.text().catch(() => "")).slice(0, MAX_RESP_CAPTURE_BYTES);
      const latency = Date.now() - startedAt;
      lastHttp = res.status;
      lastRespBody = respText;

      if (res.status >= 200 && res.status < 300) {
        if (db) {
          await db.insert(webhookDeliveries).values({
            webhookId: hook.id,
            userId: hook.userId,
            event,
            payload: JSON.parse(body),
            attempt,
            status: "ok",
            httpStatus: res.status,
            responseBody: respText,
            latencyMs: latency,
            deliveredAt: new Date(),
          });
          await db
            .update(publicApiWebhooks)
            .set({ lastDeliveryAt: new Date(), lastStatus: "ok", failureStreak: 0, updatedAt: new Date() })
            .where(eq(publicApiWebhooks.id, hook.id));
        }
        return { status: "ok", attempts: attempt, httpStatus: res.status };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(to);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All retries exhausted.
  if (db) {
    await db.insert(webhookDeliveries).values({
      webhookId: hook.id,
      userId: hook.userId,
      event,
      payload: JSON.parse(body),
      attempt: RETRY_DELAYS_MS.length,
      status: "failed",
      httpStatus: lastHttp,
      responseBody: lastRespBody,
      error: lastError ?? "unknown",
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000), // cron sweeper picks up in 5m
    });
    await db
      .update(publicApiWebhooks)
      .set({
        lastDeliveryAt: new Date(),
        lastStatus: "failed",
        failureStreak: (hook.failureStreak ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(publicApiWebhooks.id, hook.id));
  }
  return { status: "failed", attempts: RETRY_DELAYS_MS.length, httpStatus: lastHttp, error: lastError };
}
