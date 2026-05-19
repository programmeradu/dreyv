/**
 * Featured public case studies for /case.
 *
 * These are addresses of well-known, publicly attributed Solana treasuries
 * that we run counterfactual analysis against. Every featured entry must:
 *   - Have a publicly verified label (DAO realm, foundation, named whale)
 *   - Be confirmed against Helius before being added here
 *   - Be safe to discuss publicly (no private clients)
 *
 * Add new entries via /studio/case-studies → "Publish to /case".
 */

export interface FeaturedCase {
  address: string;
  label: string;
  blurb: string;
  /** What kind of treasury — shown as a small chip */
  kind: "DAO" | "Foundation" | "Protocol" | "Whale" | "Validator";
}

export const FEATURED_CASES: FeaturedCase[] = [
  {
    address: "899YG3yk4F66ZgbNWLHriZHTXSKk9e1kvsKEquW7L6Mo",
    label: "Marinade DAO Realm",
    blurb: "The governance treasury behind Solana's largest liquid staking protocol.",
    kind: "DAO",
  },
];

export function findFeatured(address: string): FeaturedCase | undefined {
  return FEATURED_CASES.find((c) => c.address === address);
}
