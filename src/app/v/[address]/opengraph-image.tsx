/**
 * /v/[address]/opengraph-image — dynamic share card.
 *
 * Fetches the feature pack server-side and renders a violet
 * Stitch-aligned OG card with archetype, address, net worth, and a
 * single-sentence preview of the AI narrative when available.
 */
import { ImageResponse } from "next/og";
import { getSiteOrigin } from "@/lib/seo/site";

export const alt = "Dreyv smart wallet explorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fmtUsd = (n: number) =>
    Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
    : Math.abs(n) >= 1_000 ? `$${(n / 1_000).toFixed(1)}k`
    : `$${(n || 0).toFixed(2)}`;

async function safeJson<T>(url: string): Promise<T | null> {
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        return (await r.json()) as T;
    } catch {
        return null;
    }
}

export default async function OG({ params }: { params: { address: string } }) {
    const base = getSiteOrigin();
    const { address } = params;
    const trunc = `${address.slice(0, 4)}…${address.slice(-4)}`;

    const pack = await safeJson<{ totalUsd: number; archetype: string; ageDays: number | null; isMultisig: boolean }>(`${base}/api/public/feature-pack/${address}`);
    const narrative = await safeJson<{ narrative?: string }>(`${base}/api/public/narrative/${address}`);
    const firstSentence = (narrative?.narrative || "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 180);

    return new ImageResponse(
        (
            <div style={{
                width: "100%", height: "100%",
                display: "flex", flexDirection: "column",
                background: "white",
                fontFamily: "system-ui, sans-serif",
                padding: 64,
                position: "relative",
            }}>
                {/* Ambient glows */}
                <div style={{ position: "absolute", top: -160, left: 200, width: 720, height: 420, background: "rgba(124, 58, 237, 0.18)", filter: "blur(120px)", borderRadius: 9999 }} />
                <div style={{ position: "absolute", bottom: -120, right: -80, width: 480, height: 320, background: "rgba(167, 139, 250, 0.22)", filter: "blur(100px)", borderRadius: 9999 }} />

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 2 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 5, color: "#7c3aed", textTransform: "uppercase" }}>Dreyv</div>
                    <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 3, color: "#7c3aed", textTransform: "uppercase", border: "1px solid #c4b5fd", borderRadius: 999, padding: "8px 18px" }}>
                        Smart wallet explorer
                    </div>
                </div>

                {/* Body */}
                <div style={{ display: "flex", flexDirection: "column", marginTop: 70, zIndex: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                        <div style={{ background: "#7c3aed", color: "white", borderRadius: 999, padding: "8px 16px", fontSize: 16, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
                            {pack?.archetype?.replace(/_/g, " ") || "Wallet"}
                        </div>
                        {pack?.isMultisig && (
                            <div style={{ border: "1px solid #c4b5fd", borderRadius: 999, padding: "8px 16px", fontSize: 14, fontWeight: 700, color: "#5b21b6", letterSpacing: 1, textTransform: "uppercase" }}>
                                Multisig
                            </div>
                        )}
                        {pack?.ageDays != null && (
                            <div style={{ fontSize: 16, color: "#64748b" }}>{pack.ageDays}d old</div>
                        )}
                    </div>
                    <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, color: "#0f172a", letterSpacing: -2 }}>
                        {trunc}
                    </div>
                    <div style={{ fontSize: 56, fontWeight: 700, marginTop: 18, color: "#7c3aed" }}>
                        {fmtUsd(pack?.totalUsd ?? 0)}
                    </div>
                    {firstSentence && (
                        <div style={{ marginTop: 28, fontSize: 24, color: "#334155", lineHeight: 1.4, maxWidth: 980 }}>
                            {firstSentence}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 2, color: "#64748b", fontSize: 18 }}>
                    <div>dreyv.com/v/{trunc}</div>
                    <div>AI-narrated · No signature needed</div>
                </div>
            </div>
        ),
        size,
    );
}
