# _archive

Keystone-era packages preserved for reference only. **Not published, not built, not imported by the Dreyv app.**

- `sdk/` — original `@keystone/sdk` React hooks for mini-app authors (Keystone Studio marketplace vision).
- `cli/` — original `@keystone-os/cli` (`keystone init/ship/publish/deploy`) for the mini-app marketplace.

Dreyv's current developer surface is:

- **MCP** — `https://dreyv.com/api/mcp` (see `packages/mcp`)
- **x402 buyer SDK** — `@dreyv/x402-client` (see `packages/x402-client`)
- **REST + OpenAPI** — `https://dreyv.com/openapi.json`

The old `@keystone-os/cli` npm package will be `npm deprecate`d pointing to `https://dreyv.com/developers`. Do not resurrect these packages under the `@dreyv` scope without a fresh product decision.
