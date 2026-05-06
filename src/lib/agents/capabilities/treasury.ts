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
import { estimateUsdValue } from "./usd-pricing";

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
      const estimatedValueUsd = await estimateUsdValue(token, amount);
      return {
        success: true,
        operation: "transfer",
        token,
        amount,
        recipient,
        serializedTransaction: serialized,
        serializedTransactions: [serialized],
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        estimatedValueUsd,
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
  description:
    "Build a Squads V4 multisig proposal (vaultTransactionCreate + proposalCreate + proposalActivate) for the connected vault. Returns a signable proposer transaction. Use whenever the source of funds is a Squads multisig and a write action is needed (transfer, payroll, swap-out). The proposer signs to broadcast the proposal; remaining co-signers approve from the inbox.",
  inputSchema: z.object({
    title: z.string().describe("Proposal title shown in the inbox / Squads UI"),
    description: z.string().describe("Human-readable description"),
    multisigAddress: z
      .string()
      .optional()
      .describe(
        "Squads multisig address. Defaults to the connected wallet if it is itself a multisig.",
      ),
    actions: z
      .array(
        z.object({
          type: z
            .enum(["transfer"])
            .describe("Action type. Only 'transfer' is supported in v1."),
          params: z.object({
            token: z.string().describe("SOL or SPL symbol (USDC, USDT, ...)"),
            amount: z.number(),
            recipient: z.string(),
          }),
        }),
      )
      .min(1)
      .describe("Actions the vault PDA will execute when the proposal passes."),
    vaultIndex: z.number().int().min(0).optional().describe("Vault sub-index. Default 0."),
  }),
  sideEffects: "write",
  requiredAuth: "multisig",
  sensitivity: "high",
  protocols: ["squads-v4"],
  execute: async ({ title, description: desc, multisigAddress, actions, vaultIndex = 0 }, ctx) => {
    console.log(`[capability:multisig_proposal] ${title} (${actions.length} action(s))`);

    if (!ctx.walletAddress) {
      return {
        success: true,
        operation: "multisig_proposal",
        title,
        description: desc,
        actionCount: actions.length,
        status: "PENDING_SIGNATURES",
        message: `Proposal "${title}" prepared. Connect your proposer wallet to build the on-chain proposal tx.`,
      };
    }

    try {
      const {
        Connection,
        PublicKey,
        Transaction,
        TransactionMessage,
        SystemProgram,
        LAMPORTS_PER_SOL,
      } = await import("@solana/web3.js");
      const squads = (await import("@sqds/multisig")) as any;
      const { getVaultPda, getTransactionPda } = squads;
      const { SquadsClient } = await import("@/lib/squads");

      const conn = new Connection(ctx.rpcEndpoint, "confirmed");
      const proposer = new PublicKey(ctx.walletAddress);

      // Resolve which address holds the multisig config. If the user passed one,
      // use that; otherwise assume the connected wallet IS the multisig.
      const multisigAddr = multisigAddress ?? ctx.walletAddress;
      const multisigPda = new PublicKey(multisigAddr);
      const client = new SquadsClient(conn, null);
      const multisigAccount = await client.getVault(multisigAddr);
      if (!multisigAccount) {
        return {
          success: false,
          operation: "multisig_proposal",
          title,
          error: `Address ${multisigAddr.slice(0, 8)}… is not a Squads V4 multisig. Use create_multisig first or pass an explicit multisigAddress.`,
        };
      }

      const threshold = Number(multisigAccount.threshold);
      const memberCount = (multisigAccount.members as any[]).length;
      const transactionIndex = BigInt(Number(multisigAccount.transactionIndex) + 1);
      const [vaultPda] = getVaultPda({ multisigPda, index: vaultIndex });
      const [vaultTxKey] = getTransactionPda({ multisigPda, index: transactionIndex });

      // Build inner instructions the vault PDA will execute on approval.
      const inner: any[] = [];
      for (const a of actions) {
        if (a.type !== "transfer") continue;
        const isSol = isSolSymbol(a.params.token);
        const recipient = new PublicKey(a.params.recipient);
        if (isSol) {
          inner.push(
            SystemProgram.transfer({
              fromPubkey: vaultPda,
              toPubkey: recipient,
              lamports: Math.floor(a.params.amount * LAMPORTS_PER_SOL),
            }),
          );
        } else {
          const mint = resolveTokenMint(a.params.token.toUpperCase());
          if (!mint) {
            return {
              success: false,
              operation: "multisig_proposal",
              title,
              error: `Unknown token: ${a.params.token}`,
            };
          }
          const spl = (await import("@solana/spl-token")) as any;
          const {
            createTransferInstruction,
            createAssociatedTokenAccountIdempotentInstruction,
            getAssociatedTokenAddress,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          } = spl;
          const mintPk = new PublicKey(mint);
          const decimals = ["USDC", "USDT"].includes(a.params.token.toUpperCase()) ? 6 : 9;
          const senderAta = await getAssociatedTokenAddress(mintPk, vaultPda, true);
          const recipientAta = await getAssociatedTokenAddress(mintPk, recipient);
          inner.push(
            createAssociatedTokenAccountIdempotentInstruction(
              proposer, // proposer pays for ATA creation
              recipientAta,
              recipient,
              mintPk,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
            createTransferInstruction(
              senderAta,
              recipientAta,
              vaultPda,
              Math.floor(a.params.amount * Math.pow(10, decimals)),
            ),
          );
        }
      }

      if (inner.length === 0) {
        return {
          success: false,
          operation: "multisig_proposal",
          title,
          error: "No executable inner instructions were produced.",
        };
      }

      const { blockhash } = await conn.getLatestBlockhash("confirmed");

      const innerMsg = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash: blockhash,
        instructions: inner,
      });

      const vaultTxIx = squads.instructions.vaultTransactionCreate({
        multisigPda,
        transactionIndex,
        creator: proposer,
        vaultIndex,
        ephemeralSigners: 0,
        transactionMessage: innerMsg,
        memo: title.slice(0, 240),
      });
      const proposalIx = squads.instructions.proposalCreate({
        multisigPda,
        transactionIndex,
        creator: proposer,
        isDraft: false,
      });
      const activateIx = squads.instructions.proposalActivate({
        multisigPda,
        transactionIndex,
        member: proposer,
      });

      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: proposer });
      tx.add(vaultTxIx, proposalIx, activateIx);
      const serialized = Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64");

      return {
        success: true,
        operation: "multisig_proposal",
        title,
        description: desc,
        actionCount: actions.length,
        isMultisig: true,
        multisigAddress: multisigAddr,
        vaultPda: vaultPda.toBase58(),
        proposalPda: vaultTxKey.toBase58(),
        nextTransactionIndex: Number(transactionIndex),
        quorumRequired: threshold,
        memberCount,
        currentSignatures: 1, // proposer auto-approves on activate
        serializedTransactions: [serialized],
        status: "PENDING_SIGNATURES",
        requiresApproval: true,
        message: `Proposal "${title}" built for Squads multisig ${multisigAddr.slice(0, 8)}… — ${threshold}/${memberCount} required. Sign to publish; co-signers approve from /app/inbox.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:multisig_proposal] build error:", msg);
      return {
        success: false,
        operation: "multisig_proposal",
        title,
        error: `Failed to build multisig proposal: ${msg}`,
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
