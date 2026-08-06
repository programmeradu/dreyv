/**
 * /studio/video — Dedicated TikTok Video Studio.
 *
 * Same password gate as /studio. Generates full TikTok production packs
 * (hook + shot list + per-tool prompts + voiceover + captions + posting
 * window + mascot consistency notes) grounded in the developer surface
 * and the 18 format archetypes from our research pipelines.
 *
 * No videos are auto-generated or auto-posted — packs are copied out and
 * pasted into Hedra / Hailuo / Kling / Veo / Wan by the team.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { STUDIO_PASS_COOKIE, STUDIO_PASS_VALUE } from "@/lib/media-studio/access";
import VideoStudioShell from "./VideoStudioShell";

export const metadata: Metadata = {
  title: "Video Studio · Dreyv",
  robots: { index: false, follow: false },
};

export const runtime = "edge";
export default async function Page() {
  const pass = (await cookies()).get(STUDIO_PASS_COOKIE)?.value;
  return <VideoStudioShell unlocked={pass === STUDIO_PASS_VALUE} />;
}
