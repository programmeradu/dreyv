/**
 * Jupiter `/swap-instructions` response → `TransactionInstruction[]`.
 *
 * Jupiter returns instructions as `{ programId, accounts: [{ pubkey, isSigner, isWritable }], data: <base64> }`.
 * We deserialize them into real `TransactionInstruction` objects so the
 * Simulation Firewall can run a true on-chain simulation against the
 * exact bytes that would be signed.
 */

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

export interface RawJupiterInstruction {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string; // base64
}

export function jupiterInstructionToTx(ix: RawJupiterInstruction): TransactionInstruction {
  if (!ix || !ix.programId) {
    throw new Error("jupiterInstructionToTx: missing programId");
  }
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts || []).map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: !!k.isSigner,
      isWritable: !!k.isWritable,
    })),
    data: Buffer.from(ix.data || "", "base64"),
  });
}

export interface JupiterSwapInstructionsResponse {
  computeBudgetInstructions?: RawJupiterInstruction[];
  setupInstructions?: RawJupiterInstruction[];
  swapInstruction: RawJupiterInstruction;
  cleanupInstruction?: RawJupiterInstruction | null;
  addressLookupTableAddresses?: string[];
  error?: string;
}

/**
 * Flatten a full Jupiter swap-instructions response into a single
 * ordered array of `TransactionInstruction` objects suitable for
 * composing a `VersionedTransaction`.
 */
export function flattenJupiterInstructions(
  resp: JupiterSwapInstructionsResponse
): TransactionInstruction[] {
  if (!resp || resp.error) {
    throw new Error(`Jupiter swap-instructions error: ${resp?.error || "empty response"}`);
  }
  if (!resp.swapInstruction) {
    throw new Error("Jupiter response missing required `swapInstruction`");
  }

  const out: TransactionInstruction[] = [];
  for (const ix of resp.computeBudgetInstructions || []) out.push(jupiterInstructionToTx(ix));
  for (const ix of resp.setupInstructions || []) out.push(jupiterInstructionToTx(ix));
  out.push(jupiterInstructionToTx(resp.swapInstruction));
  if (resp.cleanupInstruction) out.push(jupiterInstructionToTx(resp.cleanupInstruction));
  return out;
}

/**
 * Resolve the address lookup tables Jupiter references so that the
 * resulting `VersionedTransaction` can be properly compiled.
 */
export async function resolveLookupTables(
  connection: Connection,
  addresses: string[] | undefined
): Promise<AddressLookupTableAccount[]> {
  if (!addresses || addresses.length === 0) return [];
  const out: AddressLookupTableAccount[] = [];
  for (const addr of addresses) {
    const pk = new PublicKey(addr);
    const account = await connection.getAddressLookupTable(pk);
    if (account.value) out.push(account.value);
  }
  return out;
}
