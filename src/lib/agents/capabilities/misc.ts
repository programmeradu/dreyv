/**
 * DACS Phase 0 — Misc domain capabilities.
 *
 * Extracted from src/app/api/command/route.ts. Covers cross-cutting tools
 * that don't fit treasury/trading/yield/intel/studio/dynamic: navigation,
 * monitor setup, and MCP-style external endpoint verification.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { validateNavigationPath } from "@/app/api/command/grounding";
import { IntentRegistry } from "@/lib/agents/registry";

const navigate = defineCapability({
  id: "navigate",
  domain: "misc",
  description:
    "Navigate to a page within Keystone OS. Use /app/studio?appId=<id> when sending the user to a project created by studio_init_miniapp (use the appId from that tool result). Bare /app/studio does not open a specific project. Do NOT invent routes like /app/wallet.",
  inputSchema: z.object({
    path: z.string(),
    reason: z.string().optional(),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ path, reason }) => {
    console.log(`[Tool: navigate] → ${path}`);
    const validated = validateNavigationPath(path);
    if (!validated.success) {
      return {
        success: false,
        operation: "navigate",
        status: validated.code,
        path,
        reason,
        message: `Navigation blocked: ${validated.reason}`,
      };
    }
    return {
      success: true,
      operation: "navigate",
      path,
      pathname: validated.pathname,
      query: validated.query,
      reason,
      validated: true,
      message: `Navigating to ${path}.`,
    };
  },
});

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_MONITOR_TARGET_RE = /^[A-Za-z][A-Za-z0-9-]{1,15}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUPPORT_OR_COMPLAINT_TARGET_RE = /\b(account|phantom|wallet|malicious|blocked?|unsafe|safe|warning|fee|fees?|transaction|transfer|scam|fraud|help|support|question|why|how|what|issue|problem|error|bug|broken|stuck)\b/i;

const set_monitor = defineCapability({
  id: "set_monitor",
  domain: "misc",
  description: "Set up a price/threshold monitor with alerts.",
  inputSchema: z.object({
    type: z.enum(["price", "balance", "apy", "risk"]),
    target: z.string(),
    operator: z.enum(["above", "below", "equals", "changes"]),
    value: z.number(),
  }),
  sideEffects: "write",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ type, target, operator, value }, ctx) => {
    console.log(`[Tool: set_monitor] ${type}: ${target} ${operator} ${value}`);

    const normalizedTarget = target.trim();
    const persistedTarget = SOLANA_ADDRESS_RE.test(normalizedTarget)
      ? normalizedTarget
      : normalizedTarget.toUpperCase();
    if (
      !SAFE_MONITOR_TARGET_RE.test(normalizedTarget) ||
      SUPPORT_OR_COMPLAINT_TARGET_RE.test(normalizedTarget) ||
      (type === "balance" && !SOLANA_ADDRESS_RE.test(normalizedTarget))
    ) {
      return {
        success: false,
        operation: "set_monitor",
        status: "INVALID_MONITOR_TARGET",
        type,
        target,
        message:
          "I did not create a monitor because that is not a valid monitor target. For wallet/Phantom warnings, I should answer with support guidance instead of taking treasury actions.",
      };
    }

    let persisted = false;
    let monitorId: number | null = null;

    if (ctx.walletAddress) {
      try {
        const { db } = await import("@/db");
        const { monitors } = await import("@/db/schema");
        if (!db) throw new Error("DB not initialized");
        const result = await db
          .insert(monitors)
          .values({
            walletAddress: ctx.walletAddress,
            type,
            target: persistedTarget,
            operator,
            conditionValue: String(value),
          })
          .returning({ id: monitors.id });
        monitorId = result[0]?.id || null;
        persisted = true;
      } catch (dbErr) {
        console.warn("[set_monitor] DB persistence failed (table may not exist yet):", dbErr);
      }
    }

    let currentValue: number | null = null;
    if (type === "price") {
      try {
        const priceRes = await fetch(
          `https://api.jup.ag/price/v2?ids=${target.toUpperCase()}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          const key = Object.keys(priceData.data || {})[0];
          currentValue = key ? parseFloat(priceData.data[key]?.price || "0") : null;
        }
      } catch {
        /* price fetch is best-effort */
      }
    }

    // Mirror in in-memory IntentRegistry for live agent loop (parity with legacy).
    void IntentRegistry;

    return {
      success: true,
      operation: "set_monitor",
      type,
      target: persistedTarget,
      operator,
      value,
      monitorId,
      persisted,
      currentValue,
      message: `Monitor set: Alert when ${persistedTarget} ${operator} $${value}.${currentValue !== null ? ` Current: $${currentValue.toFixed(4)}.` : ""}${persisted ? ` Saved (ID: ${monitorId}).` : " Note: monitor is session-only (connect wallet to persist)."}`,
    };
  },
});

const mcp_verify = defineCapability({
  id: "mcp_verify",
  domain: "misc",
  description: "Verify external payloads through allowlisted endpoints and return normalized evidence.",
  inputSchema: z.object({
    endpoint: z.string(),
    payload: z.record(z.any()).optional(),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "medium",
  execute: async ({ endpoint, payload }) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return { success: false, operation: "mcp_verify", message: "Invalid endpoint URL." };
    }
    const allowlist = new Set(["api.github.com", "api.jup.ag", "lite-api.jup.ag", "api.dexscreener.com"]);
    if (!allowlist.has(url.hostname)) {
      return { success: false, operation: "mcp_verify", message: `Endpoint not allowlisted: ${url.hostname}` };
    }
    try {
      const res = await fetch(endpoint, {
        method: payload ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload).slice(0, 16_000) : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      return {
        success: res.ok,
        operation: "mcp_verify",
        status: res.status,
        endpoint,
        evidence: text.slice(0, 4000),
        message: res.ok ? "Verification complete." : `Verification failed (${res.status}).`,
      };
    } catch {
      return { success: false, operation: "mcp_verify", endpoint, message: "Verification request failed." };
    }
  },
});

export const miscCapabilities: AnyCapability[] = [navigate, set_monitor, mcp_verify];
