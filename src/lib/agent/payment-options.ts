/**
 * Shared "payment options" payload — the deterministic menu an agent
 * surfaces to its human operator when it cannot pay autonomously
 * (e.g. prepaid balance = 0 AND custodial wallet has no USDC).
 *
 * Every option carries enough metadata for the agent to either:
 *   - settle it itself (autonomous = true), or
 *   - forward a single, copy-pasteable instruction to the human.
 *
 * Keep the shape stable across endpoints — agents key off `id`.
 */

export type PaymentOption = {
  id: "wallet_topup" | "balance_x402" | "balance_stripe" | "balance_paystack";
  label: string;
  autonomous: boolean;
  requires_human_step: boolean;
  speed: "instant" | "seconds" | "minutes";
  best_for: string;
  endpoint?: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  human_message?: string;
  details?: Record<string, unknown>;
};

export function buildPaymentOptions(args: {
  origin: string;
  amountUsd: number;
  walletAddress?: string | null;
  walletUsdcMint?: string | null;
  network?: string;
  stripeEnabled: boolean;
  paystackEnabled: boolean;
}): { options: PaymentOption[]; human_prompt: string } {
  const { origin, amountUsd, walletAddress, walletUsdcMint, network, stripeEnabled, paystackEnabled } = args;
  const amt = amountUsd.toFixed(2);
  const options: PaymentOption[] = [];

  if (walletAddress && walletUsdcMint) {
    options.push({
      id: "wallet_topup",
      label: "Fund the agent's on-chain wallet (Solana USDC)",
      autonomous: true,
      requires_human_step: true, // human sends crypto once; agent then pays per-call autonomously
      speed: "seconds",
      best_for: "Crypto-native operators — cheapest per call, no per-call human approval.",
      endpoint: `${origin}/api/agents/wallet`,
      method: "GET",
      human_message: `Send $${amt} of USDC on Solana (mint ${walletUsdcMint}) to ${walletAddress}. Also keep ~0.01 SOL for fees. The agent will then transact autonomously with no further approvals.`,
      details: { address: walletAddress, mint: walletUsdcMint, network: "solana" },
    });
  }

  options.push({
    id: "balance_x402",
    label: "Top up prepaid balance with x402 (autonomous USDC on " + (network ?? "base-sepolia") + ")",
    autonomous: true,
    requires_human_step: false,
    speed: "seconds",
    best_for: "Agent with its own funded wallet — single round-trip, no human in loop.",
    endpoint: `${origin}/api/agents/balance/topup`,
    method: "POST",
    body: { provider: "x402", amount_usd: amountUsd },
    human_message: `I can pay this myself — no action needed (autonomous USDC settlement on ${network ?? "base-sepolia"}).`,
  });

  if (stripeEnabled) {
    options.push({
      id: "balance_stripe",
      label: "Top up prepaid balance with Stripe (card / Apple Pay / bank)",
      autonomous: false,
      requires_human_step: true,
      speed: "minutes",
      best_for: "Operators in US / EU / global card markets.",
      endpoint: `${origin}/api/agents/balance/topup`,
      method: "POST",
      body: { provider: "stripe", amount_usd: amountUsd },
      human_message: `I need $${amt} to continue. Pay by card via Stripe — I'll generate a checkout link and resume the moment it clears.`,
    });
  }

  if (paystackEnabled) {
    options.push({
      id: "balance_paystack",
      label: "Top up prepaid balance with Paystack (cards, mobile money, bank — Africa)",
      autonomous: false,
      requires_human_step: true,
      speed: "minutes",
      best_for: "Operators in Ghana, Nigeria, Kenya, South Africa.",
      endpoint: `${origin}/api/agents/balance/topup`,
      method: "POST",
      body: { provider: "paystack", amount_usd: amountUsd },
      human_message: `I need $${amt} to continue. Pay via Paystack (card / mobile money / bank) — I'll generate a checkout link and resume the moment it clears.`,
    });
  }

  const humanOptions = options
    .filter((o) => o.requires_human_step)
    .map((o, i) => `  ${i + 1}. ${o.label} — ${o.human_message}`)
    .join("\n");
  const human_prompt =
    `I need $${amt} USDC to continue and I don't have it on hand. Pick one:\n${humanOptions}\n\nReply with the option number and I'll generate the exact link / address.`;

  return { options, human_prompt };
}
