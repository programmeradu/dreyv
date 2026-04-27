"use client";

/**
 * TemplateLogo — premium logo tile for template cards & previews.
 *
 * Resolves a real brand asset from `/public/logos/` based on the
 * template's primary provider. Falls back to a designed monogram tile
 * (gradient + initial) when no logo exists.  Never renders emoji.
 */
import Image from "next/image";
import { useState } from "react";

interface TemplateLogoProps {
    templateId: string;
    providerId?: string;
    name: string;
    size?: number;
    className?: string;
    rounded?: "md" | "lg" | "xl";
}

/**
 * Map a template id (or its primary provider) to a real logo file in
 * `public/logos/`. Add new files there, then map them here.
 */
const TEMPLATE_LOGO_MAP: Record<string, string> = {
    // by template id (more specific wins)
    "defi-dashboard": "/logos/jup.png",
    "token-swap": "/logos/jup.png",
    "vault-manager": "/logos/squads.png",
    "data-fetcher": "/logos/helius.png",
    "mcp-agent": "/logos/solana.png",
    "helius-wallet-inspector": "/logos/helius.png",
    "jupiter-swap-quote": "/logos/jup.png",
    "birdeye-token-dashboard": "/logos/birdeye.png",
    "marinade-staking-monitor": "/logos/marinade.png",
};

const PROVIDER_LOGO_MAP: Record<string, string> = {
    helius: "/logos/helius.png",
    jupiter: "/logos/jup.png",
    birdeye: "/logos/birdeye.png",
    marinade: "/logos/marinade.png",
    solana: "/logos/solana.png",
    squads: "/logos/squads.png",
    phantom: "/logos/phantom.png",
    
    jito: "/logos/jito.png",
    kamino: "/logos/kamino.png",
    discord: "/logos/discord.png",
    dune: "/logos/dune.png",
    liveblocks: "/logos/liveblocks.png",
};

/** Deterministic violet/indigo gradient based on the name. */
function gradientFor(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const palettes = [
        ["#7c3aed", "#a78bfa"], // violet
        ["#6366f1", "#818cf8"], // indigo
        ["#0ea5e9", "#38bdf8"], // sky
        ["#10b981", "#34d399"], // emerald
        ["#f59e0b", "#fbbf24"], // amber
        ["#ec4899", "#f472b6"], // pink
        ["#06b6d4", "#22d3ee"], // cyan
        ["#8b5cf6", "#c4b5fd"], // light violet
    ];
    return palettes[h % palettes.length];
}

export function TemplateLogo({
    templateId,
    providerId,
    name,
    size = 40,
    className = "",
    rounded = "lg",
}: TemplateLogoProps) {
    const src =
        TEMPLATE_LOGO_MAP[templateId] ??
        (providerId ? PROVIDER_LOGO_MAP[providerId] : undefined);

    const [errored, setErrored] = useState(false);
    const radius = rounded === "md" ? "rounded-md" : rounded === "xl" ? "rounded-xl" : "rounded-lg";

    if (src && !errored) {
        return (
            <div
                className={`${radius} bg-white ring-1 ring-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
                style={{ width: size, height: size }}
            >
                <Image
                    src={src}
                    alt={name}
                    width={Math.round(size * 0.7)}
                    height={Math.round(size * 0.7)}
                    className="object-contain"
                    onError={() => setErrored(true)}
                    unoptimized
                />
            </div>
        );
    }

    // Designed fallback — gradient tile with abstract geometric artwork
    // (no letter monogram). Pattern is deterministic per name so each
    // template gets a unique, repeatable placeholder image.
    const [from, to] = gradientFor(name);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const variant = h % 4;
    const id = `tlph-${h.toString(36)}`;

    return (
        <div
            className={`${radius} flex items-center justify-center flex-shrink-0 overflow-hidden shadow-[0_4px_12px_-4px_rgba(15,23,42,0.25)] ${className}`}
            style={{ width: size, height: size }}
            aria-label={name}
            role="img"
        >
            <svg
                viewBox="0 0 64 64"
                width={size}
                height={size}
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={from} />
                        <stop offset="100%" stopColor={to} />
                    </linearGradient>
                    <linearGradient id={`${id}-fg`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.55" />
                    </linearGradient>
                </defs>
                <rect width="64" height="64" fill={`url(#${id}-bg)`} />
                {/* soft highlight */}
                <circle cx="14" cy="12" r="22" fill="#ffffff" fillOpacity="0.12" />

                {variant === 0 && (
                    <g fill={`url(#${id}-fg)`}>
                        {/* stacked bars */}
                        <rect x="14" y="36" width="6" height="14" rx="1.5" />
                        <rect x="24" y="28" width="6" height="22" rx="1.5" />
                        <rect x="34" y="20" width="6" height="30" rx="1.5" />
                        <rect x="44" y="32" width="6" height="18" rx="1.5" />
                    </g>
                )}
                {variant === 1 && (
                    <g fill="none" stroke={`url(#${id}-fg)`} strokeWidth="2.5" strokeLinecap="round">
                        {/* orbit / network */}
                        <circle cx="32" cy="32" r="14" />
                        <circle cx="32" cy="32" r="3.5" fill={`url(#${id}-fg)`} stroke="none" />
                        <circle cx="46" cy="32" r="2.5" fill={`url(#${id}-fg)`} stroke="none" />
                        <circle cx="18" cy="32" r="2.5" fill={`url(#${id}-fg)`} stroke="none" />
                        <circle cx="32" cy="18" r="2.5" fill={`url(#${id}-fg)`} stroke="none" />
                    </g>
                )}
                {variant === 2 && (
                    <g fill={`url(#${id}-fg)`}>
                        {/* hex grid */}
                        <polygon points="32,14 44,21 44,35 32,42 20,35 20,21" opacity="0.95" />
                        <polygon points="32,22 38,25.5 38,32.5 32,36 26,32.5 26,25.5" fill={from} />
                    </g>
                )}
                {variant === 3 && (
                    <g fill="none" stroke={`url(#${id}-fg)`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* sparkline */}
                        <polyline points="14,40 22,30 30,34 38,22 50,26" />
                        <circle cx="50" cy="26" r="2.5" fill={`url(#${id}-fg)`} stroke="none" />
                    </g>
                )}
            </svg>
        </div>
    );
}
