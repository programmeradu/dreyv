/**
 * GET    /api/studio/media/assets       — list current team member's assets
 * POST   /api/studio/media/assets       — save a copy/storyboard variant the team kept
 *
 * Asset rows created by the generate-image / generate-video routes already
 * exist; this endpoint is for *text* artifacts (post copy, infographic
 * specs) which are only persisted on user "Save".
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { db } from "@/db";
import { mediaStudioAssets } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { presignR2Get } from "@/lib/agents/artifacts/r2-storage";
import type { AssetKind, Channel } from "@/lib/media-studio/brand";

export const runtime = "nodejs";

function isMigrationPending(err: unknown) {
  return err instanceof Error && err.message.includes("media_studio_assets");
}

export async function GET(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  try {
    const rows = await db
      .select()
      .from(mediaStudioAssets)
      .orderBy(desc(mediaStudioAssets.createdAt))
      .limit(limit);

    // Presign image previews lazily so the gallery shows thumbnails.
    const enriched = await Promise.all(rows.map(async (r) => {
      if (!r.storageKey) return { ...r, previewUrl: null };
      try {
        const previewUrl = await presignR2Get({
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
    return NextResponse.json({ error: "Could not load media assets" }, { status: 500 });
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
      userId: gate.user.id,
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
