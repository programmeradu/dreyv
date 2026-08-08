import { OG_SIZE, OG_CONTENT_TYPE, renderOgCard, resolveCrystalUrl } from "./_og/template";

export const alt =
  "dreyv — AI treasury workspace for Solana teams (non-custodial)";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpenGraphImage() {
  return renderOgCard({
    eyebrow: "AI treasury OS · Solana",
    headline: "Treasury intent, simulated and signed.",
    subline:
      "Natural-language commands → simulated plan → human-readable impact. Sign with your multisig. Non-custodial.",
    chips: ["Non-custodial", "Simulation-first", "Multisig-ready"],
    crystalUrl: resolveCrystalUrl(),
  });
}
