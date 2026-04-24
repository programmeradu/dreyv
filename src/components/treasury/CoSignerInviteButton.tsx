"use client";

import { useState } from "react";
import { UserPlus, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast-notifications";

/**
 * Generate a single-use invite link for a co-signer to join an existing
 * Squads vault on Dreyv. Surface this in the vault settings / team panel.
 */
export function CoSignerInviteButton({ vaultAddress }: { vaultAddress: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<"signer" | "admin" | "viewer">("signer");

  if (!vaultAddress) return null;

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(vaultAddress)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, expiresInHours: 72 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Could not create invite", { description: data.error || `HTTP ${res.status}` });
        return;
      }
      setUrl(data.url);
    } catch (e: any) {
      toast.error("Network error", { description: e?.message || "Try again." });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) setUrl(""); }}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
      >
        <UserPlus size={14} />
        Invite co-signer
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 p-4 rounded-xl bg-background border border-border shadow-lg z-50">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Role on this vault</p>
          <div className="grid grid-cols-3 gap-1 mb-3">
            {(["signer", "admin", "viewer"] as const).map(r => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`h-8 rounded-md text-[11px] font-medium border transition-colors capitalize ${
                  role === r
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {!url ? (
            <button
              onClick={generate}
              disabled={loading}
              className="w-full h-9 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? "Generating…" : "Generate invite link"}
            </button>
          ) : (
            <>
              <div className="rounded-lg bg-muted px-3 py-2 text-[11px] font-mono break-all text-foreground mb-2 max-h-24 overflow-y-auto">
                {url}
              </div>
              <button
                onClick={copy}
                className="w-full h-9 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 inline-flex items-center justify-center gap-2"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <p className="text-[10px] text-muted-foreground mt-2">
                Single-use, expires in 72h. Share over a trusted channel.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
