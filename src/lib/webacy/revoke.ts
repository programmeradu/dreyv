"use client";

/**
 * Build + send an SPL Token `revoke` transaction for a specific mint owned
 * by `owner`. Finds the owner's token account for the mint (Token or
 * Token-2022) via `getParsedTokenAccountsByOwner`, then submits a Revoke
 * instruction (opcode 5, no data).
 *
 * We build the instruction by hand rather than importing
 * `createRevokeInstruction` from `@solana/spl-token` because that named
 * export doesn't resolve cleanly through this project's TS bundler
 * resolution — the same reason `src/lib/squads.ts` hardcodes
 * `TOKEN_2022_PROGRAM_ID` locally.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { WalletAdapterShape } from "@/lib/wallet/compat";

// Program IDs (constant; safe to hardcode).
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/**
 * SPL Token instruction 5 = Revoke.
 * Layout: 1 byte opcode, no arguments. Keys: [account (w), owner (s)].
 */
function buildRevokeInstruction(
  account: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([5]),
  });
}

export interface RevokeArgs {
  wallet: WalletAdapterShape;
  connection: Connection;
  owner: PublicKey;
  mint: string;
}

export async function revokeApproval({ wallet, connection, owner, mint }: RevokeArgs): Promise<string> {
  if (!wallet.sendTransaction) throw new Error("Connected wallet does not support sending transactions.");

  const mintPk = new PublicKey(mint);

  const [classic, t22] = await Promise.all([
    connection
      .getParsedTokenAccountsByOwner(owner, { mint: mintPk, programId: TOKEN_PROGRAM_ID })
      .catch(() => ({ value: [] as Array<{ pubkey: PublicKey }> })),
    connection
      .getParsedTokenAccountsByOwner(owner, { mint: mintPk, programId: TOKEN_2022_PROGRAM_ID })
      .catch(() => ({ value: [] as Array<{ pubkey: PublicKey }> })),
  ]);

  const found = classic.value[0]
    ? { account: classic.value[0].pubkey, programId: TOKEN_PROGRAM_ID }
    : t22.value[0]
    ? { account: t22.value[0].pubkey, programId: TOKEN_2022_PROGRAM_ID }
    : null;

  if (!found) {
    throw new Error(`No token account found for mint ${mint} — nothing to revoke.`);
  }

  const ix = buildRevokeInstruction(found.account, owner, found.programId);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(ix);

  const signature = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
