import { OG_SIZE, OG_CONTENT_TYPE, renderOgCard, resolveCrystalUrl } from "../_og/template";

export const alt = "dreyv for developers — APIs, SDKs and the Treasury MCP server";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({
    eyebrow: "For developers",
    headline: "Build on the treasury command layer.",
    subline:
      "Open OpenAPI, typed SDK, MCP server and a sandbox. Ship intent-driven agents on top of dreyv.",
    chips: ["OpenAPI", "TypeScript SDK", "MCP server"],
    crystalUrl: resolveCrystalUrl(),
  });
}
