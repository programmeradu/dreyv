# Changelog

All notable changes to `@dreyv/x402-client` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-07-01

Initial public release. The first buyer-side SDK for the x402 payment protocol.

### Added
- `DreyvX402Client` class — drop-in fetch wrapper that transparently handles
  HTTP `402 Payment Required` responses from any x402-protected URL.
- Per-call spend cap (`maxCostPerCall`) and per-run budget (`maxRunBudget`)
  guardrails, enforced before the facilitator is ever contacted.
- In-memory receipt history (`client.receipts()`), each entry linking the
  request, the settled amount, the rail, and the facilitator reference.
- Typed error surface: `X402BudgetError`, `X402CapError`,
  `X402FacilitatorError`, `X402ProtocolError`.
- `client.getJson<T>()` convenience helper for JSON responses.
- Uses the Dreyv facilitator (`/api/x402/proxy`) so the SDK itself carries no
  key material — safe to embed inside untrusted agent runtimes.

### Positioning
Companion to seller-side gateways such as Cloudflare Monetization Gateway:
Dreyv gives the *buyer* (the agent) a wallet, a budget, and an audit trail.
See https://dreyv.com/x402.
