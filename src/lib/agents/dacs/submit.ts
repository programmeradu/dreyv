/**
 * DACS Phase 6 — command submission.
 *
 * Publishes `agent.command.submitted` to the bus. The Phase 1 shadow diff-log
 * was removed at cutover; downstream consumers (router, planner, executor)
 * subscribe directly to the bus.
 */

import { publish } from "../bus";
import { dacsActive } from "./flag";
import type { CommandSubmittedPayload } from "./types";

export async function submitCommand(payload: Omit<CommandSubmittedPayload, "commandId" | "submittedAt"> & {
  commandId?: string;
}): Promise<{ commandId: string; submitted: boolean }> {
  if (!dacsActive()) return { commandId: payload.commandId || "noop", submitted: false };

  const commandId = payload.commandId || `cmd_${Math.random().toString(36).slice(2, 12)}`;
  const full: CommandSubmittedPayload = {
    commandId,
    walletAddress: payload.walletAddress,
    vaultAddress: payload.vaultAddress ?? null,
    rawText: payload.rawText,
    promptMode: payload.promptMode,
    vaultState: payload.vaultState,
    walletState: payload.walletState,
    submittedAt: Date.now(),
  };

  const result = await publish({ name: "agent.command.submitted", data: full });
  return { commandId, submitted: result.delivered };
}
