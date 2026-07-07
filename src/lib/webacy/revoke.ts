"use client";

/**
 * Build + send an SPL Token `revoke` transaction for a specific mint owned
 * by `owner`. Finds the owner's associated token account for the mint via
 * `getTokenAccountsByOwner`, then submits `createRevokeInstruction`.
 *
 * Returns the tx signature on success. Throws on any failure — the caller
 * is expected to show the error in the UI.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createRevokeInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { WalletAdapterShape } from "@/lib/wallet/compat";

export interface RevokeArgs {
  wallet: WalletAdapterShape;
  connection: Connection;
  owner: PublicKey;
  mint: string;
}

export async function revokeApproval({ wallet, connection, owner, mint }: RevokeArgs): Promise<string> {
  if (!wallet.sendTransaction) throw new Error("Connected wallet does not support sending transactions.");

  const mintPk = new PublicKey(mint);

  // Look under both classic Token Program and Token-2022; whichever owns
  // the account is what we build the revoke against.
  const [classic, t22] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { mint: mintPk, programId: TOKEN_PROGRAM_ID }).catch(() => ({ value: [] })),
    connection.getParsedTokenAccountsByOwner(owner, { mint: mintPk, programId: TOKEN_2022_PROGRAM_ID }).catch(() => ({ value: [] })),
  ]);

  const found =
    classic.value[0]
      ? { account: classic.value[0].pubkey, programId: TOKEN_PROGRAM_ID }
      : t22.value[0]
      ? { account: t22.value[0].pubkey, programId: TOKEN_2022_PROGRAM_ID }
      : null;

  if (!found) {
    throw new Error(`No token account found for mint ${mint} — nothing to revoke.`);
  }

  const ix: TransactionInstruction = createRevokeInstruction(
    found.account,
    owner,
    [],
    found.programId
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(ix);

  const signature = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
