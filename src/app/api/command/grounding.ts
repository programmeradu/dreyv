/**
 * Grounding & evidence helpers extracted from route.ts.
 *
 * Next.js App Router rejects any non-HTTP-verb export from a route file
 * (e.g. `classifyEvidenceNeed`), so these helpers live in a sibling module
 * that the route — and the test suite — both import from.
 */

export type EvidenceClass =
  | "conversational"
  | "tool_required"
  | "db_required"
  | "navigation_required";

export type GroundingGateResult = { allowed: boolean; blockedReason?: string };

const NAVIGATION_ROUTE_ALLOWLIST = new Set([
  "/app",
  "/app/treasury",
  "/app/analytics",
  "/app/studio",
  "/app/marketplace",
  "/app/library",
  "/app/team",
  "/app/settings",
  "/app/atlas",
]);

export function isSimpleConversation(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.length > 80) return false;
  return /^(hi|hello|hey|yo|sup|gm|gn|good\s+morning|good\s+afternoon|good\s+evening|thanks|thank\s+you|ok|okay|cool|nice)\b[!.?\s]*$/.test(t);
}

export function isWalletProviderSupportQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const mentionsWalletProvider = /\b(phantom|wallet|account|dapp|transaction fee|fees?|sol)\b/.test(t);
  const mentionsSupportSymptom =
    /\b(malicious|blocked?|block transactions?|warning|unsafe|safe|flagged|scam|can't transfer|cannot transfer|cant transfer|insufficient|no transaction fees?|do not have.*fees?|don't have.*fees?|fee shortage|mark.*safe)\b/.test(t);
  return mentionsWalletProvider && mentionsSupportSymptom;
}

// Action verbs that genuinely require tools (treasury / on-chain / app actions).
const ACTION_INTENT_RE =
  /\b(transfer|send|swap|bridge|deposit|withdraw|stake|unstake|buy|sell|borrow|lend|provide liquidity|claim|harvest|mint|burn|pay|payroll|invoice|approve|sign|execute|rebalance|allocate|move funds?|set (a )?(monitor|alert)|alert me|notify me|watch|monitor|navigate|open|go to|redirect|create (a )?(vault|monitor|alert|directive|payment))\b/;

// Question / informational shape — wh-words, "can/could/should/is/are/do/does", or a trailing "?".
const QUESTION_SHAPE_RE =
  /^(what|why|how|when|where|who|which|can|could|should|would|is|are|am|do|does|did|will|tell me|explain|help|why\s|how\s)/;

export function isInformationalQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (ACTION_INTENT_RE.test(t)) return false;
  if (t.endsWith("?")) return true;
  if (QUESTION_SHAPE_RE.test(t)) return true;
  return false;
}

export function classifyEvidenceNeed(userText: string): EvidenceClass {
  const t = userText.trim().toLowerCase();
  if (!t || isSimpleConversation(t)) return "conversational";
  if (isWalletProviderSupportQuestion(t)) return "conversational";
  if (/\b(navigate|open|go to|redirect)\b/.test(t)) return "navigation_required";
  if (/\b(database|\bdb\b|saved|stored|appid|project id)\b/.test(t)) return "db_required";
  if (isInformationalQuestion(t)) return "conversational";
  return "tool_required";
}

export function validateNavigationPath(path: string):
  | { success: true; pathname: string; query: Record<string, string> }
  | { success: false; code: "INVALID_ROUTE"; reason: string } {
  if (!path || typeof path !== "string") {
    return { success: false, code: "INVALID_ROUTE", reason: "Path must be a non-empty string." };
  }
  const raw = path.trim();
  if (!raw.startsWith("/")) {
    return { success: false, code: "INVALID_ROUTE", reason: "Path must be a relative path." };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://keystone.local");
  } catch {
    return { success: false, code: "INVALID_ROUTE", reason: "Path is not a valid route." };
  }
  const pathname =
    parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
  if (!NAVIGATION_ROUTE_ALLOWLIST.has(pathname)) {
    return { success: false, code: "INVALID_ROUTE", reason: `Route not allowed: ${pathname}` };
  }
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  if (pathname !== "/app/studio" && Object.keys(query).length > 0) {
    return { success: false, code: "INVALID_ROUTE", reason: "Query params only allowed on /app/studio." };
  }
  if (pathname === "/app/studio") {
    const keys = Object.keys(query);
    if (keys.some((k) => k !== "appId")) {
      return { success: false, code: "INVALID_ROUTE", reason: "Only appId query is allowed on /app/studio." };
    }
    if ("appId" in query && !query.appId.trim()) {
      return { success: false, code: "INVALID_ROUTE", reason: "appId cannot be empty." };
    }
  }
  return { success: true, pathname, query };
}

function estimateMessageChars(messages: any[]): number {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}

export function buildBudgetedMessagesWithCap(
  formattedMessages: any[],
  maxChars: number,
): { messages: any[]; reduced: boolean } {
  if (!Array.isArray(formattedMessages)) return { messages: [], reduced: true };
  if (estimateMessageChars(formattedMessages) <= maxChars) {
    return { messages: formattedMessages, reduced: false };
  }
  const summary = {
    role: "system",
    content:
      "Conversation history condensed to fit model context limits. Prioritize latest user intent and recent verified tool outputs.",
  };
  const reduced = [summary, ...formattedMessages.slice(-10)];
  return { messages: reduced, reduced: true };
}

export function buildBudgetedMessages(formattedMessages: any[]): { messages: any[]; reduced: boolean } {
  const MAX_CHARS = 32000;
  return buildBudgetedMessagesWithCap(formattedMessages, MAX_CHARS);
}

export function evaluateGroundingGate(
  evidenceClass: EvidenceClass,
  observed: { lookupSuccess: boolean; navigationSuccess: boolean },
): GroundingGateResult {
  if (evidenceClass === "db_required" && !observed.lookupSuccess) {
    return { allowed: false, blockedReason: "DB-backed lookup evidence missing." };
  }
  if (evidenceClass === "navigation_required" && !observed.navigationSuccess) {
    return { allowed: false, blockedReason: "Validated navigation evidence missing." };
  }
  return { allowed: true };
}
