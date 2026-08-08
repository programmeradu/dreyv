import { OG_SIZE, OG_CONTENT_TYPE, renderOgCard, resolveCrystalUrl } from "../_og/template";

export const alt = "dreyv vs Squads, Jupiter, Birdeye — capability comparison";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    eyebrow: "Compare",
    headline: "Squads signs. Jupiter swaps. Birdeye shows. dreyv decides.",
    subline:
      "Side-by-side capabilities across the Solana treasury stack — and where the AI command layer changes the workflow.",
    chips: ["Multisig-aware", "Simulation-first", "Atlas intelligence"],
    crystalUrl: resolveCrystalUrl(),
  });
}
