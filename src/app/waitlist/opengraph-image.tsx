import { OG_SIZE, OG_CONTENT_TYPE, renderOgCard, resolveCrystalUrl } from "../_og/template";

export const alt = "Join the dreyv design-partner waitlist";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    eyebrow: "Waitlist · invite only",
    headline: "Run your treasury with the design-partner cohort.",
    subline:
      "Qualified Solana teams get early access, hands-on onboarding and direct line to the team building dreyv.",
    chips: ["Solana-native", "Design-partner cohort", "Hands-on onboarding"],
    crystalUrl: resolveCrystalUrl(),
  });
}
