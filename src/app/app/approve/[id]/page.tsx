/**
 * /app/approve/[id] — human approval surface for agent action codes.
 *
 * Renders the pending request + a 6-digit code input. POSTs to
 * /api/agents/action-codes/:id/approve. SESSION-auth (middleware already
 * gates /app/**).
 */

"use client";

import { use, useEffect, useState } from "react";

type Status = {
  id: string;
  intent: string;
  description: string;
  amount_minor: string | null;
  currency: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  expires_at: string;
};

export const runtime = "edge";
export default function ApproveActionCodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await fetch(`/api/agents/action-codes/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Could not load request (${res.status}).`);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as Status;
      setData(json);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  async function submit(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/action-codes/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, code: decision === "approve" ? code : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.reason || json?.error || `Request failed (${res.status})`);
      } else {
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-lg p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">Request not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error ?? "This action code does not exist or has expired."}</p>
      </div>
    );
  }

  const settled = data.status !== "pending";

  return (
    <div className="mx-auto max-w-lg p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Approve agent action</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        An agent is requesting your approval before proceeding.
      </p>

      <div className="mt-6 rounded-lg border bg-card p-4 text-sm">
        <dl className="space-y-2">
          <Row label="Intent" value={<code className="rounded bg-muted px-1.5 py-0.5">{data.intent}</code>} />
          <Row label="Description" value={data.description} />
          {data.amount_minor && (
            <Row
              label="Amount"
              value={`${(Number(data.amount_minor) / 1_000_000).toFixed(2)} ${(data.currency || "usdc").toUpperCase()}`}
            />
          )}
          <Row label="Status" value={<span className="font-mono">{data.status}</span>} />
          <Row label="Expires" value={new Date(data.expires_at).toLocaleString()} />
        </dl>
      </div>

      {settled ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This request is already <span className="font-mono">{data.status}</span>. You can close this page.
        </p>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("approve");
          }}
        >
          <label className="block text-sm font-medium">
            Enter the 6-digit code shown to the agent
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              aria-label="6-digit approval code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 font-mono text-lg tracking-[0.4em]"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit("reject")}
              className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
