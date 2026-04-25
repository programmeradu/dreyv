/**
 * DACS Phase 1 — entry point used by `/api/command/route.ts`.
 *
 * Publishes `agent.command.submitted` to the bus when DACS is in shadow or
 * primary mode AND seeds a `command_diff_log` row so legacy + DACS snapshots
 * can be merged for parity review.
 */

import { publish } from "../bus";
import { dacsActive } from "./flag";
import { seedDiffRow } from "./diff-log";
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

  // Seed the diff-log row first so legacy writes that finish quickly
  // never race ahead of the DACS row insert.
  await seedDiffRow({
    commandId,
    walletAddress: full.walletAddress,
    rawText: full.rawText,
    promptMode: full.promptMode,
  });

  const result = await publish({ name: "agent.command.submitted", data: full });
  return { commandId, submitted: result.delivered };
}
