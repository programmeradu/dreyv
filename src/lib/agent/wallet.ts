/**
 * Hosted "agent wallet" — a custodial Solana keypair per user, used by
 * POST /api/x402/pay to settle invoices end-to-end without any human in
 * the loop. The private key is encrypted at rest with KEYPAIR_MASTER_KEY
 * via src/lib/keypair-envelope.ts (same envelope as DCA bot keypairs).
 *
 * This wallet's ONLY job is paying Dreyv invoices. The user funds it once
 * with USDC (and a small SOL float for tx fees); agents drain it for
 * x402 SKUs. It is not a treasury.
 */

import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
// TS doesn't resolve @solana/spl-token's deep `export *` re-exports in this
// bundler-mode workspace (same issue handled by `@ts-ignore` in
// src/lib/studio/marketplace-payments.ts). Runtime exports are correct.
// @ts-ignore
import { createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress, TokenAccountNotFoundError, TokenInvalidAccountOwnerError } from "@solana/spl-token";




import bs58 from "bs58";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agentWallets } from "@/db/schema";
import { decryptKeypair, encryptKeypair } from "@/lib/keypair-envelope";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Cheap fee headroom enforced before signing — covers tx fees + a fresh
 * ATA rent-exempt allocation if the recipient ATA has to be created. */
export const MIN_SOL_LAMPORTS_FOR_TX = BigInt(50_000); // ~0.00005 SOL

function getRpcUrl(): string {
    const helius = process.env.HELIUS_API_KEY?.trim();
    if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
    const fallback = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
    if (fallback) return fallback;
    throw new Error("No Solana RPC URL configured");
}

export function getAgentConnection(): Connection {
    return new Connection(getRpcUrl(), "confirmed");
}

export interface AgentWalletRecord {
    publicKey: string;
    createdAt: Date;
    /** Present only on server-side reads that need to sign. */
    secretBase58?: string;
}

/**
 * Idempotent: returns the existing wallet for the user, or provisions a
 * fresh one on first call. Public-key only by default — pass
 * `withSecret: true` when the caller needs to sign a transaction.
 */
export async function getOrCreateAgentWallet(
    userId: string,
    opts: { withSecret?: boolean } = {},
): Promise<AgentWalletRecord> {
    if (!db) throw new Error("Database unavailable");

    const [existing] = await db
        .select()
        .from(agentWallets)
        .where(eq(agentWallets.userId, userId))
        .limit(1);

    if (existing) {
        return {
            publicKey: existing.publicKey,
            createdAt: existing.createdAt,
            secretBase58: opts.withSecret ? decryptKeypair(existing.encryptedSecret) : undefined,
        };
    }

    const kp = Keypair.generate();
    const secretBase58 = bs58.encode(kp.secretKey);
    const publicKey = kp.publicKey.toBase58();

    const [row] = await db
        .insert(agentWallets)
        .values({
            userId,
            publicKey,
            encryptedSecret: encryptKeypair(secretBase58),
        })
        .returning({ createdAt: agentWallets.createdAt });

    return {
        publicKey,
        createdAt: row.createdAt,
        secretBase58: opts.withSecret ? secretBase58 : undefined,
    };
}

export function keypairFromBase58(secret: string): Keypair {
    return Keypair.fromSecretKey(bs58.decode(secret));
}

export interface WalletBalances {
    solLamports: bigint;
    /** SPL token amount in minor units (e.g. 1 USDC = 1_000_000). */
    tokenMinor: bigint;
    /** True if the associated token account exists on-chain. */
    tokenAccountExists: boolean;
}

export interface SweepHostedWalletResult {
    signature: string | null;
    tokenMinor: bigint;
    solLamports: bigint;
    sourceTokenAccountExisted: boolean;
    sourceTokenAccountClosed: boolean;
    destinationTokenAccountCreated: boolean;
    estimatedFeeLamports: bigint;
    rentReserveLamports: bigint;
    skippedReason?: "empty" | "sol_below_fee";
}

export async function getWalletBalances(args: {
    publicKey: string;
    mintAddress: string;
}): Promise<WalletBalances> {
    const conn = getAgentConnection();
    const owner = new PublicKey(args.publicKey);
    const mint = new PublicKey(args.mintAddress);

    const [solLamports, balance] = await Promise.all([
        conn.getBalance(owner, "confirmed").then((n) => BigInt(n)),
        (async () => {
            try {
                const ata = await getAssociatedTokenAddress(mint, owner);
                const acc = await getAccount(conn, ata, "confirmed");
                return { tokenMinor: acc.amount, tokenAccountExists: true };
            } catch (err) {
                if (
                    err instanceof TokenAccountNotFoundError ||
                    err instanceof TokenInvalidAccountOwnerError
                ) {
                    return { tokenMinor: BigInt(0), tokenAccountExists: false };
                }
                throw err;
            }
        })(),
    ]);

    return { solLamports, tokenMinor: balance.tokenMinor, tokenAccountExists: balance.tokenAccountExists };
}

/**
 * Drain a hosted agent wallet into a destination Solana wallet before an
 * account claim. Sweeps the configured SPL token balance, closes the source
 * ATA to reclaim rent, then transfers every safely spendable lamport from the
 * source system account. The caller remains responsible for deleting the DB
 * wallet row only after this returns successfully (or when skipped as empty).
 */
export async function sweepHostedWallet(args: {
    sourceSecretBase58: string;
    destinationPublicKey: string;
    mintAddress: string;
    decimals: number;
}): Promise<SweepHostedWalletResult> {
    const conn = getAgentConnection();
    const source = keypairFromBase58(args.sourceSecretBase58);
    const destination = new PublicKey(args.destinationPublicKey);
    const mint = new PublicKey(args.mintAddress);

    if (source.publicKey.equals(destination)) {
        throw new Error("destination_matches_source");
    }

    const sourceAta = await getAssociatedTokenAddress(mint, source.publicKey);
    const destinationAta = await getAssociatedTokenAddress(mint, destination);

    let tokenMinor = BigInt(0);
    let sourceTokenAccountExisted = false;
    try {
        const sourceAccount = await getAccount(conn, sourceAta, "confirmed");
        tokenMinor = sourceAccount.amount;
        sourceTokenAccountExisted = true;
    } catch (err) {
        if (
            err instanceof TokenAccountNotFoundError ||
            err instanceof TokenInvalidAccountOwnerError
        ) {
            sourceTokenAccountExisted = false;
        } else {
            throw err;
        }
    }

    const instructions: TransactionInstruction[] = [];
    let destinationTokenAccountCreated = false;
    let rentReserveLamports = BigInt(0);

    if (tokenMinor > BigInt(0)) {
        const destinationInfo = await conn.getAccountInfo(destinationAta, "confirmed");
        if (!destinationInfo) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    source.publicKey,
                    destinationAta,
                    destination,
                    mint,
                ),
            );
            destinationTokenAccountCreated = true;
            rentReserveLamports = BigInt(await conn.getMinimumBalanceForRentExemption(165));
        }

        instructions.push(
            createTransferCheckedInstruction(
                sourceAta,
                mint,
                destinationAta,
                source.publicKey,
                tokenMinor,
                args.decimals,
            ),
        );
    }

    if (sourceTokenAccountExisted) {
        instructions.push(createCloseAccountInstruction(sourceAta, destination, source.publicKey));
    }

    const solLamports = BigInt(await conn.getBalance(source.publicKey, "confirmed"));
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");

    const feeProbe = new Transaction({ feePayer: source.publicKey, blockhash, lastValidBlockHeight });
    feeProbe.add(...instructions);
    if (solLamports > rentReserveLamports) {
        feeProbe.add(
            SystemProgram.transfer({
                fromPubkey: source.publicKey,
                toPubkey: destination,
                lamports: BigInt(1),
            }),
        );
    }
    const estimatedFeeLamports = BigInt(
        (await conn.getFeeForMessage(feeProbe.compileMessage(), "confirmed")).value ?? 5_000,
    );

    const reservedLamports = rentReserveLamports + estimatedFeeLamports;
    const transferableSolLamports = solLamports > reservedLamports
        ? solLamports - reservedLamports
        : BigInt(0);

    if (transferableSolLamports > BigInt(0)) {
        instructions.push(
            SystemProgram.transfer({
                fromPubkey: source.publicKey,
                toPubkey: destination,
                lamports: transferableSolLamports,
            }),
        );
    }

    if (instructions.length === 0) {
        return {
            signature: null,
            tokenMinor,
            solLamports: BigInt(0),
            sourceTokenAccountExisted,
            sourceTokenAccountClosed: false,
            destinationTokenAccountCreated,
            estimatedFeeLamports,
            rentReserveLamports,
            skippedReason: solLamports > BigInt(0) ? "sol_below_fee" : "empty",
        };
    }

    if (solLamports < reservedLamports) {
        throw new Error(
            `insufficient_sol_for_sweep: need at least ${reservedLamports.toString()} lamports for rent and fees; source has ${solLamports.toString()}`,
        );
    }

    const tx = new Transaction({ feePayer: source.publicKey, blockhash, lastValidBlockHeight });
    tx.add(...instructions);
    tx.sign(source);

    const signature = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
    });

    const confirmation = await conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
    );
    if (confirmation.value.err) {
        throw new Error(`solana_tx_failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return {
        signature,
        tokenMinor,
        solLamports: transferableSolLamports,
        sourceTokenAccountExisted,
        sourceTokenAccountClosed: sourceTokenAccountExisted,
        destinationTokenAccountCreated,
        estimatedFeeLamports,
        rentReserveLamports,
    };
}

export interface PayInvoiceResult {
    signature: string;
}

/**
 * Build, sign, send, and confirm an SPL transfer + memo from the user's
 * agent wallet to Dreyv's receiving address. Throws with a clear message
 * if the wallet is underfunded.
 */
export async function payInvoiceFromAgentWallet(args: {
    agentSecretBase58: string;
    recipient: string;
    mintAddress: string;
    amountMinor: bigint;
    decimals: number;
    memo: string;
}): Promise<PayInvoiceResult> {
    const conn = getAgentConnection();
    const payer = keypairFromBase58(args.agentSecretBase58);
    const recipient = new PublicKey(args.recipient);
    const mint = new PublicKey(args.mintAddress);

    const sourceAta = await getAssociatedTokenAddress(mint, payer.publicKey);
    const destAta = await getAssociatedTokenAddress(mint, recipient);

    const instructions: TransactionInstruction[] = [];

    // Create the recipient ATA if missing. Dreyv's address normally has it,
    // but a defensive idempotent create costs ~2_039_280 lamports rent + a
    // few hundred lamports fee, so we only add it when actually needed.
    const destInfo = await conn.getAccountInfo(destAta, "confirmed");
    if (!destInfo) {
        instructions.push(
            createAssociatedTokenAccountInstruction(payer.publicKey, destAta, recipient, mint),
        );
    }

    instructions.push(
        createTransferCheckedInstruction(
            sourceAta,
            mint,
            destAta,
            payer.publicKey,
            args.amountMinor,
            args.decimals,
        ),
    );

    // Memo — Solana Pay reference compatible. /verify expects this exact
    // string in the tx's Memo program log.
    instructions.push(
        new TransactionInstruction({
            keys: [],
            programId: MEMO_PROGRAM_ID,
            data: Buffer.from(args.memo, "utf8"),
        }),
    );

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight });
    tx.add(...instructions);
    tx.sign(payer);

    const signature = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
    });

    const confirmation = await conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
    );
    if (confirmation.value.err) {
        throw new Error(`solana_tx_failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return { signature };
}
