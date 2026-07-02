# Changelog

All notable changes to `@dreyv/mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semver.

## [0.1.0] — Initial release

### Added
- `dreyvMcpTransport({ apiKey })` — returns an AI SDK `transport` config for the Dreyv remote MCP endpoint over Streamable HTTP.
- `fetchDreyvMcpDiscovery()` — reads the public `/.well-known/mcp.json` discovery document.
- Exported constants: `DREYV_MCP_ENDPOINT`, `DREYV_MCP_DISCOVERY`, `DREYV_MCP_MANIFEST`, `DREYV_API_KEY_PREFIX`, `DREYV_KEY_MINT_URL`.
- MIT license, Dreyv-owned.
