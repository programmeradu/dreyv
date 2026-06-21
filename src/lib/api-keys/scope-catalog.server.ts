// Server-only drift check between SCOPE_CATALOG (UI) and ALL_SCOPES (server).
import "server-only";
import { ALL_SCOPES } from "@/lib/api-keys/public-keys";
import { ALL_SCOPE_IDS } from "@/lib/api-keys/scope-catalog";

const catalogIds = new Set<string>(ALL_SCOPE_IDS);
const missing = ALL_SCOPES.filter((s) => !catalogIds.has(s));
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.warn("[scope-catalog] missing UI metadata for server scopes:", missing);
}

export const SCOPE_CATALOG_DRIFT = missing;
