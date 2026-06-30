/**
 * GET  /api/studio/video/tiktok            → returns cached rows + digest
 * POST /api/studio/video/tiktok            → syncs the last N videos via the
 *                                            TikTok connector gateway, upserts
 *                                            them into studio_video_performance,
 *                                            then returns the fresh digest.
 *
 * Requires the workspace's TikTok connector to be linked (TIKTOK_API_KEY +
 * LOVABLE_API_KEY env vars). When unlinked we return a clear 412 so the UI
 * can surface a "Connect TikTok" CTA.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { loadTikTokRows, upsertTikTokRows, type UpsertRow } from "@/lib/media-studio/tiktok-store";
import { summarizeTikTokPerformance } from "@/lib/media-studio/intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/tiktok";

function gatewayHeaders(): Record<string, string> | null {
  const lovable = process.env.LOVABLE_API_KEY;
  const tiktok = process.env.TIKTOK_API_KEY;
  if (!lovable || !tiktok) return null;
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": tiktok,
    "Content-Type": "application/json",
  };
}

type TikTokVideo = {
  id: string;
  title?: string;
  video_description?: string;
  create_time?: number;          // seconds since epoch
  duration?: number;             // seconds
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  share_url?: string;
  cover_image_url?: string;
  // Optional analytics fields — only available on Business accounts.
  // Note: TikTok's public Display API doesn't return per-video watch-through
  // for non-business accounts. We surface 0 / null when missing.
  avg_time_watched?: number;
  full_video_watched_rate?: number;
};

const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "create_time",
  "duration",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
  "share_url",
  "cover_image_url",
].join(",");

export async function GET(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const rows = await loadTikTokRows().catch(() => []);
  const digest = summarizeTikTokPerformance(rows);
  return NextResponse.json({
    connected: Boolean(gatewayHeaders()),
    rowCount: rows.length,
    digest,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const headers = gatewayHeaders();
  if (!headers) {
    return NextResponse.json(
      {
        error:
          "TikTok connector isn't linked yet. Link it from the studio's 'Connect TikTok' button so we can pull your last 20 videos.",
      },
      { status: 412 },
    );
  }

  try {
    // 1. List videos (paginated, but we only want the last ~20 for the digest).
    const listRes = await fetch(`${GATEWAY_BASE}/video/list/?fields=${encodeURIComponent(VIDEO_FIELDS)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ max_count: 20 }),
    });

    if (!listRes.ok) {
      const text = await listRes.text().catch(() => "");
      return NextResponse.json(
        { error: `TikTok video/list failed: HTTP ${listRes.status} — ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const listJson = await listRes.json();
    const videos: TikTokVideo[] = listJson?.data?.videos ?? [];

    if (videos.length === 0) {
      return NextResponse.json({
        synced: 0,
        digest: summarizeTikTokPerformance(await loadTikTokRows()),
        note: "TikTok returned no videos. If you just posted, give it a few minutes.",
      });
    }

    // 2. Resolve account_id from the user/info endpoint (open_id is stable).
    let accountId = "default";
    try {
      const meRes = await fetch(`${GATEWAY_BASE}/user/info/?fields=open_id,display_name`, {
        method: "GET",
        headers,
      });
      if (meRes.ok) {
        const meJson = await meRes.json();
        const openId = meJson?.data?.user?.open_id;
        if (typeof openId === "string" && openId.length > 0) accountId = openId;
      }
    } catch {
      /* fall back to "default" */
    }

    // 3. Map → upsert.
    const upserts: UpsertRow[] = videos.map((v) => ({
      accountId,
      videoId: String(v.id),
      caption: v.video_description ?? v.title ?? null,
      postedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      durationSec: v.duration ?? null,
      viewCount: v.view_count ?? 0,
      likeCount: v.like_count ?? 0,
      commentCount: v.comment_count ?? 0,
      shareCount: v.share_count ?? 0,
      avgWatchSec: v.avg_time_watched ?? null,
      fullWatchRate: v.full_video_watched_rate ?? null,
      shareUrl: v.share_url ?? null,
      coverUrl: v.cover_image_url ?? null,
    }));

    const synced = await upsertTikTokRows(upserts);

    const rows = await loadTikTokRows(accountId);
    return NextResponse.json({
      synced,
      accountId,
      digest: summarizeTikTokPerformance(rows),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TikTok sync failed";
    console.error("[video/tiktok] sync error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
