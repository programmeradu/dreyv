/**
 * Shared Inngest client. The serve endpoint mounts this; functions register on it.
 *
 * In the Lovable connector model the SDK uses INNGEST_SIGNING_KEY to verify
 * inbound calls. Outbound event publishing goes through the gateway via
 * `src/lib/agents/bus.ts` — do NOT call `inngest.send()` directly.
 */
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "dreyv-agents",
  name: "Dreyv Agents",
});
