/**
 * DACS Phase 0 — Dynamic-tools domain capabilities.
 *
 * Extracted from src/app/api/command/route.ts. Covers the Phase-2 dynamic
 * tool sandbox contract: drafting non-executable tool proposals, validating
 * composed plans against an allowlist, and routing approved plans through
 * `evaluateSandboxPlan`.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { evaluateSandboxPlan } from "@/lib/dynamic-tools/sandbox-runner";

const propose_dynamic_tool = defineCapability({
  id: "propose_dynamic_tool",
  domain: "dynamic",
  description: "Create a non-executable dynamic tool draft from a user goal.",
  inputSchema: z.object({
    name: z.string(),
    objective: z.string(),
    requiredTools: z.array(z.string()).optional().default([]),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ name, objective, requiredTools }) => {
    const draftId = `draft_${Math.random().toString(36).slice(2, 10)}`;
    return {
      success: true,
      operation: "propose_dynamic_tool",
      draft: { draftId, name, objective, requiredTools, executable: false, status: "draft" },
      message: `Draft ${name} created (non-executable).`,
    };
  },
});

const COMPOSED_PLAN_ALLOWLIST = new Set([
  "get_project_by_id",
  "get_project_by_name",
  "list_recent_projects",
  "get_studio_project_link",
  "navigate",
]);

const run_composed_tool_plan = defineCapability({
  id: "run_composed_tool_plan",
  domain: "dynamic",
  description: "Run a composed plan using existing allowlisted Keystone tools only.",
  inputSchema: z.object({
    steps: z.array(
      z.object({
        tool: z.string(),
        input: z.record(z.any()).optional().default({}),
      }),
    ),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "medium",
  execute: async ({ steps }) => {
    const invalid = steps.filter((s) => !COMPOSED_PLAN_ALLOWLIST.has(s.tool));
    if (invalid.length > 0) {
      return {
        success: false,
        operation: "run_composed_tool_plan",
        message: `Plan blocked: tool(s) not allowed (${invalid.map((x) => x.tool).join(", ")}).`,
      };
    }
    return {
      success: true,
      operation: "run_composed_tool_plan",
      executed: steps.map((s, i) => ({ step: i + 1, tool: s.tool, status: "accepted_for_execution" })),
      message: "Composed plan validated. Execute steps explicitly in follow-up calls.",
    };
  },
});

const sandbox_execute_dynamic_tool = defineCapability({
  id: "sandbox_execute_dynamic_tool",
  domain: "dynamic",
  description: "Phase-2 sandbox contract for approved dynamic-tool execution plans (no arbitrary code).",
  inputSchema: z.object({
    draftId: z.string(),
    name: z.string(),
    objective: z.string(),
    approvalToken: z.string().optional(),
    steps: z.array(
      z.object({
        tool: z.string(),
        input: z.record(z.any()).optional().default({}),
      }),
    ),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "high",
  execute: async ({ draftId, name, objective, approvalToken, steps }) => {
    const sandbox = evaluateSandboxPlan({ draftId, name, objective, approvalToken, steps });
    if (!sandbox.accepted) {
      return {
        success: false,
        operation: "sandbox_execute_dynamic_tool",
        draftId,
        approved: sandbox.approved,
        riskLevel: sandbox.riskLevel,
        policy: sandbox.policy,
        message: `Sandbox blocked execution: ${sandbox.blockedReason}`,
      };
    }
    return {
      success: true,
      operation: "sandbox_execute_dynamic_tool",
      draftId,
      approved: sandbox.approved,
      riskLevel: sandbox.riskLevel,
      policy: sandbox.policy,
      executionPlan: sandbox.executionPlan,
      message: "Sandbox execution plan accepted. Execute via explicit composed tool calls.",
    };
  },
});

export const dynamicCapabilities: AnyCapability[] = [
  propose_dynamic_tool,
  run_composed_tool_plan,
  sandbox_execute_dynamic_tool,
];
