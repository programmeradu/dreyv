/**
 * DACS Phase 0 — Treasury domain capabilities.
 *
 * Migrated 1:1 from `src/app/api/command/route.ts` to the typed Capability
 * registry. Every executor preserves its legacy behavior byte-for-byte;
 * the only change is that it now reads request-scope state from a
 * `CapabilityContext` argument instead of closing over `walletAddress`,
 * `rpcEndpoint`, etc.
 *
 * Capabilities in this module:
 *   - create_multisig:    deploys (or routes to UI for) a Squads V4 vault
 *   - transfer:           single-recipient SOL/SPL transfer
 *   - mass_dispatch:      batched multi-recipient payroll-style transfer
 *   - multisig_proposal:  prepare a Squads quorum proposal
 *
 * Side-effect / sensitivity / required-auth metadata is declarative so the
 * Phase 1 router can decide HITL routing without running the executor.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { resolveTokenMint, isSolSymbol, TOKEN_MINTS } from "./tokens";

const create_multisig = defineCapability({
  id: "create_multisig",
  domain: "treasury",
  description:
    "Deploys a new Squads V4 Multisig Treasury (vault) on Solana. Returns a signable transaction so the user can create the multisig directly from the CommandBar/Inbox without leaving the chat. Use when the user asks to create a multisig, create a squad, launch a new treasury, set up a vault, or invite co-signers.",
  inputSchema: z.object({
    members: z
      .array(z.string())
      .min(1)
      .describe(
        "Member wallet addresses (base58). The connected wallet is auto-included as the proposer if not listed.",
      ),
    threshold: z
      .number()
      .int()
      .min(1)
      .describe("Number of signatures required to approve a transaction (k of n)."),
    timeLock: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional time-lock in seconds before approved txs can execute. Default 0."),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["squads-v4"],
  execute: async ({ members, threshold, timeLock = 0 }, ctx) => {
    if (!ctx.walletAddress) {
      return {
        success: true,
        operation: "create_multisig",
        memberCount: members.length,
        threshold,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        message: `Multisig (${threshold}/${members.length}) prepared. Connect a wallet to build and sign the create-vault transaction.`,
      };
    }

    try {
      const { Connection, PublicKey, Transaction, Keypair } = await import("@solana/web3.js");
      const squads = (await import("@sqds/multisig")) as any;
      const { getMultisigPda, getVaultPda } = squads;

      const conn = new Connection(ctx.rpcEndpoint, "confirmed");
      const creator = new PublicKey(ctx.walletAddress);

      // De-dup + ensure creator is a member with full permissions (mask 7 = Initiate|Vote|Execute).
      const memberSet = new Set<string>(members);
      memberSet.add(creator.toBase58());
      if (memberSet.size < threshold) {
        return {
          success: false,
          operation: "create_multisig",
          error: `Threshold ${threshold} exceeds member count ${memberSet.size}.`,
        };
      }

      const memberList = Array.from(memberSet).map((addr) => ({
        key: new PublicKey(addr),
        permissions: { mask: 7 },
      }));

      // Fresh ephemeral createKey — its public key derives the multisig PDA, its
      // secret key must co-sign the create tx (we surface it via extraSigners).
      const createKey = Keypair.generate();
      const [multisigPda] = getMultisigPda({ createKey: createKey.publicKey });
      const [vaultPda] = getVaultPda({ multisigPda, index: 0 });

      // Resolve treasury (program config) — fall back to creator on devnet.
      const [programConfigPda] = squads.getProgramConfigPda({});
      let treasury: any;
      try {
        const programConfig = await squads.accounts.ProgramConfig.fromAccountAddress(
          conn,
          programConfigPda,
        );
        treasury = programConfig.treasury;
      } catch {
        treasury = creator;
      }

      const ix = squads.instructions.multisigCreateV2({
        treasury,
        creator,
        multisigPda,
        configAuthority: null,
        threshold,
        members: memberList,
        timeLock,
        createKey: createKey.publicKey,
        rentCollector: null,
      });

      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: creator });
      tx.add(ix);

      const serialized = Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64");

      // The createKey ephemeral signer's secret must travel with the envelope so
      // the inbox UI can partial-sign before passing the tx to the wallet.
      const extraSigner = {
        publicKey: createKey.publicKey.toBase58(),
        secretKeyBase64: Buffer.from(createKey.secretKey).toString("base64"),
      };

      return {
        success: true,
        operation: "create_multisig",
        memberCount: memberList.length,
        threshold,
        timeLock,
        multisigPda: multisigPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        members: memberList.map((m) => m.key.toBase58()),
        serializedTransactions: [serialized],
        extraSigners: [extraSigner],
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        message: `New ${threshold}-of-${memberList.length} Squads V4 multisig ready to deploy. Vault PDA: ${vaultPda
          .toBase58()
          .slice(0, 8)}…`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:create_multisig] build error:", msg);
      return {
        success: false,
        operation: "create_multisig",
        error: `Failed to build multisig create tx: ${msg}`,
      };
    }
  },
});

const transfer = defineCapability({
  id: "transfer",
  domain: "treasury",
  description: "Transfer SOL or SPL tokens to a recipient wallet.",
  inputSchema: z.object({
    token: z.string().describe("Token symbol"),
    amount: z.number().describe("Amount to send"),
    recipient: z.string().describe("Recipient wallet address"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ token, amount, recipient }, ctx) => {
    console.log(`[capability:transfer] ${amount} ${token} → ${recipient}`);

    const isSol = isSolSymbol(token);
    const mint = isSol ? null : resolveTokenMint(token.toUpperCase());
    if (!isSol && !mint) {
      return {
        success: false,
        operation: "transfer",
        token,
        error: `Unknown token: ${token}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`,
      };
    }

    try {
      const {
        PublicKey,
        Transaction,
        SystemProgram,
        Connection,
        LAMPORTS_PER_SOL,
      } = await import("@solana/web3.js");

      try {
        new PublicKey(recipient);
      } catch {
        return {
          success: false,
          operation: "transfer",
          token,
          error: `Invalid recipient address: ${recipient}`,
        };
      }

      if (!ctx.walletAddress) {
        return {
          success: true,
          operation: "transfer",
          token,
          amount,
          recipient,
          status: "READY_FOR_SIGNATURE",
          requiresApproval: true,
          message: `Transfer ${amount} ${token} to ${recipient.slice(0, 8)}… prepared. Connect wallet to build transaction.`,
        };
      }

      const payer = new PublicKey(ctx.walletAddress);
      const recipientPubkey = new PublicKey(recipient);
      const conn = new Connection(ctx.rpcEndpoint, "confirmed");
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payer });

      if (isSol) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: recipientPubkey,
            lamports: Math.floor(amount * LAMPORTS_PER_SOL),
          }),
        );
      } else {
        const spl = (await import("@solana/spl-token")) as any;
        const {
          createTransferInstruction,
          createAssociatedTokenAccountIdempotentInstruction,
          getAssociatedTokenAddress,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        } = spl;
        const mintPubkey = new PublicKey(mint!);
        const decimals = ["USDC", "USDT"].includes(token.toUpperCase()) ? 6 : 9;
        const senderAta = await getAssociatedTokenAddress(mintPubkey, payer);
        const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            recipientAta,
            recipientPubkey,
            mintPubkey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
        tx.add(
          createTransferInstruction(
            senderAta,
            recipientAta,
            payer,
            Math.floor(amount * Math.pow(10, decimals)),
          ),
        );
      }

      const serialized = Buffer.from(tx.serialize({ verifySignatures: false })).toString(
        "base64",
      );
      return {
        success: true,
        operation: "transfer",
        token,
        amount,
        recipient,
        serializedTransaction: serialized,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        message: `Transfer ${amount} ${token} to ${recipient.slice(0, 8)}… ready for signing.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:transfer] Build error:", msg);
      return {
        success: true,
        operation: "transfer",
        token,
        amount,
        recipient,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        buildError: msg,
        message: `Transfer ${amount} ${token} to ${recipient.slice(0, 8)}… prepared (tx build deferred: ${msg}).`,
      };
    }
  },
});

const mass_dispatch = defineCapability({
  id: "mass_dispatch",
  domain: "treasury",
  description: "Execute Mass Dispatch (payroll) — send tokens to multiple recipients.",
  inputSchema: z.object({
    token: z.string().describe("Token to distribute"),
    recipients: z
      .array(
        z.object({
          address: z.string(),
          amount: z.number(),
          label: z.string().optional(),
        }),
      )
      .describe("List of recipients"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ token, recipients }, ctx) => {
    const blocked = ctx.blockExecutionForBuildIntent("mass_dispatch");
    if (blocked) return blocked;

    console.log(`[capability:mass_dispatch] ${token} to ${recipients.length} recipients`);
    const total = recipients.reduce((sum, r) => sum + r.amount, 0);

    const isSol = isSolSymbol(token);
    const mint = isSol ? null : resolveTokenMint(token.toUpperCase());

    if (!isSol && !mint) {
      return {
        success: false,
        operation: "mass_dispatch",
        token,
        error: `Unknown token: ${token}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`,
      };
    }

    try {
      const {
        PublicKey,
        Transaction,
        SystemProgram,
        Connection,
        LAMPORTS_PER_SOL,
      } = await import("@solana/web3.js");

      if (!ctx.walletAddress) {
        return {
          success: true,
          operation: "mass_dispatch",
          token,
          recipientCount: recipients.length,
          totalAmount: total,
          recipients,
          status: "READY_FOR_SIGNATURE",
          requiresApproval: true,
          message: `Mass Dispatch: ${total} ${token} to ${recipients.length} recipients. Connect wallet to build transactions.`,
        };
      }
      const payer = new PublicKey(ctx.walletAddress);
      const conn = new Connection(ctx.rpcEndpoint, "confirmed");
      const { blockhash } = await conn.getLatestBlockhash("confirmed");

      const MAX_IX_PER_TX = 20;
      const transactions: string[] = [];

      if (isSol) {
        for (let i = 0; i < recipients.length; i += MAX_IX_PER_TX) {
          const batch = recipients.slice(i, i + MAX_IX_PER_TX);
          const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payer });
          for (const r of batch) {
            tx.add(
              SystemProgram.transfer({
                fromPubkey: payer,
                toPubkey: new PublicKey(r.address),
                lamports: Math.floor(r.amount * LAMPORTS_PER_SOL),
              }),
            );
          }
          transactions.push(
            Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64"),
          );
        }
      } else {
        const spl = (await import("@solana/spl-token")) as any;
        const {
          createTransferInstruction,
          createAssociatedTokenAccountIdempotentInstruction,
          getAssociatedTokenAddress,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        } = spl;
        const mintPubkey = new PublicKey(mint!);
        const decimals = ["USDC", "USDT"].includes(token.toUpperCase()) ? 6 : 9;
        const senderAta = await getAssociatedTokenAddress(mintPubkey, payer);

        for (let i = 0; i < recipients.length; i += MAX_IX_PER_TX) {
          const batch = recipients.slice(i, i + MAX_IX_PER_TX);
          const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payer });
          for (const r of batch) {
            const recipientPubkey = new PublicKey(r.address);
            const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
            tx.add(
              createAssociatedTokenAccountIdempotentInstruction(
                payer,
                recipientAta,
                recipientPubkey,
                mintPubkey,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
            tx.add(
              createTransferInstruction(
                senderAta,
                recipientAta,
                payer,
                Math.floor(r.amount * Math.pow(10, decimals)),
              ),
            );
          }
          transactions.push(
            Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64"),
          );
        }
      }

      return {
        success: true,
        operation: "mass_dispatch",
        token,
        recipientCount: recipients.length,
        totalAmount: total,
        recipients,
        transactionCount: transactions.length,
        serializedTransactions: transactions,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        message: `Mass Dispatch: ${total} ${token} to ${recipients.length} recipients in ${transactions.length} transaction(s). Ready for signing.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:mass_dispatch] Build error:", msg);
      return {
        success: true,
        operation: "mass_dispatch",
        token,
        recipientCount: recipients.length,
        totalAmount: total,
        recipients,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        buildError: msg,
        message: `Mass Dispatch: ${total} ${token} to ${recipients.length} recipients prepared (tx build deferred: ${msg}).`,
      };
    }
  },
});

const multisig_proposal = defineCapability({
  id: "multisig_proposal",
  domain: "treasury",
  description: "Create a multisig treasury proposal for War Room quorum execution.",
  inputSchema: z.object({
    title: z.string().describe("Proposal title"),
    description: z.string().describe("Proposal description"),
    actions: z
      .array(z.object({ type: z.string(), params: z.any() }))
      .describe("Actions to execute"),
  }),
  sideEffects: "write",
  requiredAuth: "multisig",
  sensitivity: "high",
  protocols: ["squads-v4"],
  execute: async ({ title, description: desc, actions }, ctx) => {
    console.log(`[capability:multisig_proposal] ${title}`);

    if (!ctx.walletAddress) {
      return {
        success: true,
        operation: "multisig_proposal",
        title,
        description: desc,
        actionCount: actions.length,
        status: "PENDING_SIGNATURES",
        quorumRequired: null,
        currentSignatures: 0,
        isMultisig: false,
        message: `Proposal "${title}" prepared. Connect a Squads multisig wallet to fetch quorum requirements.`,
      };
    }

    try {
      const { Connection } = await import("@solana/web3.js");
      const { SquadsClient } = await import("@/lib/squads");
      const connection = new Connection(ctx.rpcEndpoint, "confirmed");
      const squadsClient = new SquadsClient(connection, null);

      const multisigAccount = await squadsClient.getVault(ctx.walletAddress);

      if (!multisigAccount) {
        return {
          success: true,
          operation: "multisig_proposal",
          title,
          description: desc,
          actionCount: actions.length,
          status: "PENDING_SIGNATURES",
          isMultisig: false,
          quorumRequired: null,
          currentSignatures: 0,
          message: `Wallet ${ctx.walletAddress.slice(0, 8)}… is not a Squads multisig. Proposal "${title}" staged for standard execution.`,
          requiresApproval: true,
        };
      }

      const threshold = Number(multisigAccount.threshold);
      const members = (
        multisigAccount.members as Array<{ key: { toBase58(): string }; permissions: unknown }>
      ).map((m) => ({
        key: m.key.toBase58(),
        permissions: m.permissions,
      }));
      const transactionIndex = Number(multisigAccount.transactionIndex);

      let recentProposals: Array<{
        index: number;
        title: string;
        status: string;
        signatures: number;
        threshold: number;
        pda: string;
      }> = [];
      try {
        recentProposals = await squadsClient.getProposals(ctx.walletAddress);
      } catch {
        /* proposals fetch is best-effort */
      }

      return {
        success: true,
        operation: "multisig_proposal",
        title,
        description: desc,
        actionCount: actions.length,
        status: "PENDING_SIGNATURES",
        isMultisig: true,
        quorumRequired: threshold,
        currentSignatures: 0,
        memberCount: members.length,
        members: members.map((m) => m.key),
        nextTransactionIndex: transactionIndex + 1,
        recentProposals: recentProposals.slice(0, 5),
        message: `Proposal "${title}" prepared for Squads multisig. Quorum: ${threshold}/${members.length} signatures required. Next tx index: ${transactionIndex + 1}. Submit client-side to create on-chain.`,
        requiresApproval: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:multisig_proposal] SquadsClient error:", msg);
      return {
        success: false,
        operation: "multisig_proposal",
        title,
        error: `Failed to fetch multisig config: ${msg}`,
      };
    }
  },
});

export const treasuryCapabilities: AnyCapability[] = [
  create_multisig as AnyCapability,
  transfer as AnyCapability,
  mass_dispatch as AnyCapability,
  multisig_proposal as AnyCapability,
];
