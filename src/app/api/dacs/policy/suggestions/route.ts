export const runtime = "edge";
/**
 * DACS Phase 3b — Pending policy suggestions endpoint.
 *
 * The nightly policy-derivation cron writes proposed policy changes into
 * `user_agent_policy.pending_suggestions`. This endpoint lets the user
 * review them in /app/settings and accept (apply + remove) or dismiss
 * (remove without applying).
 *
 * GET    /api/dacs/policy/suggestions?wallet=
 * POST   /api/dacs/policy/suggestions  body: { walletAddress, action, id }
 *
 * Action effects:
 *   - "accept"  → mutate the policy field implied by suggestion.kind, then
 *                  drop the suggestion from pending_suggestions.
 *   - "dismiss" → drop the suggestion without changing policy.
 *
 * All writes are best-effort idempotent: re-accepting the same id is a no-op
 * because the suggestion will already be gone.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { userAgentPolicy } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface Suggestion {
  id: string;
  kind:
    | "add_protocol_allowlist"
    | "raise_auto_approve_threshold"
    | "lower_daily_cap"
    | "add_protocol_denylist";
  value: unknown;
  rationale: string;
  confidence: number;
  createdAt: string;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  }
  const [row] = await db
    .select()
    .from(userAgentPolicy)
    .where(eq(userAgentPolicy.walletAddress, wallet))
    .limit(1);
  return NextResponse.json({
    ok: true,
    walletAddress: wallet,
    suggestions: row ? asArray<Suggestion>(row.pendingSuggestions) : [],
    lastDerivationAt: row?.lastDerivationAt ?? null,
  });
}

interface PostBody {
  walletAddress?: string;
  action?: "accept" | "dismiss";
  id?: string;
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { walletAddress, action, id } = body;
  if (!walletAddress || !id || (action !== "accept" && action !== "dismiss")) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(userAgentPolicy)
    .where(eq(userAgentPolicy.walletAddress, walletAddress))
    .limit(1);
  if (!row) {
    return NextResponse.json({ ok: false, error: "policy_not_found" }, { status: 404 });
  }

  const suggestions = asArray<Suggestion>(row.pendingSuggestions);
  const target = suggestions.find((s) => s.id === id);
  if (!target) {
    return NextResponse.json({ ok: true, applied: false, removed: false });
  }

  const remaining = suggestions.filter((s) => s.id !== id);
  const updates: Record<string, unknown> = {
    pendingSuggestions: remaining,
    updatedAt: new Date(),
  };

  let applied = false;
  if (action === "accept") {
    switch (target.kind) {
      case "add_protocol_allowlist": {
        if (typeof target.value === "string") {
          const list = asArray<string>(row.protocolAllowlist);
          if (!list.includes(target.value)) {
            updates.protocolAllowlist = [...list, target.value];
          }
          applied = true;
        }
        break;
      }
      case "add_protocol_denylist": {
        if (typeof target.value === "string") {
          const list = asArray<string>(row.protocolDenylist);
          if (!list.includes(target.value)) {
            updates.protocolDenylist = [...list, target.value];
          }
          applied = true;
        }
        break;
      }
      case "raise_auto_approve_threshold": {
        if (typeof target.value === "number") {
          updates.autoApproveBelowUsd = String(target.value);
          applied = true;
        }
        break;
      }
      case "lower_daily_cap": {
        if (typeof target.value === "number") {
          updates.dailyValueCapUsd = String(target.value);
          applied = true;
        }
        break;
      }
    }
  }

  await db
    .update(userAgentPolicy)
    .set(updates)
    .where(eq(userAgentPolicy.walletAddress, walletAddress));

  return NextResponse.json({ ok: true, applied, removed: true, action });
}
