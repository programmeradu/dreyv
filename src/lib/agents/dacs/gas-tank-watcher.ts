/**
 * Phase 7B.3 — Gas-tank watcher cron.
 *
 * Every 2 minutes, for each enabled `gas_tank_rules` row:
 *   1. Resolve wallet SOL balance via Helius RPC `getBalance`.
 *   2. Persist the reading (`last_balance_sol`, `last_checked_at`) regardless.
 *   3. If balance >= floorSol → no-op.
 *   4. If balance < floorSol AND today's refill count < maxRefillsPerDay AND
 *      no `pending_signature` refill already exists for this rule → quote a
 *      Jupiter swap (fundingToken → SOL) sized to top up to `targetSol`,
 *      build the unsigned VersionedTransaction via Jupiter `/swap`, and
 *      insert a `gas_tank_refills` row in `pending_signature`.
 *   5. Daily counter rolls over by UTC date bucket.
 *
 * Side effects:
 *   - Inserts an `agent_episodes` row on each refill drafted so the planner
 *     sees gas-tank activity in this user's history.
 *   - GC: expires unsigned refill rows older than 4 hours.
 */
import { inngest } from "../inngest-client";
import { db } from "@/db";
import { gasTankRules, gasTankRefills, agentEpisodes } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";

const RPC = process.env.HELIUS_RPC_URL
  || (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : null)
  || process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  || "https://api.mainnet-beta.solana.com";

const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP = "https://lite-api.jup.ag/swap/v1/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;

/** Map symbol → decimals (matches `tokens.ts`). */
function decimalsFor(symbol: string): number {
  return ["USDC", "USDT"].includes(symbol.toUpperCase()) ? 6 : 9;
}

function utcDayBucket(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getSolBalance(walletAddress: string): Promise<number> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [walletAddress, { commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Helius getBalance ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json();
  if (json.error) throw new Error(`Helius getBalance error: ${json.error.message}`);
  return (json.result?.value ?? 0) / 1e9;
}

async function quoteAndBuildSwap(params: {
  inputMint: string;
  inputDecimals: number;
  outputSol: number;
  walletAddress: string;
  slippageBps: number;
}): Promise<{
  inAmount: string;
  outAmount: string;
  serializedTransaction: string;
  quote: unknown;
}> {
  // We need to *deliver* `outputSol` SOL — Jupiter's API takes input amount, so
  // use the reverse-quote pattern: quote SOL→input first to find the equivalent
  // input amount, then quote input→SOL with that amount and build the tx.
  const wantedSolLamports = Math.ceil(params.outputSol * 10 ** SOL_DECIMALS);

  // Reverse quote (SOL → funding token) gives us the input amount needed.
  const reverseUrl = new URL(JUP_QUOTE);
  reverseUrl.searchParams.set("inputMint", SOL_MINT);
  reverseUrl.searchParams.set("outputMint", params.inputMint);
  reverseUrl.searchParams.set("amount", String(wantedSolLamports));
  reverseUrl.searchParams.set("slippageBps", String(params.slippageBps));
  const reverseRes = await fetch(reverseUrl, { signal: AbortSignal.timeout(10_000) });
  if (!reverseRes.ok) throw new Error(`Jupiter reverse-quote ${reverseRes.status}`);
  const reverseQuote = await reverseRes.json();
  // Add 1% buffer so slippage doesn't underdeliver.
  const fundingNeeded = Math.ceil(Number(reverseQuote.outAmount) * 1.01);

  // Forward quote (funding → SOL) with the buffered input amount.
  const fwdUrl = new URL(JUP_QUOTE);
  fwdUrl.searchParams.set("inputMint", params.inputMint);
  fwdUrl.searchParams.set("outputMint", SOL_MINT);
  fwdUrl.searchParams.set("amount", String(fundingNeeded));
  fwdUrl.searchParams.set("slippageBps", String(params.slippageBps));
  const fwdRes = await fetch(fwdUrl, { signal: AbortSignal.timeout(10_000) });
  if (!fwdRes.ok) throw new Error(`Jupiter forward-quote ${fwdRes.status}`);
  const quote = await fwdRes.json();

  // Build the swap tx for this wallet.
  const swapRes = await fetch(JUP_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: params.walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!swapRes.ok) throw new Error(`Jupiter /swap ${swapRes.status}: ${await swapRes.text().catch(() => "")}`);
  const swapJson = await swapRes.json();
  if (!swapJson.swapTransaction) throw new Error("Jupiter /swap returned no swapTransaction");

  return {
    inAmount: String(quote.inAmount),
    outAmount: String(quote.outAmount),
    serializedTransaction: swapJson.swapTransaction,
    quote,
  };
}

type RuleRow = typeof gasTankRules.$inferSelect;

export const gasTankWatcher = inngest.createFunction(
  {
    id: "dacs-gas-tank-watcher",
    name: "DACS · Gas-tank watcher (Helius poll → Jupiter swap)",
    concurrency: { limit: 1 },
    retries: 0,
  },
  { cron: "*/2 * * * *" },
  async ({ step, logger }) => {
    if (!db) {
      logger.warn("[gas-tank-watcher] DB not initialized, skipping");
      return { skipped: true };
    }

    const today = utcDayBucket();

    const rules: RuleRow[] = await step.run("load-enabled-rules", async () => {
      return await db!
        .select()
        .from(gasTankRules)
        .where(eq(gasTankRules.enabled, true))
        .limit(100);
    });

    if (rules.length === 0) {
      // Still GC stale unsigned refills.
      await step.run("gc-stale-refills", async () => {
        const cutoff = new Date(Date.now() - 4 * 60 * 60_000);
        await db!
          .update(gasTankRefills)
          .set({ status: "expired", failureReason: "Unsigned for >4h", updatedAt: new Date() })
          .where(and(eq(gasTankRefills.status, "pending_signature"), lt(gasTankRefills.createdAt, cutoff)));
      });
      return { rules: 0 };
    }

    let polled = 0;
    let drafted = 0;
    let skippedAboveFloor = 0;
    let skippedDailyCap = 0;
    let skippedPending = 0;
    let errored = 0;

    for (const rule of rules) {
      // 1. Poll balance — wrap in step so retries are deduped per rule.
      const balanceResult = await step.run(`poll-${rule.id}`, async () =>
        getSolBalance(rule.walletAddress).then((sol) => ({ sol, error: null as string | null }))
                                          .catch((e) => ({ sol: null as number | null, error: e instanceof Error ? e.message : String(e) }))
      );
      polled += 1;

      // Reset daily counter on UTC rollover.
      const refillsToday = rule.refillDayBucket === today ? rule.refillsToday : 0;
      const dayBucket = today;

      await step.run(`store-balance-${rule.id}`, async () => {
        await db!
          .update(gasTankRules)
          .set({
            lastBalanceSol: balanceResult.sol !== null ? String(balanceResult.sol) : rule.lastBalanceSol,
            lastCheckedAt: new Date(),
            refillDayBucket: dayBucket,
            refillsToday,
            updatedAt: new Date(),
          })
          .where(eq(gasTankRules.id, rule.id));
      });

      if (balanceResult.error || balanceResult.sol === null) {
        errored += 1;
        logger.warn(`[gas-tank-watcher] balance fetch failed for ${rule.walletAddress}: ${balanceResult.error}`);
        continue;
      }
      const balanceSol: number = balanceResult.sol;

      const floor = parseFloat(rule.floorSol);
      const target = parseFloat(rule.targetSol);
      if (balanceSol >= floor) {
        skippedAboveFloor += 1;
        continue;
      }
      if (refillsToday >= rule.maxRefillsPerDay) {
        skippedDailyCap += 1;
        continue;
      }

      // Skip if there's already a pending refill (don't stack proposals).
      const existing = await step.run(`check-pending-${rule.id}`, async () =>
        db!
          .select({ id: gasTankRefills.id })
          .from(gasTankRefills)
          .where(and(eq(gasTankRefills.ruleId, rule.id), eq(gasTankRefills.status, "pending_signature")))
          .limit(1)
      );
      if (existing.length > 0) {
        skippedPending += 1;
        continue;
      }

      const refillSol = Math.max(target - balanceSol, 0.001);

      // 2. Quote + build swap.
      try {
        const swap = await step.run(`build-swap-${rule.id}`, async () =>
          quoteAndBuildSwap({
            inputMint: rule.fundingMint,
            inputDecimals: decimalsFor(rule.fundingToken),
            outputSol: refillSol,
            walletAddress: rule.walletAddress,
            slippageBps: rule.slippageBps,
          })
        );

        await step.run(`insert-refill-${rule.id}`, async () => {
          const insertedRefill = await db!
            .insert(gasTankRefills)
            .values({
              ruleId: rule.id,
              walletAddress: rule.walletAddress,
              triggerBalanceSol: String(balanceSol),
              targetSol: rule.targetSol,
              refillSol: String(refillSol),
              inAmount: swap.inAmount,
              outAmount: swap.outAmount,
              fundingToken: rule.fundingToken,
              fundingMint: rule.fundingMint,
              slippageBps: rule.slippageBps,
              serializedTransaction: swap.serializedTransaction,
              quoteJson: JSON.stringify(swap.quote),
              status: "pending_signature",
            })
            .returning({ id: gasTankRefills.id });

          await db!
            .update(gasTankRules)
            .set({
              lastTriggeredAt: new Date(),
              refillsToday: refillsToday + 1,
              updatedAt: new Date(),
            })
            .where(eq(gasTankRules.id, rule.id));

          // Best-effort episode for the planner.
          try {
            await db!.insert(agentEpisodes).values({
              commandId: `gas-tank-watcher-${insertedRefill[0].id}`,
              walletAddress: rule.walletAddress,
              intentKind: "gas_tank_refill_drafted",
              capabilityIds: ["gas_tank_topup"] as unknown as Record<string, unknown>,
              outcome: "needs_signature",
              notes: `Gas-tank refill drafted: balance ${balanceSol.toFixed(4)} SOL < floor ${floor} SOL → swap ${(Number(swap.inAmount) / 10 ** decimalsFor(rule.fundingToken)).toFixed(4)} ${rule.fundingToken} for ~${refillSol.toFixed(4)} SOL`,
            });
          } catch (epErr) {
            logger.warn(`[gas-tank-watcher] episode insert failed for refill: ${epErr}`);
          }
        });
        drafted += 1;
      } catch (err) {
        errored += 1;
        logger.error(`[gas-tank-watcher] swap build failed for rule ${rule.id}:`, err);
      }
    }

    // GC stale unsigned refills.
    await step.run("gc-stale-refills", async () => {
      const cutoff = new Date(Date.now() - 4 * 60 * 60_000);
      await db!
        .update(gasTankRefills)
        .set({ status: "expired", failureReason: "Unsigned for >4h", updatedAt: new Date() })
        .where(and(eq(gasTankRefills.status, "pending_signature"), lt(gasTankRefills.createdAt, cutoff)));
    });

    return { rules: rules.length, polled, drafted, skippedAboveFloor, skippedDailyCap, skippedPending, errored };
  },
);
