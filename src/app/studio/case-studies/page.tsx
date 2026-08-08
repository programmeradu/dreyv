/**
 * /studio/case-studies — internal generator.
 *
 * Gated by the same studio password cookie as /studio. Lets the team
 * paste any Solana address, preview the generated case study live, and
 * (eventually) flag a wallet to publish to /case.
 *
 * v1: preview + screenshot-friendly render. Publishing is manual via the
 * featured.ts list (so we can review before going public).
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { STUDIO_PASS_COOKIE, STUDIO_PASS_VALUE } from "@/lib/media-studio/access";
import CaseStudiesShell from "./CaseStudiesShell";

export const metadata: Metadata = {
  title: "Case-study generator · Dreyv Studio",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const pass = (await cookies()).get(STUDIO_PASS_COOKIE)?.value;
  return <CaseStudiesShell unlocked={pass === STUDIO_PASS_VALUE} />;
}
