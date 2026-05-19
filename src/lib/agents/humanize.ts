/**
 * Convert a snake_case / kebab-case capability or operation id into a
 * human-friendly label. Examples:
 *   "onramp_fiat_to_crypto" -> "Onramp fiat to crypto"
 *   "create_multisig"       -> "Create multisig"
 *   "foresight_simulation"  -> "Foresight simulation"
 */
export function humanizeOperation(input?: string | null): string {
  if (!input) return "";
  const cleaned = input.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
