# @dreyv/mcp

Official helper for the **Dreyv MCP server** — a remote [Model Context Protocol](https://modelcontextprotocol.io) endpoint that gives your AI agent a wallet, a budget, and 300+ real Web3 treasury capabilities (research, execution, forensics, governance, on-chain reads/writes) behind **one Bearer key**.

- Endpoint: `https://dreyv.com/api/mcp` (Streamable HTTP)
- Discovery: `https://dreyv.com/.well-known/mcp.json`
- Key mint: `https://dreyv.com/app/settings/api`

## Install

```bash
npm i @dreyv/mcp @ai-sdk/mcp
```

## Use with the AI SDK

```ts
import { createMCPClient } from "@ai-sdk/mcp";
import { dreyvMcpTransport } from "@dreyv/mcp";

const client = await createMCPClient({
  transport: dreyvMcpTransport({ apiKey: process.env.DREYV_API_KEY! }),
});

const tools = await client.tools();
// pass `tools` into streamText / generateText alongside your own tools
```

## Discovery (no auth)

```ts
import { fetchDreyvMcpDiscovery } from "@dreyv/mcp";

const info = await fetchDreyvMcpDiscovery();
console.log(info.tools, "tools available");
```

## Get a key

Sign in at [dreyv.com](https://dreyv.com) → **Settings → API Keys**. Live keys are prefixed `dk_live_`.

## Docs

- MCP developer docs: <https://dreyv.com/developers/mcp>
- Full developer surface: <https://dreyv.com/developers>
