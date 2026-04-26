/**
 * Shared OG card template — premium light Stitch-style.
 * Brand: solid violet-600 (#7c3aed) only, no gradients on brand colors.
 * Surfaces use white → violet-50 ambient wash + violet-400/300 glows.
 *
 * Used by every `opengraph-image.tsx` route via `renderOgCard()`.
 */
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export type OgCardInput = {
  /** Small uppercase tag at the top — e.g. "Pricing", "Compare", "For developers". */
  eyebrow?: string;
  /** Main headline (keep ≤ 70 chars for legibility). */
  headline: string;
  /** Supporting line under headline (≤ 140 chars). */
  subline?: string;
  /** Bottom proof chips, max 3. */
  chips?: string[];
  /** Absolute URL to the crystal asset (resolved by caller from request origin). */
  crystalUrl?: string;
};

const VIOLET = "#7c3aed";
const VIOLET_50 = "#f5f3ff";
const VIOLET_100 = "#ede9fe";
const VIOLET_200 = "#ddd6fe";
const VIOLET_700 = "#6d28d9";
const INK = "#0b0a14";
const INK_SOFT = "rgba(11,10,20,0.62)";
const INK_FAINT = "rgba(11,10,20,0.42)";

export function renderOgCard(input: OgCardInput): ImageResponse {
  const { eyebrow, headline, subline, chips = [], crystalUrl } = input;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          background: `radial-gradient(1100px 700px at 88% 50%, ${VIOLET_100} 0%, ${VIOLET_50} 38%, #ffffff 72%)`,
          color: INK,
          fontFamily: "Manrope, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow blobs (violet-400/300 — solid color, soft alpha) */}
        <div
          style={{
            position: "absolute",
            top: -160,
            left: -160,
            width: 520,
            height: 520,
            borderRadius: 9999,
            background: VIOLET_200,
            opacity: 0.55,
            filter: "blur(40px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -180,
            left: 220,
            width: 420,
            height: 420,
            borderRadius: 9999,
            background: VIOLET_100,
            opacity: 0.9,
            filter: "blur(30px)",
          }}
        />

        {/* Left: text column */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "76px 56px 76px 84px",
            position: "relative",
            zIndex: 2,
          }}
        >
          {/* Wordmark — typographic lockup (system Manrope, brand-tight) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 36,
            }}
          >
            <div
              style={{
                width: 10,
                height: 38,
                borderRadius: 3,
                background: VIOLET,
              }}
            />
            <span
              style={{
                fontSize: 44,
                fontWeight: 800,
                letterSpacing: "-0.045em",
                color: INK,
                lineHeight: 1,
              }}
            >
              dreyv
            </span>
          </div>

          {eyebrow ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: VIOLET_700,
                marginBottom: 22,
              }}
            >
              {eyebrow}
            </div>
          ) : null}

          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
              color: INK,
              maxWidth: 640,
              display: "flex",
            }}
          >
            {headline}
          </div>

          {subline ? (
            <div
              style={{
                marginTop: 26,
                fontSize: 26,
                fontWeight: 500,
                lineHeight: 1.35,
                color: INK_SOFT,
                maxWidth: 640,
                display: "flex",
              }}
            >
              {subline}
            </div>
          ) : null}

          {chips.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: 12,
                marginTop: 40,
                flexWrap: "wrap",
              }}
            >
              {chips.slice(0, 3).map((c) => (
                <div
                  key={c}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 18px",
                    borderRadius: 9999,
                    border: `1px solid ${VIOLET_200}`,
                    background: "rgba(255,255,255,0.72)",
                    color: VIOLET_700,
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
          ) : null}

          <div
            style={{
              position: "absolute",
              left: 84,
              bottom: 44,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: INK_FAINT,
            }}
          >
            dreyv.stauniverse.tech
          </div>
        </div>

        {/* Right: crystal hero */}
        <div
          style={{
            width: 520,
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          {crystalUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={crystalUrl}
              alt=""
              width={460}
              height={460}
              style={{
                objectFit: "contain",
                filter: "drop-shadow(0 40px 60px rgba(124,58,237,0.35))",
              }}
            />
          ) : (
            <div
              style={{
                width: 320,
                height: 420,
                background: VIOLET,
                opacity: 0.9,
                transform: "rotate(8deg)",
                borderRadius: 24,
                filter: "drop-shadow(0 40px 60px rgba(124,58,237,0.4))",
              }}
            />
          )}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}

/** Resolve absolute URL to /brand/og-crystal.png from the deployment origin. */
export function resolveCrystalUrl(): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://dreyv.stauniverse.tech";
  return `${env.replace(/\/$/, "")}/brand/og-crystal.png`;
}
