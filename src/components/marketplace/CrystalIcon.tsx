"use client";

/**
 * CrystalIcon — bespoke 3D violet crystal mark.
 *
 * Replaces generic Lucide iconography on Marketplace, Library, and Studio chrome
 * surfaces. Visually consistent with the pricing-tier crystal language.
 *
 * Usage:
 *   <CrystalIcon name="trending" size={14} />
 */

import Image from "next/image";
import { type CSSProperties } from "react";

import all from "@/assets/marketplace/crystal-all.png";
import defi from "@/assets/marketplace/crystal-defi.png";
import nft from "@/assets/marketplace/crystal-nft.png";
import governance from "@/assets/marketplace/crystal-governance.png";
import analytics from "@/assets/marketplace/crystal-analytics.png";
import utility from "@/assets/marketplace/crystal-utility.png";
import trading from "@/assets/marketplace/crystal-trading.png";
import security from "@/assets/marketplace/crystal-security.png";
import social from "@/assets/marketplace/crystal-social.png";
import trending from "@/assets/marketplace/crystal-trending.png";
import fresh from "@/assets/marketplace/crystal-new.png";
import featured from "@/assets/marketplace/crystal-featured.png";
import free from "@/assets/marketplace/crystal-free.png";
import installed from "@/assets/marketplace/crystal-installed.png";
import publish from "@/assets/marketplace/crystal-publish.png";

const MAP = {
    all,
    defi,
    nft,
    governance,
    analytics,
    utility,
    trading,
    security,
    social,
    trending,
    new: fresh,
    featured,
    free,
    installed,
    publish,
} as const;

export type CrystalName = keyof typeof MAP;

interface CrystalIconProps {
    name: CrystalName;
    size?: number;
    className?: string;
    style?: CSSProperties;
    alt?: string;
}

export function CrystalIcon({ name, size = 16, className, style, alt = "" }: CrystalIconProps) {
    const src = MAP[name];
    return (
        <Image
            src={src}
            alt={alt}
            width={size}
            height={size}
            loading="lazy"
            className={className}
            style={{
                width: size,
                height: size,
                objectFit: "contain",
                display: "inline-block",
                flexShrink: 0,
                ...style,
            }}
        />
    );
}

/** Map a marketplace category label to a crystal name. */
export function categoryToCrystal(category: string): CrystalName {
    const k = category.toLowerCase();
    if (k === "all") return "all";
    if (k === "defi") return "defi";
    if (k === "nft") return "nft";
    if (k === "governance") return "governance";
    if (k === "analytics") return "analytics";
    if (k === "utility") return "utility";
    if (k === "trading") return "trading";
    if (k === "security") return "security";
    if (k === "social") return "social";
    return "all";
}
