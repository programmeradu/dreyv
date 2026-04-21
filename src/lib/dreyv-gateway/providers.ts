/**
 * Dreyv Connector Gateway — Provider Registry
 *
 * Each provider declares:
 *   - the secret fields it needs (collected via the Studio key wizard)
 *   - public (non-secret) config fields
 *   - how to translate a logical request into an upstream HTTPS call
 *
 * Adapters are intentionally narrow — only the operations that Studio
 * templates actually invoke. Anything outside the allowlist is rejected
 * by the gateway route.
 */

export type AuthType = "api_key" | "oauth";

export interface ProviderField {
  name: string;
  label: string;
  type: "text" | "password" | "email";
  placeholder?: string;
  helpText?: string;
  required?: boolean;
}

export interface BuiltRequest {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  category: "rpc" | "swap" | "data" | "staking" | "oracle" | "email" | "messaging";
  authType: AuthType;
  description: string;
  docsUrl: string;
  secretFields: ProviderField[];
  publicFields?: ProviderField[];
  /** Operations the gateway is allowed to invoke. */
  operations: Record<
    string,
    (
      params: Record<string, unknown>,
      ctx: { secrets: Record<string, string>; publicConfig: Record<string, unknown> }
    ) => BuiltRequest
  >;
}

/** Helius — Solana RPC + DAS. API-key auth. */
const helius: ProviderDefinition = {
  id: "helius",
  name: "Helius",
  category: "rpc",
  authType: "api_key",
  description: "Solana RPC + enhanced APIs (DAS, webhooks).",
  docsUrl: "https://docs.helius.dev",
  secretFields: [
    {
      name: "apiKey",
      label: "Helius API Key",
      type: "password",
      placeholder: "hel_xxx...",
      helpText: "Create one at dashboard.helius.dev → API Keys.",
      required: true,
    },
  ],
  operations: {
    rpc: (params, { secrets }) => ({
      url: `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(secrets.apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: params,
    }),
    getAssetsByOwner: (params, { secrets }) => ({
      url: `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(secrets.apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: "1",
        method: "getAssetsByOwner",
        params,
      },
    }),
  },
};

/** Jupiter — public swap aggregator. No secret needed. */
const jupiter: ProviderDefinition = {
  id: "jupiter",
  name: "Jupiter",
  category: "swap",
  authType: "api_key",
  description: "Solana swap aggregator. Public API — no key required.",
  docsUrl: "https://station.jup.ag/docs/apis/swap-api",
  secretFields: [],
  operations: {
    quote: (params) => ({
      url: `https://quote-api.jup.ag/v6/quote?${new URLSearchParams(
        params as Record<string, string>
      ).toString()}`,
      method: "GET",
    }),
    swap: (params) => ({
      url: "https://quote-api.jup.ag/v6/swap",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: params,
    }),
  },
};

/** Birdeye — token data. API-key in header. */
const birdeye: ProviderDefinition = {
  id: "birdeye",
  name: "Birdeye",
  category: "data",
  authType: "api_key",
  description: "Solana token prices, OHLCV, holders.",
  docsUrl: "https://docs.birdeye.so",
  secretFields: [
    {
      name: "apiKey",
      label: "Birdeye API Key",
      type: "password",
      helpText: "From bds.birdeye.so → API Dashboard.",
      required: true,
    },
  ],
  operations: {
    tokenPrice: (params, { secrets }) => ({
      url: `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(
        String(params.address ?? "")
      )}`,
      method: "GET",
      headers: { "X-API-KEY": secrets.apiKey, "x-chain": "solana" },
    }),
    tokenOverview: (params, { secrets }) => ({
      url: `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(
        String(params.address ?? "")
      )}`,
      method: "GET",
      headers: { "X-API-KEY": secrets.apiKey, "x-chain": "solana" },
    }),
  },
};

/** Marinade — public staking SDK endpoints. */
const marinade: ProviderDefinition = {
  id: "marinade",
  name: "Marinade",
  category: "staking",
  authType: "api_key",
  description: "mSOL liquid staking analytics.",
  docsUrl: "https://docs.marinade.finance",
  secretFields: [],
  operations: {
    state: () => ({
      url: "https://api.marinade.finance/msol/apy/30d",
      method: "GET",
    }),
  },
};

/** Pyth — public price feeds. */
const pyth: ProviderDefinition = {
  id: "pyth",
  name: "Pyth",
  category: "oracle",
  authType: "api_key",
  description: "Real-time on-chain oracles.",
  docsUrl: "https://docs.pyth.network",
  secretFields: [],
  operations: {
    latest: (params) => {
      const ids = (params.ids as string[] | undefined) ?? [];
      const qs = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
      return {
        url: `https://hermes.pyth.network/api/latest_price_feeds?${qs}`,
        method: "GET",
      };
    },
  },
};

/** Resend — transactional email. API-key auth. */
const resend: ProviderDefinition = {
  id: "resend",
  name: "Resend",
  category: "email",
  authType: "api_key",
  description: "Transactional email API.",
  docsUrl: "https://resend.com/docs",
  secretFields: [
    {
      name: "apiKey",
      label: "Resend API Key",
      type: "password",
      placeholder: "re_xxx...",
      helpText: "Create at resend.com/api-keys.",
      required: true,
    },
  ],
  publicFields: [
    {
      name: "fromEmail",
      label: "From email",
      type: "email",
      placeholder: "you@yourdomain.com",
      helpText: "Use a verified domain — or onboarding@resend.dev for testing.",
      required: true,
    },
  ],
  operations: {
    send: (params, { secrets, publicConfig }) => ({
      url: "https://api.resend.com/emails",
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.apiKey}`,
        "Content-Type": "application/json",
      },
      body: {
        from: publicConfig.fromEmail,
        ...params,
      },
    }),
  },
};

/** Telegram — Bot API, token-based. */
const telegram: ProviderDefinition = {
  id: "telegram",
  name: "Telegram",
  category: "messaging",
  authType: "api_key",
  description: "Send messages via the Telegram Bot API.",
  docsUrl: "https://core.telegram.org/bots/api",
  secretFields: [
    {
      name: "botToken",
      label: "Bot token",
      type: "password",
      placeholder: "123456:ABC...",
      helpText: "From @BotFather → /newbot.",
      required: true,
    },
  ],
  publicFields: [
    {
      name: "defaultChatId",
      label: "Default chat ID",
      type: "text",
      placeholder: "-1001234567890",
      helpText: "Your channel/group ID. Get it from @userinfobot.",
    },
  ],
  operations: {
    sendMessage: (params, { secrets, publicConfig }) => ({
      url: `https://api.telegram.org/bot${secrets.botToken}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        chat_id: params.chat_id ?? publicConfig.defaultChatId,
        text: params.text,
        parse_mode: params.parse_mode ?? "Markdown",
      },
    }),
  },
};

/** Slack — Bot token. */
const slack: ProviderDefinition = {
  id: "slack",
  name: "Slack",
  category: "messaging",
  authType: "api_key",
  description: "Post messages to a Slack workspace using a bot token.",
  docsUrl: "https://api.slack.com/authentication/token-types",
  secretFields: [
    {
      name: "botToken",
      label: "Bot user OAuth token",
      type: "password",
      placeholder: "xoxb-...",
      helpText: "From your Slack app → OAuth & Permissions.",
      required: true,
    },
  ],
  publicFields: [
    {
      name: "defaultChannel",
      label: "Default channel",
      type: "text",
      placeholder: "C0123456789 or #general",
    },
  ],
  operations: {
    postMessage: (params, { secrets, publicConfig }) => ({
      url: "https://slack.com/api/chat.postMessage",
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: {
        channel: params.channel ?? publicConfig.defaultChannel,
        text: params.text,
        blocks: params.blocks,
      },
    }),
  },
};

export const PROVIDERS: Record<string, ProviderDefinition> = {
  helius,
  jupiter,
  birdeye,
  marinade,
  pyth,
  resend,
  telegram,
  slack,
};

export function getProvider(id: string): ProviderDefinition | null {
  return PROVIDERS[id] ?? null;
}

/** Public-safe metadata for the Studio UI (no secrets / no adapter code). */
export function listProvidersPublic() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    authType: p.authType,
    description: p.description,
    docsUrl: p.docsUrl,
    secretFields: p.secretFields,
    publicFields: p.publicFields ?? [],
    operations: Object.keys(p.operations),
  }));
}
