/**
 * Tiny data-access wrapper for the `studio_video_performance` table.
 *
 * Reads/writes use the Supabase service-role client so RLS doesn't fight
 * the studio (the studio is already gated by `requireTeamMember`).
 */

import type { TikTokPerformanceRow } from "./intelligence";

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
  console.warn("[tiktok-store] Supabase has been purged. TikTok row loading is temporarily disabled until migrated to Neon.");
  return [];
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
  console.warn("[tiktok-store] Supabase has been purged. TikTok row upsert is temporarily disabled until migrated to Neon.");
  return 0;
}
