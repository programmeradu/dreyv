/**
 * DACS Phase 1 — entry point used by `/api/command/route.ts`.
 *
 * Publishes `agent.command.submitted` to the bus when DACS is in shadow or
 * primary mode. In shadow mode the legacy pipeline still serves the user,
 * but DACS runs in parallel and writes its decision to the diff log.
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
    rawText: payload.rawText,
    promptMode: payload.promptMode,
    vaultState: payload.vaultState,
    walletState: payload.walletState,
    submittedAt: Date.now(),
  };

  const result = await publish({ name: "agent.command.submitted", data: full });
  return { commandId, submitted: result.delivered };
}
