/**
 * Tiny data-access wrapper for the `studio_video_performance` table.
 *
 * Reads/writes use the Supabase service-role client so RLS doesn't fight
 * the studio (the studio is already gated by `requireTeamMember`).
 */

import { createClient } from "@supabase/supabase-js";
import type { TikTokPerformanceRow } from "./intelligence";

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type Row = {
  video_id: string;
  caption: string | null;
  posted_at: string | null;
  view_count: number | string;
  like_count: number | string;
  comment_count: number | string;
  share_count: number | string;
  avg_watch_sec: number | string | null;
  full_watch_rate: number | string | null;
  duration_sec: number | null;
  share_url: string | null;
};

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function loadTikTokRows(accountId = "default"): Promise<TikTokPerformanceRow[]> {
  const sb = adminClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from("studio_video_performance")
    .select("video_id, caption, posted_at, view_count, like_count, comment_count, share_count, avg_watch_sec, full_watch_rate, duration_sec, share_url")
    .eq("account_id", accountId)
    .order("posted_at", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("[tiktok-store] load failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: Row) => ({
    videoId: r.video_id,
    caption: r.caption,
    postedAt: r.posted_at,
    viewCount: toNumber(r.view_count),
    likeCount: toNumber(r.like_count),
    commentCount: toNumber(r.comment_count),
    shareCount: toNumber(r.share_count),
    avgWatchSec: r.avg_watch_sec == null ? null : toNumber(r.avg_watch_sec),
    fullWatchRate: r.full_watch_rate == null ? null : toNumber(r.full_watch_rate),
    durationSec: r.duration_sec,
    shareUrl: r.share_url,
  }));
}

export type UpsertRow = {
  accountId: string;
  videoId: string;
  caption: string | null;
  postedAt: string | null;
  durationSec: number | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  avgWatchSec: number | null;
  fullWatchRate: number | null;
  shareUrl: string | null;
  coverUrl: string | null;
};

export async function upsertTikTokRows(rows: UpsertRow[]): Promise<number> {
  const sb = adminClient();
  if (!sb) throw new Error("Supabase service-role not configured.");
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({
    account_id: r.accountId,
    video_id: r.videoId,
    caption: r.caption,
    posted_at: r.postedAt,
    duration_sec: r.durationSec,
    view_count: r.viewCount,
    like_count: r.likeCount,
    comment_count: r.commentCount,
    share_count: r.shareCount,
    avg_watch_sec: r.avgWatchSec,
    full_watch_rate: r.fullWatchRate,
    share_url: r.shareUrl,
    cover_url: r.coverUrl,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await sb
    .from("studio_video_performance")
    .upsert(payload, { onConflict: "account_id,video_id" });
  if (error) throw new Error(`tiktok upsert failed: ${error.message}`);
  return payload.length;
}
