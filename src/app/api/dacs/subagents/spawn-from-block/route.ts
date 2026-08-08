/**
 * POST /api/dacs/subagents/spawn-from-block
 *
 * Spawn a subagent directly from a canvas finding (block). The block is
 * recorded in `spawned_from` so the UI can link back. Optional cron + trigger
 * specs are persisted as-is.
 *
 * Body:
 *   {
 *     walletAddress?: string | null,
 *     block: { id: string, type: string, title: string, payload?: object },
 *     rawText: string,                       // command to re-run on each tick
 *     intervalSeconds?: number,              // default 86400
 *     cronExpr?: string,                     // optional, takes precedence
 *     trigger?: TriggerSpec,                 // optional condition gate
 *     maxTicks?: number,
 *     expiresAt?: string                     // ISO
 *   }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { spawnSubagent } from "@/lib/agents/dacs/subagent-store";
import type { Intent, Plan } from "@/lib/agents/dacs/types";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  walletAddress: z.string().nullable().optional(),
  block: z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    payload: z.record(z.unknown()).optional(),
  }),
  rawText: z.string().min(1).max(2000),
  intervalSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
  cronExpr: z.string().min(1).max(120).optional(),
  // Trigger spec — recursive (composite kinds carry `children`). We accept
  // any object whose top-level `kind` is in the supported set; deeper
  // validation happens in the evaluator at runtime.
  trigger: z
    .object({
      kind: z.enum([
        "price",
        "price_change",
        "wallet",
        "tx",
        "yield",
        "unlock",
        "sentiment",
        "news",
        "handoff",
        "all",
        "any",
      ]),
      op: z.enum(["lt", "gt", "lte", "gte", "eq", "contains", "any"]).optional(),
      symbol: z.string().optional(),
      windowMinutes: z.number().int().positive().optional(),
      token: z.string().optional(),
      walletAddress: z.string().optional(),
      pool: z.string().optional(),
      query: z.string().optional(),
      specialist: z.string().optional(),
      riskLevel: z.string().optional(),
      value: z.union([z.number(), z.string()]).optional(),
      children: z.array(z.record(z.unknown())).optional(),
    })
    .passthrough()
    .optional(),
  maxTicks: z.number().int().positive().max(10_000).optional(),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Minimal Intent/Plan shells so dacs_subagents NOT NULL constraints hold;
  // real intent/plan are re-derived on each tick from rawText.
  const intent: Intent = {
    kind: "monitor",
    entities: {},
    constraints: {},
    confidence: 0.5,
    ambiguities: [],
    rawText: input.rawText,
  };
  const planTemplate: Plan = {
    steps: [],
    rationale: `Spawned from canvas block ${input.block.id}`,
    reversibility: "reversible",
    riskScore: 0.2,
  };

  const id = await spawnSubagent({
    walletAddress: input.walletAddress ?? null,
    parentCommandId: `canvas_${input.block.id}`,
    title: input.block.title.slice(0, 120),
    rawText: input.rawText,
    intent,
    planTemplate,
    intervalSeconds: input.intervalSeconds ?? 86_400,
    cronExpr: input.cronExpr ?? null,
    trigger: (input.trigger as never) ?? null,
    spawnedFrom: {
      kind: "canvas_block",
      blockId: input.block.id,
      blockType: input.block.type,
      title: input.block.title,
    },
    maxTicks: input.maxTicks ?? null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  });

  if (!id) {
    return NextResponse.json({ ok: false, error: "spawn_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, subagentId: id });
}
