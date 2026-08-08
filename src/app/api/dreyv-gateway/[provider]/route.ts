export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { dreyvConnections } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { getProvider } from "@/lib/dreyv-gateway/providers";
import { openSecrets } from "@/lib/dreyv-gateway/secrets-store";
import { checkRate } from "@/lib/dreyv-gateway/rate-limit";

export const dynamic = "force-dynamic";

const MAX_RESPONSE_BYTES = 1_500_000; // 1.5 MB cap

interface InvokeBody {
  operation?: string;
  params?: Record<string, unknown>;
  /** Optional connection id when a user has multiple for one provider. */
  connectionId?: string;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await context.params;
  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 404 });
  }

  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbx = db;
  if (!dbx) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const rate = checkRate(user.id, providerId);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", resetAt: new Date(rate.resetAt).toISOString() },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } }
    );
  }

  let body: InvokeBody;
  try {
    body = (await req.json()) as InvokeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const operation = body.operation;
  if (!operation || typeof operation !== "string") {
    return NextResponse.json({ error: "operation is required" }, { status: 400 });
  }

  const adapter = provider.operations[operation];
  if (!adapter) {
    return NextResponse.json(
      { error: `Operation '${operation}' not allowed for ${providerId}` },
      { status: 400 }
    );
  }

  // Load connection (if any). Public-API providers (no secret fields) work without one.
  let secrets: Record<string, string> = {};
  let publicConfig: Record<string, unknown> = {};

  if (provider.secretFields.length > 0 || provider.publicFields?.length) {
    const where = body.connectionId
      ? and(eq(dreyvConnections.id, body.connectionId), eq(dreyvConnections.userId, user.id))
      : and(eq(dreyvConnections.userId, user.id), eq(dreyvConnections.provider, providerId));

    const [conn] = await dbx
      .select()
      .from(dreyvConnections)
      .where(where)
      .limit(1);

    if (!conn && provider.secretFields.length > 0) {
      return NextResponse.json(
        {
          error: "connection_required",
          message: `Connect ${provider.name} in Studio settings before using this template.`,
          provider: providerId,
        },
        { status: 412 }
      );
    }

    if (conn) {
      secrets = openSecrets(conn.encryptedSecrets);
      publicConfig = (conn.publicConfig as Record<string, unknown>) ?? {};
      // fire-and-forget last-used update
      dbx
        .update(dreyvConnections)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(dreyvConnections.id, conn.id))
        .catch(() => {});
    }
  }

  // Build the upstream request
  let built;
  try {
    built = adapter(body.params ?? {}, { secrets, publicConfig });
  } catch (e) {
    return NextResponse.json(
      { error: "adapter_error", message: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }

  // Forward
  let upstream: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    upstream = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body !== undefined ? JSON.stringify(built.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    return NextResponse.json(
      { error: "upstream_unreachable", message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
  clearTimeout(timeout);

  const contentType = upstream.headers.get("content-type") || "";
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    return NextResponse.json({ error: "response_too_large" }, { status: 502 });
  }

  let data: unknown;
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      data = { raw: new TextDecoder().decode(buf) };
    }
  } else {
    data = { raw: new TextDecoder().decode(buf) };
  }

  return NextResponse.json(
    { ok: upstream.ok, status: upstream.status, data },
    {
      status: upstream.ok ? 200 : upstream.status,
      headers: {
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-Dreyv-Provider": providerId,
      },
    }
  );
}
