/**
 * Real protocol logo URLs. Sourced from DefiLlama's public icon CDN
 * (https://icons.llama.fi/<slug>.jpg) and project CDNs.
 *
 * Keep this list curated — never invent slugs. If a protocol is missing,
 * leave it out and the consumer should render the geometric sigil fallback
 * inside <TokenAvatar />.
 */

const ICON = (slug: string) => `https://icons.llama.fi/${slug}.jpg`;

export const PROTOCOL_LOGOS: Record<string, string> = {
    jito: ICON("jito"),
    marinade: ICON("marinade-finance"),
    "marinade finance": ICON("marinade-finance"),
    blazestake: ICON("blazestake"),
    jupiter: ICON("jupiter"),
    "jupiter staked sol": ICON("jupiter-staked-sol"),
    sanctum: ICON("sanctum"),
    "sanctum/bonk": ICON("sanctum"),
    drift: ICON("drift"),
    pathfinders: ICON("pathfinders"),
    kamino: ICON("kamino-lend"),
    "kamino lend": ICON("kamino-lend"),
    marginfi: ICON("marginfi"),
    solend: ICON("solend"),
    orca: ICON("orca"),
    raydium: ICON("raydium-amm"),
    meteora: ICON("meteora"),
    lulo: ICON("lulo"),
    "native staking": ICON("solana"),
};

export function getProtocolLogo(protocol: string): string | undefined {
    if (!protocol) return undefined;
    const key = protocol.trim().toLowerCase();
    return PROTOCOL_LOGOS[key];
}
