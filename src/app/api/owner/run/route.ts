/**
 * POST /api/owner/run — authenticated capability dispatcher for owner UIs.
 *
 * The session user is the same user the capability scopes against, so this is
 * a thin wrapper around the canonical CAPABILITIES registry: no rate limit,
 * no scope check (the user owns their own data), no usage charge. Errors map
 * cleanly to JSON `{ error: code }`. Used by /app/status, /app/workflows,
 * /app/observability, /app/developer.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { CAPABILITIES } from "@/lib/capabilities/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REGISTRY = new Map(CAPABILITIES.map((c) => [c.id, c]));

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { capability?: string; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = body.capability;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "missing_capability" }, { status: 400 });
  }
  const cap = REGISTRY.get(id);
  if (!cap) return NextResponse.json({ error: "unknown_capability" }, { status: 404 });

  const parsed = cap.inputSchema.safeParse(body.input ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await cap.handler(parsed.data, {
      userId: user.id,
      keyId: "owner:web",
      origin: req.headers.get("origin") ?? "owner_ui",
      transport: "rest",
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    const status =
      msg === "not_found" || msg === "workflow_not_found"
        ? 404
        : msg.startsWith("cycle_detected")
          ? 400
          : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
