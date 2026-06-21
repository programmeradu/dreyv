/**
 * Public API + MCP scope catalog (UI metadata).
 *
 * Source of truth for scope IDs is `src/lib/api-keys/public-keys.ts#ALL_SCOPES`.
 * This file enriches each scope with a human label, description, and group
 * so the key-minting UI can render presets ("All", "Read-only", "Write",
 * "Default") plus a grouped picker. A unit-style sanity check at the bottom
 * ensures we never drift from the server's ALL_SCOPES list.
 */
// NOTE: client-safe — no server-only deps (drizzle/db/node:crypto). The drift
// check against the server's ALL_SCOPES lives in `scope-catalog.server.ts`.
export type ApiScope = string;

export type ScopeGroup = "data" | "write" | "publish" | "payments";

export interface ScopeMeta {
  id: ApiScope;
  label: string;
  desc: string;
  group: ScopeGroup;
}

export const SCOPE_GROUP_LABEL: Record<ScopeGroup, string> = {
  data: "Read · data & insights",
  write: "Write · actions & mutations",
  publish: "Publish · marketplace assets",
  payments: "Payments & delegation",
};

export const SCOPE_CATALOG: ScopeMeta[] = [
  // ── Read ──────────────────────────────────────────────────────────────
  { id: "read:portfolio",     label: "Portfolio",            desc: "Holdings, PnL, DeFi positions.",                          group: "data" },
  { id: "read:treasury",      label: "Treasury",             desc: "Health, runway, multisig pending.",                       group: "data" },
  { id: "read:market",        label: "Market",               desc: "Prices, OHLCV, yields, discovery.",                       group: "data" },
  { id: "read:forensics",     label: "Forensics",            desc: "Sanctions, mixer exposure, counterparty graphs.",         group: "data" },
  { id: "read:notifications", label: "Notifications",        desc: "Channel preferences, delivery history.",                  group: "data" },
  { id: "read:audit",         label: "Audit log",            desc: "Request, usage, policy and evidence trails.",             group: "data" },
  { id: "read:teams",         label: "Teams",                desc: "Members, roles, invites, activity.",                      group: "data" },
  { id: "read:billing",       label: "Billing",              desc: "Plan, invoices, usage, credits.",                         group: "data" },
  { id: "read:privacy",       label: "Privacy",              desc: "Consent records, redaction status, DSR jobs.",            group: "data" },
  { id: "read:storage",       label: "Storage",              desc: "Buckets, objects, signed-URL inventory.",                 group: "data" },
  { id: "read:search",        label: "Search",               desc: "Saved queries, facets, full-text indexes.",               group: "data" },
  { id: "read:status",        label: "Status",               desc: "Incident pages, subscribers, components.",                group: "data" },
  { id: "read:jobs",          label: "Jobs",                 desc: "Background job inventory and progress.",                  group: "data" },
  { id: "read:exports",       label: "Exports",              desc: "CSV/JSON export bundles and history.",                    group: "data" },
  { id: "read:tags",          label: "Tags",                 desc: "Tag catalog and assignments.",                            group: "data" },
  { id: "read:flags",         label: "Feature flags",        desc: "Flag definitions and evaluations.",                       group: "data" },
  { id: "read:insights",      label: "Insights",             desc: "Agent-generated insights and feed.",                      group: "data" },
  { id: "read:reports",       label: "Reports",              desc: "Generated reports and snapshots.",                        group: "data" },
  { id: "read:marketplace",   label: "Marketplace",          desc: "Listings, installs, reviews.",                            group: "data" },
  { id: "read:sla",           label: "SLA",                  desc: "Service-level agreements, credits, breach log.",          group: "data" },
  { id: "read:contracts",     label: "Contracts",            desc: "Templates, signed agreements, addenda.",                  group: "data" },
  { id: "read:obs",           label: "Observability",        desc: "Metrics, traces, error budgets.",                         group: "data" },
  { id: "read:limits",        label: "Rate limits",          desc: "Per-key quotas and burn-down.",                           group: "data" },
  { id: "read:residency",     label: "Data residency",       desc: "Region policy, data-locality posture.",                   group: "data" },
  { id: "read:digests",       label: "Digests",              desc: "Scheduled briefings and channels.",                       group: "data" },
  { id: "read:workflows",     label: "Workflows",            desc: "Workflow definitions and runs.",                          group: "data" },
  { id: "read:entitlements",  label: "Entitlements",         desc: "Plan caps, feature gates, overrides.",                    group: "data" },

  // ── Write ─────────────────────────────────────────────────────────────
  { id: "write:simulate",      label: "Simulate",            desc: "Pre-flight tx simulation, intent quoting.",               group: "write" },
  { id: "write:intent",        label: "Intent",              desc: "Submit MEV-protected intents and swaps.",                 group: "write" },
  { id: "write:trade",         label: "Trade",               desc: "Execute trades against routed venues.",                   group: "write" },
  { id: "write:watchers",      label: "Watchers",            desc: "Create/manage alerts, governance watchers.",              group: "write" },
  { id: "write:notifications", label: "Notifications",       desc: "Send notifications, mark read, manage prefs.",            group: "write" },
  { id: "write:teams",         label: "Teams",               desc: "Invite, remove, change roles.",                           group: "write" },
  { id: "write:billing",       label: "Billing",             desc: "Change plan, attach payment methods.",                    group: "write" },
  { id: "write:privacy",       label: "Privacy",             desc: "Submit DSRs, redact, set consent.",                       group: "write" },
  { id: "write:storage",       label: "Storage",             desc: "Upload, move, delete objects.",                           group: "write" },
  { id: "write:jobs",          label: "Jobs",                desc: "Enqueue, cancel, retry background jobs.",                  group: "write" },
  { id: "write:exports",       label: "Exports",             desc: "Trigger and revoke export bundles.",                      group: "write" },
  { id: "write:tags",          label: "Tags",                desc: "Create/assign/remove tags.",                              group: "write" },
  { id: "write:flags",         label: "Feature flags",       desc: "Toggle and roll out flags.",                              group: "write" },
  { id: "write:reports",       label: "Reports",             desc: "Generate and publish reports.",                           group: "write" },
  { id: "write:search",        label: "Search",              desc: "Save queries, manage indexes.",                           group: "write" },
  { id: "write:obs",           label: "Observability",       desc: "Push metrics, custom traces, SLOs.",                      group: "write" },
  { id: "write:audit",         label: "Audit log",           desc: "Append signed audit events.",                             group: "write" },
  { id: "write:limits",        label: "Rate limits",         desc: "Tune per-key quotas and overrides.",                      group: "write" },
  { id: "write:residency",     label: "Data residency",      desc: "Pin region, change locality policy.",                     group: "write" },
  { id: "write:digests",       label: "Digests",             desc: "Create digest channels and schedules.",                   group: "write" },
  { id: "write:workflows",     label: "Workflows",           desc: "Create, edit, run workflows.",                            group: "write" },
  { id: "write:entitlements",  label: "Entitlements",        desc: "Override caps and feature gates.",                        group: "write" },
  { id: "write:marketplace",   label: "Marketplace",         desc: "Install, configure, leave reviews.",                      group: "write" },
  { id: "write:sla",           label: "SLA",                 desc: "Define SLAs, compute credits.",                           group: "write" },
  { id: "write:contracts",     label: "Contracts",           desc: "Draft, sign, amend contracts.",                           group: "write" },

  // ── Publish ───────────────────────────────────────────────────────────
  { id: "publish:marketplace", label: "Publish marketplace", desc: "Publish or unpublish marketplace listings.",              group: "publish" },
  { id: "publish:sla",         label: "Publish SLA",         desc: "Publish SLA templates to the catalog.",                   group: "publish" },
  { id: "publish:contracts",   label: "Publish contracts",   desc: "Publish contract templates to the catalog.",              group: "publish" },

  // ── Payments & delegation ─────────────────────────────────────────────
  { id: "pay:x402",            label: "x402 payments",       desc: "Charge and settle x402 invoices.",                        group: "payments" },
  { id: "agent:delegate",      label: "Agent delegation",    desc: "Scoped session keys (ERC-8004 / EIP-7702 preview).",      group: "payments" },
];

/** Defaults for the "Default" preset chip. */
export const DEFAULT_SCOPE_IDS: ApiScope[] = [
  "read:portfolio",
  "read:treasury",
  "read:market",
];

/** All scope IDs in catalog order. */
export const ALL_SCOPE_IDS: ApiScope[] = SCOPE_CATALOG.map((s) => s.id);

/** Read-only preset — every `read:*` scope. */
export const READ_ONLY_SCOPE_IDS: ApiScope[] = SCOPE_CATALOG
  .filter((s) => s.id.startsWith("read:"))
  .map((s) => s.id);

/** Write preset — every `write:*` scope (no read, no publish, no pay). */
export const WRITE_SCOPE_IDS: ApiScope[] = SCOPE_CATALOG
  .filter((s) => s.id.startsWith("write:"))
  .map((s) => s.id);

// ── Sanity: every server scope must appear in the catalog ──────────────
{
  const catalogIds = new Set<string>(ALL_SCOPE_IDS);
  const missing = SERVER_ALL_SCOPES.filter((s) => !catalogIds.has(s));
  if (missing.length > 0 && typeof window === "undefined") {
    // Build-time / SSR warning so drift surfaces in logs.
    // eslint-disable-next-line no-console
    console.warn("[scope-catalog] missing UI metadata for server scopes:", missing);
  }
}
