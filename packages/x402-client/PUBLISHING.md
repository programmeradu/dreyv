# Publishing `@dreyv/x402-client`

This package publishes to the public npm registry under the `@dreyv` scope.

## One-time setup

1. Confirm the `@dreyv` scope exists on npm and Samuel is an owner/admin.
   (If not: `npm org create dreyv` from an owner account, then add members.)
2. Create an npm **automation** token with *Publish* rights and store it as
   the `NPM_TOKEN` build secret in the workspace.

## Release checklist (each version)

From the repo root:

```bash
cd packages/x402-client

# 1. Verify build is clean
npm run build

# 2. Sanity check what will actually ship
npm pack --dry-run

# 3. Bump version (updates package.json + creates a git tag)
#    Use one of: patch | minor | major
npm version minor -m "x402-client: release v%s"

# 4. Publish (public access is required for scoped packages)
NPM_TOKEN=$NPM_TOKEN npm publish --access public
```

`prepublishOnly` runs `npm run build` automatically, so `dist/` is always
regenerated from source before the tarball is created. `dist/` is *not*
committed to git — it is a build artifact produced at publish time and
included via the `files` field in `package.json`.

## Verification

```bash
npm view @dreyv/x402-client
npm view @dreyv/x402-client versions --json
```

Then smoke-test in a scratch project:

```bash
mkdir /tmp/x402-smoke && cd /tmp/x402-smoke
npm init -y
npm install @dreyv/x402-client
node -e "const { DreyvX402Client } = require('@dreyv/x402-client'); \
  console.log(new DreyvX402Client({ apiKey: 'dk_live_test' }))"
```

## Release notes for v0.1.0

See [`CHANGELOG.md`](./CHANGELOG.md). Highlights:

- First buyer-side SDK for x402.
- Per-call cap + per-run budget guardrails.
- Typed errors (`X402BudgetError`, `X402CapError`, `X402FacilitatorError`,
  `X402ProtocolError`) and receipt history.
- No key material inside the SDK — settlement runs through the Dreyv
  facilitator at `/api/x402/proxy`.
- Positioned as the buyer-side companion to Cloudflare Monetization Gateway
  and other x402 sellers. See https://dreyv.com/x402.
