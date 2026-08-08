import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { dreyvConnections } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { getProvider, listProvidersPublic } from "@/lib/dreyv-gateway/providers";
import { sealSecrets } from "@/lib/dreyv-gateway/secrets-store";

export const dynamic = "force-dynamic";

/** GET /api/dreyv-gateway/connections
 *   ?providers=1  → return public provider catalog
 *   (default)     → return current user's connections (no secrets)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("providers") === "1") {
    return NextResponse.json({ providers: listProvidersPublic() });
  }

  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dbx = db;
  if (!dbx) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const rows = await dbx
    .select({
      id: dreyvConnections.id,
      provider: dreyvConnections.provider,
      label: dreyvConnections.label,
      authType: dreyvConnections.authType,
      publicConfig: dreyvConnections.publicConfig,
      status: dreyvConnections.status,
      lastUsedAt: dreyvConnections.lastUsedAt,
      createdAt: dreyvConnections.createdAt,
    })
    .from(dreyvConnections)
    .where(eq(dreyvConnections.userId, user.id))
    .orderBy(desc(dreyvConnections.createdAt));

  return NextResponse.json({ connections: rows });
}

/** POST — create or upsert a connection.
 * Body: { provider, label?, secrets: {...}, publicConfig?: {...} }
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dbx = db;
  if (!dbx) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  let body: {
    provider?: string;
    label?: string;
    secrets?: Record<string, string>;
    publicConfig?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = body.provider && getProvider(body.provider);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  // Validate required secret fields
  const incoming = body.secrets ?? {};
  for (const f of provider.secretFields) {
    if (f.required && !incoming[f.name]) {
      return NextResponse.json(
        { error: "missing_field", field: f.name, message: `${f.label} is required.` },
        { status: 400 }
      );
    }
  }

  const sealed = sealSecrets(incoming);

  // Upsert: one connection per (user, provider) by default
  const [existing] = await dbx
    .select({ id: dreyvConnections.id })
    .from(dreyvConnections)
    .where(and(eq(dreyvConnections.userId, user.id), eq(dreyvConnections.provider, provider.id)))
    .limit(1);

  if (existing) {
    await dbx
      .update(dreyvConnections)
      .set({
        label: body.label ?? null,
        encryptedSecrets: sealed,
        publicConfig: body.publicConfig ?? {},
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(dreyvConnections.id, existing.id));
    return NextResponse.json({ ok: true, id: existing.id, updated: true });
  }

  const [created] = await dbx
    .insert(dreyvConnections)
    .values({
      userId: user.id,
      provider: provider.id,
      label: body.label ?? null,
      authType: provider.authType,
      encryptedSecrets: sealed,
      publicConfig: body.publicConfig ?? {},
      status: "active",
    })
    .returning({ id: dreyvConnections.id });

  return NextResponse.json({ ok: true, id: created.id, created: true });
}

/** DELETE ?id=... — remove a connection. */
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dbx = db;
  if (!dbx) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await dbx
    .delete(dreyvConnections)
    .where(and(eq(dreyvConnections.id, id), eq(dreyvConnections.userId, user.id)));

  return NextResponse.json({ ok: true });
}
