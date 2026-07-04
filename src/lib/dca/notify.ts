/**
 * DCA execution notifier — sends a transactional email via Resend when a DCA
 * bot executes (success or failure). Real network call, not a stub.
 *
 * If RESEND_API_KEY / EMAIL_FROM aren't set on the environment, the function
 * logs the reason and returns { sent: false } so the caller can move on
 * without silently pretending an email went out.
 */

type DcaBot = {
  id: string;
  name: string;
  ownerEmail?: string | null;
  walletAddress?: string | null;
  amountUsd?: number | string | null;
  buyTokenSymbol?: string | null;
};

type DcaOutcome =
  | { kind: "success"; txSignature: string; receivedAmount: string | number; price: string | number }
  | { kind: "failure"; error: string; paused?: boolean }
  | { kind: "skipped"; reason: string };

export async function sendExecutionNotification(
  bot: DcaBot,
  outcome: DcaOutcome,
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = bot.ownerEmail;

  if (!apiKey || !from) {
    console.warn(`[dca-notify] Skipping email (RESEND_API_KEY / EMAIL_FROM not set)`);
    return { sent: false, reason: "provider_not_configured" };
  }
  if (!to) {
    return { sent: false, reason: "no_recipient" };
  }

  const subject =
    outcome.kind === "success"
      ? `DCA executed — ${bot.name}`
      : outcome.kind === "failure"
        ? outcome.paused
          ? `DCA paused — ${bot.name}`
          : `DCA failed — ${bot.name}`
        : `DCA skipped — ${bot.name}`;

  const lines: string[] = [
    `Bot: ${bot.name}`,
    bot.walletAddress ? `Wallet: ${bot.walletAddress}` : "",
    bot.amountUsd != null ? `Amount: $${bot.amountUsd} → ${bot.buyTokenSymbol ?? "target"}` : "",
    "",
  ];
  if (outcome.kind === "success") {
    lines.push(
      `Status: SUCCESS`,
      `Received: ${outcome.receivedAmount}`,
      `Price: ${outcome.price}`,
      `Tx: https://solscan.io/tx/${outcome.txSignature}`,
    );
  } else if (outcome.kind === "failure") {
    lines.push(`Status: FAILED${outcome.paused ? " (BOT PAUSED)" : ""}`, `Error: ${outcome.error}`);
  } else {
    lines.push(`Status: SKIPPED`, `Reason: ${outcome.reason}`);
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text: lines.filter(Boolean).join("\n"),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[dca-notify] Resend failed ${res.status}: ${body}`);
      return { sent: false, reason: `resend_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[dca-notify] Resend threw:`, err);
    return { sent: false, reason: "resend_exception" };
  }
}

/**
 * Real Solana balance check for the bot's payment mint. Returns the balance in
 * smallest units (matching Jupiter quote amounts). Falls back to null on RPC
 * failure so callers can decide whether to proceed or abort.
 */
export async function getSplTokenBalance(
  walletAddress: string,
  mint: string,
): Promise<bigint | null> {
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          { mint },
          { encoding: "jsonParsed" },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const accts: any[] = j?.result?.value ?? [];
    let total = BigInt(0);
    for (const a of accts) {
      const raw = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (raw) total += BigInt(raw);
    }
    return total;
  } catch (err) {
    console.error(`[dca-notify] Balance check RPC failed:`, err);
    return null;
  }
}
