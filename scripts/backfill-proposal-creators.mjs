#!/usr/bin/env node
/**
 * One-shot backfill for vault_proposals.created_by.
 *
 * Squads V4's Proposal account does NOT carry a `creator` pubkey — that lives
 * on the per-index VaultTransaction / ConfigTransaction / Batch account. Old
 * sync runs persisted `created_by = null`; this script re-derives the creator
 * for each row from chain and updates rows where it is still missing.
 *
 * Usage:
 *   node scripts/backfill-proposal-creators.mjs
 *   node scripts/backfill-proposal-creators.mjs --vault <vaultAddress>   # single vault
 *   node scripts/backfill-proposal-creators.mjs --dry-run                # don't write
 */

import * as dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import * as squads from '@sqds/multisig';
import postgres from 'postgres';

dotenv.config({ path: '.env.local' });
dotenv.config();

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  'https://api.mainnet-beta.solana.com';
const DATABASE_URL =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL / POSTGRES_URL / NEON_DATABASE_URL not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const vaultArgIdx = args.indexOf('--vault');
const onlyVault = vaultArgIdx >= 0 ? args[vaultArgIdx + 1] : null;

const { getTransactionPda } = squads;

async function decodeCreator(connection, multisigPda, txIndex) {
  const [transactionPda] = getTransactionPda({
    multisigPda,
    index: BigInt(txIndex),
  });
  const decoders = [
    () => squads.accounts.VaultTransaction.fromAccountAddress(connection, transactionPda),
    () => squads.accounts.ConfigTransaction.fromAccountAddress(connection, transactionPda),
    () => squads.accounts.Batch.fromAccountAddress(connection, transactionPda),
  ];
  for (const fn of decoders) {
    try {
      const acc = await fn();
      if (acc?.creator) return acc.creator.toBase58();
    } catch {
      // wrong discriminator; try next
    }
  }
  return null;
}

async function main() {
  const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 });
  const connection = new Connection(RPC_URL, 'confirmed');

  const where = onlyVault
    ? sql`vault_address = ${onlyVault} AND created_by IS NULL`
    : sql`created_by IS NULL`;
  const rows = await sql`
    SELECT vault_address, transaction_index
    FROM vault_proposals
    WHERE ${where}
    ORDER BY vault_address, transaction_index DESC
  `;

  console.log(
    `→ ${rows.length} rows missing created_by${onlyVault ? ` (vault=${onlyVault})` : ''}${
      dryRun ? ' [dry-run]' : ''
    }`,
  );

  let resolved = 0;
  let unresolved = 0;
  for (const row of rows) {
    let multisigPda;
    try {
      multisigPda = new PublicKey(row.vault_address);
    } catch {
      console.warn(`  skip non-pubkey vault: ${row.vault_address}`);
      continue;
    }
    const creator = await decodeCreator(connection, multisigPda, row.transaction_index);
    if (creator) {
      resolved++;
      console.log(`  ✓ ${row.vault_address}#${row.transaction_index} → ${creator}`);
      if (!dryRun) {
        await sql`
          UPDATE vault_proposals
          SET created_by = ${creator}, updated_at = NOW()
          WHERE vault_address = ${row.vault_address}
            AND transaction_index = ${row.transaction_index}
            AND created_by IS NULL
        `;
      }
    } else {
      unresolved++;
      console.log(`  · ${row.vault_address}#${row.transaction_index} — no creator on chain`);
    }
  }

  console.log(`Done. resolved=${resolved} unresolved=${unresolved} dry=${dryRun}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
