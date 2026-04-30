/**
 * /studio — root-level Dreyv Media Studio, password-gated ("opensesame").
 *
 * Moved from /app/studio/media so it lives outside the authenticated app
 * shell. Access is granted by setting a signed cookie via /api/studio/unlock.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { STUDIO_PASS_COOKIE, STUDIO_PASS_VALUE } from "@/lib/media-studio/access";
import MediaStudioClient from "@/app/app/studio/media/MediaStudioClient";
import StudioPasswordGate from "./StudioPasswordGate";

export const metadata: Metadata = {
  title: "Studio · Dreyv",
  description: "Internal Dreyv brand & content workbench.",
  robots: { index: false, follow: false },
};

export default async function StudioRootPage() {
  const pass = (await cookies()).get(STUDIO_PASS_COOKIE)?.value;
  if (pass !== STUDIO_PASS_VALUE) {
    return <StudioPasswordGate />;
  }
  return <MediaStudioClient />;
}
