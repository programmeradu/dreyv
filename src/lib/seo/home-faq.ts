/** Home page FAQ: single source for UI and FAQPage JSON-LD. */
export const HOME_FAQ_ITEMS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "Who is dreyv for?",
    answer:
      "Teams that run real money on Solana: DAOs, protocol foundations, startups with onchain treasuries, and operators who live in Squads, Jupiter and a dozen other tabs. If your approvers need to see what a transaction does before they sign, dreyv is for you.",
  },
  {
    question: "What is dreyv?",
    answer:
      "dreyv is a non-custodial treasury workspace for teams on Solana. You describe what you want in plain language. dreyv turns it into a plan, simulates it on a fork so approvers see balances, routes and risk in readable form instead of raw hex, and sends it to the multisig you already use, such as Squads. We never hold your assets. You keep the keys.",
  },
  {
    question: "How is dreyv different from Squads or another multisig?",
    answer:
      "A multisig is where approvals happen. dreyv is where you put the plan together, compare routes and preview the result before the proposal is ready to sign. Use both: plan and simulate in dreyv, then execute with the signers and policies you already trust.",
  },
  {
    question: "What does treasury by intent mean?",
    answer:
      "You say what you want, for example \u201crebalance to target weights\u201d or \u201cswap the surplus into stables\u201d, review the plan and the simulation, then approve with your wallet when you are ready. No clicking through a pile of separate tools.",
  },
  {
    question: "Is dreyv custodial?",
    answer:
      "No. dreyv coordinates and explains. You connect your wallet and multisig, and every proposal and transaction is signed with your keys. dreyv never takes custody of assets.",
  },
  {
    question: "Does dreyv work with Squads multisig?",
    answer:
      "Yes. dreyv sits on top of Squads and similar multisig setups, so your policies and signatures stay where your team already works.",
  },
  {
    question: "Which networks does dreyv support?",
    answer:
      "Today dreyv is focused on Solana treasuries, routing and tooling, including Jupiter and other Solana integrations. More chains may follow.",
  },
  {
    question: "What does simulation mean in dreyv?",
    answer:
      "Before anyone signs, dreyv runs the proposed transaction against a copy of mainnet: balances, routes, slippage assumptions and risk signals, shown in plain words instead of raw hex.",
  },
];
