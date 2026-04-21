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
    turnkey: "/logos/turnkey.png",
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

    // Designed fallback — gradient tile + monogram
    const [from, to] = gradientFor(name);
    const initial = (name.replace(/[^A-Za-z0-9]/g, "")[0] || "D").toUpperCase();

    return (
        <div
            className={`${radius} flex items-center justify-center flex-shrink-0 text-white font-bold shadow-[0_4px_12px_-4px_rgba(15,23,42,0.25)] ${className}`}
            style={{
                width: size,
                height: size,
                background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
                fontSize: Math.round(size * 0.42),
                fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif",
                letterSpacing: "-0.02em",
            }}
            aria-label={name}
        >
            {initial}
        </div>
    );
}
