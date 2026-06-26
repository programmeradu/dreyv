/**
 * /studio/reddit — Reddit draft generator.
 *
 * Same password gate as /studio. Generates subreddit-tuned post drafts
 * grounded in the Dreyv developers surface (MCP + API + hero hooks).
 * No auto-posting — drafts are copied out and submitted by a human.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { STUDIO_PASS_COOKIE, STUDIO_PASS_VALUE } from "@/lib/media-studio/access";
import RedditStudioShell from "./RedditStudioShell";

export const metadata: Metadata = {
  title: "Reddit drafts · Dreyv Studio",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const pass = (await cookies()).get(STUDIO_PASS_COOKIE)?.value;
  return <RedditStudioShell unlocked={pass === STUDIO_PASS_VALUE} />;
}
