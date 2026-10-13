/**
 * Waitlist constants — kept in one place so the form, API, admin view,
 * emails, and machine-readable /waitlist.md stay in sync.
 *
 * Per brand rule: NEVER prefill demo figures in any UI. AUM bands are
 * coarse buckets the user explicitly opts into.
 */

export const WAITLIST_ROLES = [
  { value: "treasurer", label: "Treasurer" },
  { value: "operator", label: "Operator" },
  { value: "founder", label: "Founder" },
  { value: "developer", label: "Developer" },
  { value: "other", label: "Other" },
] as const;

export const WAITLIST_ORG_TYPES = [
  { value: "dao", label: "DAO" },
  { value: "fund", label: "Fund" },
  { value: "protocol", label: "Protocol" },
  { value: "startup", label: "Startup" },
  { value: "solo", label: "Solo / individual" },
] as const;

export const WAITLIST_CHAINS = [
  { value: "solana", label: "Solana" },
  { value: "evm", label: "EVM" },
  { value: "both", label: "Both" },
] as const;

/**
 * AUM bands — coarse buckets only. Never populate a default.
 * `not_disclosed` is the explicit opt-out.
 */
export const WAITLIST_AUM_BANDS = [
  { value: "not_disclosed", label: "Prefer not to say" },
  { value: "sub_100k", label: "Under 100k" },
  { value: "100k_1m", label: "100k – 1M" },
  { value: "1m_10m", label: "1M – 10M" },
  { value: "10m_100m", label: "10M – 100M" },
  { value: "100m_plus", label: "100M+" },
] as const;

export const WAITLIST_REFERRAL_SOURCES = [
  { value: "twitter", label: "X / Twitter" },
  { value: "github", label: "GitHub" },
  { value: "podcast", label: "Podcast" },
  { value: "search", label: "Search" },
  { value: "friend", label: "Friend / colleague" },
  { value: "event", label: "Event / conference" },
  { value: "other", label: "Other" },
] as const;

export type WaitlistStatus = "pending" | "invited" | "onboarded" | "rejected";

export const COHORT_WINDOW = "rolling, invites sent weekly";

export const INVITE_EXPIRY_DAYS = 14;
