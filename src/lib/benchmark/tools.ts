/**
 * OpenAI-compatible function/tool definitions used by the benchmark when
 * testing tool-calling capability. Mirrors a subset of the Atlas tool manifest
 * so we can grade both (a) "did the model pick the right tool", (b) "did it
 * pass the right parameters", and (c) "did it correctly NOT auto-fill params
 * the user never provided".
 */

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

export const BENCHMARK_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "swap_tokens",
      description: "Swap one Solana token for another via Jupiter. Use for 'swap X to Y', 'buy Y with X', 'sell X for Y'.",
      parameters: {
        type: "object",
        properties: {
          input_token: { type: "string", description: "Symbol of token to sell, e.g. SOL, USDC" },
          output_token: { type: "string", description: "Symbol of token to buy" },
          amount: { type: "number", description: "Amount of input token to sell" },
        },
        required: ["input_token", "output_token", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stake_sol",
      description: "Liquid-stake SOL for yield via Marinade, Jito or BlazeStake.",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["marinade", "jito", "blazestake"] },
          amount: { type: "number", description: "Amount of SOL to stake" },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "provide_liquidity",
      description: "Add liquidity to a SOL/USDC pool via Orca or Raydium.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number", description: "Amount of SOL" } },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scan_airdrops",
      description: "Scan the connected wallet for potential airdrops and quests.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "scan_mev",
      description: "Scan recent transactions for MEV opportunities or incidents.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_dca_bot",
      description: "Create a Dollar-Cost Averaging bot for recurring token purchases.",
      parameters: {
        type: "object",
        properties: {
          in_mint: { type: "string", description: "Token symbol to spend" },
          out_mint: { type: "string", description: "Token symbol to buy" },
          amount: { type: "number" },
          frequency: { type: "string", enum: ["daily", "weekly", "monthly"] },
        },
        required: ["in_mint", "out_mint", "amount", "frequency"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rug_pull_detector",
      description: "Assess rug-pull risk for a Solana token by mint address.",
      parameters: {
        type: "object",
        properties: { mint_address: { type: "string" } },
        required: ["mint_address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transaction_time_machine",
      description: "Look up and analyze a past Solana transaction by signature.",
      parameters: {
        type: "object",
        properties: { signature: { type: "string" } },
        required: ["signature"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_trader",
      description: "Mirror trades from another wallet address.",
      parameters: {
        type: "object",
        properties: { target_wallet: { type: "string" } },
        required: ["target_wallet"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to_tab",
      description: "Navigate to a tab. Allowed: 'lab' (Strategy Lab) or 'quests' (Tools).",
      parameters: {
        type: "object",
        properties: { tab_id: { type: "string", enum: ["lab", "quests"] } },
        required: ["tab_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "price_check",
      description: "Check the current price of a Solana token by symbol.",
      parameters: {
        type: "object",
        properties: { token: { type: "string" } },
        required: ["token"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_portfolio",
      description: "Show the connected wallet's balance and portfolio overview.",
      parameters: { type: "object", properties: {} },
    },
  },
];
