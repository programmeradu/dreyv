/**
 * Universal sign-and-send deeplinks + QR + mobile-handoff URL builder.
 *
 * Returned alongside every UNSIGNED-TX response (defiSwapTx, defiStakeSolTx,
 * intentsCompile) so calling agents can hand a one-tap signing surface to
 * the user — desktop browser, mobile wallet, or QR-to-phone handoff —
 * without each integrator re-implementing wallet-adapter glue.
 *
 * Spec references:
 *   • Phantom universal links — https://docs.phantom.app/phantom-deeplinks/provider-methods/signandsendtransaction
 *   • Solflare deeplinks      — https://docs.solflare.com/solflare/technical/deeplinks
 *   • Backpack deeplinks      — https://docs.backpack.app/deeplinks
 *   • Solana Pay tx requests  — https://docs.solanapay.com/spec
 */

import { getSiteOrigin } from "@/lib/seo/site";

export type SupportedNetwork = "solana-mainnet" | "solana-devnet";

export interface DeeplinkBundle {
  /** Phantom universal link — opens Phantom on mobile, Phantom extension on desktop. */
  phantomUniversal: string;
  /** Solflare universal link. */
  solflareUniversal: string;
  /** Backpack universal link. */
  backpackUniversal: string;
  /** Dreyv-hosted mobile signer page — works with ANY wallet via deeplink switcher. */
  mobileHandoffUrl: string;
  /** Solana Pay-compatible transaction request URL, suitable for QR. */
  qrPayload: string;
  /** Pre-rendered SVG QR (data URI). Client can `<img src={qrSvgDataUri} />`. */
  qrSvgDataUri: string;
  /** TTL in seconds. After this, the handoff record is purged server-side. */
  expiresInSec: number;
  /** Server-side handoff id (used by /mobile/signer page to fetch tx). */
  handoffId: string;
}

const DEFAULT_TTL_SEC = 5 * 60;

/**
 * Build all deeplink + QR variants for an unsigned base64-encoded tx.
 *
 * @param args.txBase64       — base64-encoded VersionedTransaction or legacy tx
 * @param args.userPublicKey  — wallet expected to sign
 * @param args.label          — human-readable action label (e.g. "Swap 1 SOL → USDC")
 * @param args.network        — defaults to solana-mainnet
 * @param args.handoffId      — id from createHandoff()
 * @param args.ttlSec         — handoff TTL
 */
export function buildDeeplinks(args: {
  txBase64: string;
  userPublicKey: string;
  label: string;
  handoffId: string;
  network?: SupportedNetwork;
  ttlSec?: number;
}): DeeplinkBundle {
  const network = args.network ?? "solana-mainnet";
  const ttlSec = args.ttlSec ?? DEFAULT_TTL_SEC;
  const origin = getSiteOrigin();
  const mobileHandoffUrl = `${origin}/mobile/signer?id=${encodeURIComponent(args.handoffId)}`;

  // Solana Pay transaction request — wallets POST to this URL to fetch the tx.
  // The /api/mcp/handoff/[id]/sign endpoint returns Solana Pay-spec JSON.
  const qrPayload = `solana:${encodeURIComponent(
    `${origin}/api/mcp/handoff/${encodeURIComponent(args.handoffId)}/sign`,
  )}?label=${encodeURIComponent(args.label)}`;

  // Phantom universal link uses the redirect-link pattern; we point it at the
  // dreyv mobile signer page which auto-detects the wallet provider.
  const phantomUniversal = `https://phantom.app/ul/browse/${encodeURIComponent(
    mobileHandoffUrl,
  )}?ref=${encodeURIComponent(origin)}`;

  const solflareUniversal = `https://solflare.com/ul/v1/browse/${encodeURIComponent(
    mobileHandoffUrl,
  )}?ref=${encodeURIComponent(origin)}`;

  const backpackUniversal = `https://backpack.app/ul/v1/browse/${encodeURIComponent(
    mobileHandoffUrl,
  )}?ref=${encodeURIComponent(origin)}`;

  return {
    phantomUniversal,
    solflareUniversal,
    backpackUniversal,
    mobileHandoffUrl,
    qrPayload,
    qrSvgDataUri: renderQrSvgDataUri(qrPayload),
    expiresInSec: ttlSec,
    handoffId: args.handoffId,
  };
}

/**
 * Minimal QR SVG renderer using a server-side QR encoder.
 *
 * We avoid a hard dependency on a runtime QR library — instead we return a
 * data URI pointing at our own `/api/mcp/qr?payload=...` endpoint, which
 * returns image/svg+xml. This keeps the bundle size of /api/mcp small.
 */
function renderQrSvgDataUri(payload: string): string {
  const origin = getSiteOrigin();
  return `${origin}/api/mcp/qr?payload=${encodeURIComponent(payload)}`;
}
