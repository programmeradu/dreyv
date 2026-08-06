import type { Metadata } from "next";
import { cookies } from "next/headers";
import { STUDIO_PASS_COOKIE, STUDIO_PASS_VALUE } from "@/lib/media-studio/access";
import StudioPasswordGate from "../../../StudioPasswordGate";
import ProgressView from "./ProgressView";

export const metadata: Metadata = {
  title: "Render progress · Dreyv Video Studio",
  robots: { index: false, follow: false },
};

export const runtime = "edge";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pass = (await cookies()).get(STUDIO_PASS_COOKIE)?.value;
  const unlocked = pass === STUDIO_PASS_VALUE;
  if (!unlocked) return <StudioPasswordGate />;
  return <ProgressView jobId={id} />;
}
