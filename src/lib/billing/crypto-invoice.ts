/**
 * Shared crypto-invoice minting helper.
 *
 * Both `/api/billing/crypto/checkout` and the in-chat
 * `pay_crypto_subscription` capability go through this so the two paths can
 * never drift. Returns an invoice row + a Solana Pay URL the client can drop
 * into a QR code or hand to a wallet adapter.
 */

import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { cryptoInvoices } from "@/db/schema";
import {
  isEnabled,
  receivingAddressFor,
  tokenFor,
  type CryptoAsset,
  type CryptoChain,
} from "./crypto-config";
import { computeAmountMinor, type CryptoTier } from "./crypto-pricing";

export interface MintedInvoice {
  id: string;
  tier: CryptoTier;
  chain: CryptoChain;
  asset: CryptoAsset;
  amount: string;
  amountMinor: string;
  amountUsd: number;
  decimals: number;
  contract: string | null;
  receivingAddress: string;
  memo: string;
  expiresAt: string;
  /** RFC: https://docs.solanapay.com/spec — opens directly in Solana wallets. */
  solanaPayUrl: string | null;
}

export async function mintCryptoInvoice(args: {
  userId: string;
  tier: CryptoTier;
  chain: CryptoChain;
  asset: CryptoAsset;
  /** Override the tier's USD price (used by per-call x402 SKUs like $0.10 snapshot). */
  amountUsdOverride?: number;
  /** Override the Solana Pay `message` shown in wallets. Defaults to "Dreyv {tier} subscription". */
  message?: string;
}): Promise<MintedInvoice> {
  if (!db) throw new Error("Database unavailable");
  if (!isEnabled(args.chain, args.asset)) throw new Error(`Asset not enabled: ${args.chain}/${args.asset}`);
  const token = tokenFor(args.chain, args.asset);
  if (!token) throw new Error("Unknown asset");

  const pricing = await computeAmountMinor(args.tier, args.chain, args.asset, args.amountUsdOverride);

  const memo = "DRYV-" + randomBytes(6).toString("hex").toUpperCase();
  const receiving = receivingAddressFor(args.chain);
  const expiresMs = token.stable ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiresMs);

  const [row] = await db.insert(cryptoInvoices).values({
    userId: args.userId,
    tier: args.tier,
    chain: args.chain,
    asset: args.asset,
    amountMinor: pricing.amountMinor.toString(),
    amountUsd: pricing.amountUsd.toFixed(2),
    decimals: pricing.decimals,
    contractAddress: token.contract,
    receivingAddress: receiving,
    memo,
    status: "pending",
    expiresAt,
  }).returning();

  const message = args.message ?? `Dreyv ${args.tier === "mini" ? "Mini" : "Max"} subscription`;

  return {
    id: row.id,
    tier: args.tier,
    chain: args.chain,
    asset: args.asset,
    amount: pricing.amountDisplay,
    amountMinor: pricing.amountMinor.toString(),
    amountUsd: pricing.amountUsd,
    decimals: pricing.decimals,
    contract: token.contract,
    receivingAddress: receiving,
    memo,
    expiresAt: expiresAt.toISOString(),
    solanaPayUrl: args.chain === "solana"
      ? buildSolanaPayUrl({
          recipient: receiving,
          amountDisplay: pricing.amountDisplay,
          splToken: token.contract,
          memo,
          label: "Dreyv",
          message,
        })
      : null,
  };
}

/**
 * Solana Pay URL — `solana:<recipient>?amount=<n>&spl-token=<mint>&reference=<memo>&label=Dreyv&message=...`
 * `amount` is in token units (not minor units). For native SOL we omit `spl-token`.
 */
export function buildSolanaPayUrl(args: {
  recipient: string;
  amountDisplay: string;
  splToken: string | null;
  memo: string;
  label: string;
  message: string;
}): string {
  const params = new URLSearchParams();
  params.set("amount", args.amountDisplay);
  if (args.splToken) params.set("spl-token", args.splToken);
  params.set("reference", args.memo);
  params.set("memo", args.memo);
  params.set("label", args.label);
  params.set("message", args.message);
  return `solana:${args.recipient}?${params.toString()}`;
}
