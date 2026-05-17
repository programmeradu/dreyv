/**
 * Address shape detection + handle parsing for the smart explorer.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[a-fA-F0-9]{40}$/;

export type AddressKind = "solana" | "evm" | "handle-sol" | "handle-eth" | "invalid";

export function detectAddressKind(input: string): AddressKind {
  const s = (input || "").trim();
  if (!s) return "invalid";
  if (EVM.test(s)) return "evm";
  if (s.endsWith(".sol")) return "handle-sol";
  if (s.endsWith(".eth")) return "handle-eth";
  if (BASE58.test(s)) return "solana";
  return "invalid";
}

export function isHandle(input: string): boolean {
  const k = detectAddressKind(input);
  return k === "handle-sol" || k === "handle-eth";
}
