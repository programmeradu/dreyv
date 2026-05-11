/**
 * Benchmark vault fixture.
 *
 * Every benchmark call gets this fixture injected as live treasury context
 * inside the system prompt. The point: models can no longer hide behind
 * "connect a wallet first" — the wallet, balances, positions and flows are
 * already provided. If they still ask the user to connect, they fail.
 *
 * Numbers are stable (no randomness) so deterministic mustInclude checks
 * and the LLM judge get reproducible results across providers.
 */

export const VAULT_FIXTURE = {
  name: "Dreyv Founders Vault",
  address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  custody: "Squads 2-of-3 multisig",
  totalUsd: 4_814_500,
  asOf: "2026-05-11",
  prices: { SOL: 190, mSOL: 200, JTO: 2.5, JLP: 4.2, USDC: 1 },
  holdings: [
    { symbol: "SOL", amount: 8_000, usd: 1_520_000, pctOfTreasury: 31.6 },
    { symbol: "USDC", amount: 1_200_000, usd: 1_200_000, pctOfTreasury: 24.9 },
    { symbol: "mSOL", amount: 5_000, usd: 1_000_000, pctOfTreasury: 20.8 },
    { symbol: "JLP", amount: 210_000, usd: 882_000, pctOfTreasury: 18.3 },
    { symbol: "JTO", amount: 85_000, usd: 212_500, pctOfTreasury: 4.4 },
  ],
  defiPositions: [
    { protocol: "Marinade", kind: "liquid_stake", asset: "mSOL", amount: 5_000, apy: 7.1 },
    { protocol: "Kamino", kind: "lend", asset: "USDC", amount: 600_000, apy: 5.2 },
  ],
  validators: [
    { name: "Jito SOL Pool", stakedSol: 0 },
    { name: "Marinade Delegated Set", stakedSol: 5_000 },
  ],
  flows7d: { inflowsUsd: 45_000, outflowsUsd: 28_000, netUsd: 17_000 },
  flows30d: { inflowsUsd: 180_000, outflowsUsd: 95_000, netUsd: 85_000 },
  burn: { monthlyUsd: 95_000, runwayMonths: 12.6 }, // runway uses USDC float
  pnl: {
    JTO: { costBasisUsd: 340_000, marketUsd: 212_500, unrealizedUsd: -127_500 },
    SOL: { costBasisUsd: 1_140_000, marketUsd: 1_520_000, unrealizedUsd: 380_000 },
  },
  concentration: { hhi: 3_400, topTokenPct: 31.6, stablePct: 24.9 },
  nfts: [
    { name: "Mad Lads #4421", floor: 32 },
    { name: "Tensorian Founder Badge", floor: 0 },
  ],
} as const;

export const VAULT_CONTEXT = `LIVE_TREASURY_CONTEXT (treat as ground truth, do not ask the user to connect a wallet — it is already connected):

Vault: ${VAULT_FIXTURE.name}
Address: ${VAULT_FIXTURE.address}
Custody: ${VAULT_FIXTURE.custody}
Total value: $${VAULT_FIXTURE.totalUsd.toLocaleString()} as of ${VAULT_FIXTURE.asOf}

Holdings:
${VAULT_FIXTURE.holdings.map((h) => `- ${h.amount.toLocaleString()} ${h.symbol} ≈ $${h.usd.toLocaleString()} (${h.pctOfTreasury}%)`).join("\n")}

DeFi positions:
${VAULT_FIXTURE.defiPositions.map((p) => `- ${p.protocol} · ${p.kind} ${p.amount.toLocaleString()} ${p.asset} @ ${p.apy}% APY`).join("\n")}

Staking:
${VAULT_FIXTURE.validators.map((v) => `- ${v.name}: ${v.stakedSol.toLocaleString()} SOL`).join("\n")}

Flows: 7d in/out $${VAULT_FIXTURE.flows7d.inflowsUsd.toLocaleString()} / $${VAULT_FIXTURE.flows7d.outflowsUsd.toLocaleString()} (net $${VAULT_FIXTURE.flows7d.netUsd.toLocaleString()}); 30d in/out $${VAULT_FIXTURE.flows30d.inflowsUsd.toLocaleString()} / $${VAULT_FIXTURE.flows30d.outflowsUsd.toLocaleString()}.

Burn: $${VAULT_FIXTURE.burn.monthlyUsd.toLocaleString()}/mo. Runway on USDC float: ${VAULT_FIXTURE.burn.runwayMonths} months.

Unrealized PnL: JTO ${VAULT_FIXTURE.pnl.JTO.unrealizedUsd >= 0 ? "+" : ""}$${VAULT_FIXTURE.pnl.JTO.unrealizedUsd.toLocaleString()}; SOL +$${VAULT_FIXTURE.pnl.SOL.unrealizedUsd.toLocaleString()}.

Concentration: HHI ${VAULT_FIXTURE.concentration.hhi}, top token ${VAULT_FIXTURE.concentration.topTokenPct}%, stables ${VAULT_FIXTURE.concentration.stablePct}%.

NFTs: ${VAULT_FIXTURE.nfts.map((n) => n.name).join(", ")}.

Use this context to answer concrete questions directly. Only ask the user for clarification when the question genuinely cannot be answered from the data above (e.g. preferences, new actions, or out-of-scope tasks).`;
