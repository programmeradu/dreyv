/**
 * GET    /api/studio/media/assets       — list current team member's assets
 * POST   /api/studio/media/assets       — save a copy/storyboard variant the team kept
 *
 * Asset rows created by the generate-image / generate-video routes already
 * exist; this endpoint is for *text* artifacts (post copy, infographic
 * specs) which are only persisted on user "Save".
 */

import { NextRequest, NextResponse } from "next/server";
import type { AssetKind, Channel } from "@/lib/media-studio/brand";

export const runtime = "nodejs";

function isMigrationPending(err: unknown) {
  return err instanceof Error && err.message.includes("media_studio_assets");
}

function persistedUserId(id: string) {
  return id === STUDIO_PASS_USER_ID ? null : id;
}

const STUDIO_PASS_USER_ID = "studio-pass-user";

export async function GET(req: NextRequest) {
  try {
    const [accessModule, dbModule, schemaModule, drizzleModule] = await Promise.all([
      import("@/lib/media-studio/access"),
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);

    const gate = await accessModule.requireTeamMember(req);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const db = dbModule.db;
    if (!db) return NextResponse.json({ assets: [], error: "Database unavailable" }, { status: 200 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const rows = await db
      .select()
      .from(schemaModule.mediaStudioAssets)
      .orderBy(drizzleModule.desc(schemaModule.mediaStudioAssets.createdAt))
      .limit(limit);

    // Presign image previews lazily so the gallery shows thumbnails.
    const r2Module = await import("@/lib/agents/artifacts/r2-storage").catch(() => null);
    const enriched = await Promise.all(rows.map(async (r) => {
      if (!r.storageKey || !r2Module) return { ...r, previewUrl: null };
      try {
        const previewUrl = await r2Module.presignR2Get({
          key: r.storageKey,
          filename: `dreyv-${r.kind}.png`,
          mime: r.mimeType ?? "image/png",
          inline: true,
        });
        return { ...r, previewUrl };
      } catch {
        return { ...r, previewUrl: null };
      }
    }));

    return NextResponse.json({ assets: enriched });
  } catch (err) {
    if (isMigrationPending(err)) return NextResponse.json({ assets: [], migrationPending: true });
    const message = err instanceof Error ? `${err.name}: ${err.message}` : "Could not load media assets";
    return NextResponse.json({ assets: [], error: message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  let body: {
    kind?: AssetKind;
    channel?: Channel;
    title?: string;
    prompt?: string;
    spec?: Record<string, unknown>;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.kind || !body.prompt) {
    return NextResponse.json({ error: "kind and prompt are required" }, { status: 400 });
  }

  try {
    const [row] = await db.insert(mediaStudioAssets).values({
      userId: persistedUserId(gate.user.id),
      kind: body.kind,
      channel: body.channel ?? null,
      title: body.title ?? null,
      prompt: body.prompt,
      spec: body.spec ?? {},
      status: "ready",
    }).returning();

    return NextResponse.json({ asset: row });
  } catch (err) {
    if (isMigrationPending(err)) {
      return NextResponse.json({ error: "Media Studio migration pending", migrationPending: true }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not save asset" }, { status: 500 });
  }
}
