"use client";

/**
 * Founding 200 note. Reads the live claimed count from /api/founding/status
 * and hides itself when the offer is closed or the count is unavailable.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

interface Status {
  claimed: number;
  remaining: number;
  cap: number;
  open: boolean;
}

export function FoundingNote() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/founding/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setS(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!s || !s.open) return null;
  const pct = Math.min(100, Math.round((s.claimed / s.cap) * 100));

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        padding: "20px 0",
        borderTop: "1px solid var(--mk-rule)",
        borderBottom: "1px solid var(--mk-rule)",
        marginBottom: 40,
      }}
    >
      <p className="mk-body" style={{ color: "var(--mk-ink)" }}>
        <strong>Founding 200.</strong> The first 200 signups get Mini-tier access free while we onboard design
        partners.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div className="mk-meter" style={{ flex: "1 1 200px" }} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="mk-small mk-tnum">
          {s.claimed} of {s.cap} claimed
        </span>
        <Link href="/auth" className="mk-btn mk-btn-solid mk-btn-sm">
          Claim free Mini
        </Link>
      </div>
    </div>
  );
}
