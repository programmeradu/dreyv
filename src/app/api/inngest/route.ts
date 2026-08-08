export const runtime = "edge";
/**
 * Inngest serve endpoint.
 *
 * URL: `/api/inngest` — paste this (or `https://<your-domain>/api/inngest`)
 * into the Inngest dashboard "Sync new app" flow, or simply visit it once
 * after deploy and Inngest will auto-register the functions.
 *
 * Auth is handled by the Inngest SDK using `INNGEST_SIGNING_KEY` from env
 * (provided automatically by the Lovable connector).
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/agents/inngest-client";
import { ALL_FUNCTIONS } from "@/lib/agents/functions";
import { BRAIN_FUNCTIONS } from "@/lib/agents/brains/functions";
import { DACS_FUNCTIONS } from "@/lib/agents/dacs/functions";
import { TX_STREAM_FUNCTIONS } from "@/lib/agents/tx-stream/functions";
import { TREASURY_WATCHERS } from "@/lib/agents/treasury/watchers";
import { studioVideoRender } from "@/lib/agents/studio-video";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...ALL_FUNCTIONS,
    ...BRAIN_FUNCTIONS,
    ...DACS_FUNCTIONS,
    ...TX_STREAM_FUNCTIONS,
    ...TREASURY_WATCHERS,
    studioVideoRender,
  ],
});
