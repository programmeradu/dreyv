import { OG_SIZE, OG_CONTENT_TYPE, renderOgCard, resolveCrystalUrl } from "../_og/template";

export const runtime = "edge";
export const alt = "dreyv pricing — Free, Mini $49/mo, Max $199/mo";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    eyebrow: "Pricing",
    headline: "Free to start. $49 to scale. $199 to operate.",
    subline:
      "Free tier for solo treasuries. Mini for active teams. Max for funds running multisig at scale.",
    chips: ["Free $0", "Mini $49/mo", "Max $199/mo"],
    crystalUrl: resolveCrystalUrl(),
  });
}
