"use client";

// global-error.tsx replaces the root layout, so it MUST render its own
// <html> and <body>. Avoid next/image, next/link, and shared layout chrome.

import { useEffect } from "react";
import dryvAlert from "@/assets/mascot/dryv-alert.png";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  useEffect(() => {
    console.error("[Dreyv Global Error]", error);
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage(
        {
          type: "global-error-reset",
          error: {
            message: error?.message,
            stack: error?.stack,
            digest: error?.digest,
            name: error?.name,
          },
          timestamp: Date.now(),
          userAgent: navigator.userAgent,
        },
        "*"
      );
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#ffffff",
          color: "#0f172a",
          fontFamily:
            'Manrope, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}
      >
        <div
          style={{
            position: "relative",
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            padding: "1.5rem",
          }}
        >
          {/* Ambient violet wash (inline so it works without Tailwind) */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: "-14%",
              left: "-12%",
              width: 640,
              height: 640,
              borderRadius: "9999px",
              background: "rgba(167, 139, 250, 0.18)",
              filter: "blur(130px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              bottom: "-10%",
              right: "-10%",
              width: 520,
              height: 520,
              borderRadius: "9999px",
              background: "rgba(167, 139, 250, 0.16)",
              filter: "blur(120px)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          <div
            style={{
              position: "relative",
              zIndex: 10,
              width: "100%",
              maxWidth: 560,
              textAlign: "center",
            }}
          >
            {/* Mascot — Dryv on alert */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
              <div style={{ position: "relative", width: 140, height: 140 }}>
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "9999px",
                    background:
                      "radial-gradient(circle, rgba(124,58,237,0.28), transparent 70%)",
                    filter: "blur(20px)",
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={typeof dryvAlert === "string" ? dryvAlert : (dryvAlert as { src: string }).src}
                  alt="Dryv mascot — alert"
                  width={140}
                  height={140}
                  style={{
                    position: "relative",
                    width: 140,
                    height: 140,
                    objectFit: "contain",
                    filter: "drop-shadow(0 18px 30px rgba(124,58,237,0.28))",
                  }}
                />
              </div>
            </div>

            <p
              style={{
                fontSize: 11,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                textTransform: "uppercase",
                letterSpacing: "0.3em",
                color: "rgba(109, 40, 217, 0.9)",
                marginBottom: "1rem",
              }}
            >
              Something interrupted the flow
            </p>
            <h1
              style={{
                fontSize: "clamp(1.875rem, 4vw, 2.5rem)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                color: "#0f172a",
                margin: 0,
              }}
            >
              Let&apos;s try that again.
            </h1>
            <p
              style={{
                marginTop: "1.25rem",
                fontSize: "1rem",
                color: "#475569",
                maxWidth: 440,
                marginLeft: "auto",
                marginRight: "auto",
                lineHeight: 1.6,
              }}
            >
              A page failed to load. Nothing was signed and no funds moved —
              your treasury is safe. Reload to pick up where you left off.
            </p>

            {(error?.message || error?.digest) && (
              <details
                style={{
                  marginTop: "2rem",
                  marginLeft: "auto",
                  marginRight: "auto",
                  maxWidth: 440,
                  textAlign: "left",
                  borderRadius: 12,
                  border: "1px solid rgba(196, 181, 253, 0.5)",
                  background: "rgba(255, 255, 255, 0.8)",
                  overflow: "hidden",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    userSelect: "none",
                    padding: "0.75rem 1rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                    textTransform: "uppercase",
                    letterSpacing: "0.2em",
                    color: "#64748b",
                  }}
                >
                  <span>Diagnostic</span>
                  <span style={{ color: "#8b5cf6" }}>↓</span>
                </summary>
                <div style={{ padding: "0 1rem 1rem 1rem" }}>
                  <code
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                      color: "#334155",
                      wordBreak: "break-word",
                      background: "rgba(245, 243, 255, 0.6)",
                      borderRadius: 8,
                      padding: 12,
                      border: "1px solid #ede9fe",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {error.message || "Unknown runtime error"}
                    {error.digest && (
                      <span
                        style={{
                          display: "block",
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: "1px solid #ede9fe",
                          fontSize: 10,
                          color: "#94a3b8",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                        }}
                      >
                        Digest · {error.digest}
                      </span>
                    )}
                  </code>
                </div>
              </details>
            )}

            <div
              style={{
                marginTop: "2.25rem",
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              <button
                onClick={() => {
                  if (typeof reset === "function") reset();
                  else window.location.reload();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderRadius: 12,
                  background: "#7c3aed",
                  padding: "0.75rem 1.25rem",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 8px 20px -8px rgba(124, 58, 237, 0.5)",
                }}
              >
                Reload page
              </button>
              <a
                href="/"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderRadius: 12,
                  background: "#ffffff",
                  padding: "0.75rem 1.25rem",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#334155",
                  border: "1px solid rgba(196, 181, 253, 0.7)",
                  textDecoration: "none",
                }}
              >
                Back to home
              </a>
            </div>

            <p
              style={{
                marginTop: "2.5rem",
                fontSize: 10,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                textTransform: "uppercase",
                letterSpacing: "0.3em",
                color: "#94a3b8",
              }}
            >
              Non-custodial · Simulation-first · Multisig-native
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
