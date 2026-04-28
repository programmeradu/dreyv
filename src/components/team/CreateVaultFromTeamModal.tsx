"use client";

import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnection, useWallet } from "@/lib/wallet/compat";
import { SquadsClient } from "@/lib/squads";
import { PublicKey } from "@solana/web3.js";
import { useTeam } from "@/lib/hooks/useTeam";
import { useVault } from "@/lib/contexts/VaultContext";
import { Loader2, Shield, Check, AlertCircle, Users, Sparkles } from "lucide-react";
import { AppEventBus } from "@/lib/events";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teamId: string;
  teamName: string;
};

type Step = "review" | "configure" | "deploy" | "done";

interface SignerRow {
  walletAddress: string;
  displayName: string | null;
  role: string;
  include: boolean;
}

/**
 * "Create vault from team" wizard.
 * 1. Review team members → choose Squads signers.
 * 2. Configure threshold + optional time-lock.
 * 3. Deploy multisigCreateV2 on-chain, persist vault PDA on team + registry.
 */
export function CreateVaultFromTeamModal({ open, onOpenChange, teamId, teamName }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { activeTeam, refresh } = useTeam();
  const { addVault, setActiveVault } = useVault();

  const [step, setStep] = useState<Step>("review");
  const [signers, setSigners] = useState<SignerRow[]>([]);
  const [threshold, setThreshold] = useState<number>(2);
  const [timeLock, setTimeLock] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ vaultPda: string; multisigPda: string; signature: string } | null>(null);

  // Load members on open
  React.useEffect(() => {
    if (!open || !teamId) return;
    setStep("review");
    setError(null);
    setResult(null);
    (async () => {
      try {
        const res = await fetch(`/api/team/${teamId}/members`);
        if (!res.ok) throw new Error("Failed to load members");
        const data = await res.json();
        const members = (data.members || []).filter((m: any) => m.status === "active" && m.walletAddress);
        const rows: SignerRow[] = members.map((m: any) => ({
          walletAddress: m.walletAddress,
          displayName: m.displayName,
          role: m.role,
          include: ["owner", "admin", "signer"].includes(m.role),
        }));
        setSigners(rows);
        const includedCount = rows.filter((r) => r.include).length;
        setThreshold(Math.max(1, Math.min(includedCount, Math.ceil(includedCount / 2) + 0)));
      } catch (e: any) {
        setError(e?.message || "Failed to load team members");
      }
    })();
  }, [open, teamId]);

  const includedSigners = useMemo(() => signers.filter((s) => s.include), [signers]);

  const toggleSigner = (addr: string) =>
    setSigners((prev) => prev.map((s) => (s.walletAddress === addr ? { ...s, include: !s.include } : s)));

  const canDeploy =
    includedSigners.length >= 2 &&
    threshold >= 1 &&
    threshold <= includedSigners.length &&
    !!wallet?.publicKey;

  const handleDeploy = async () => {
    if (!wallet?.publicKey) {
      setError("Connect a wallet first");
      return;
    }
    setBusy(true);
    setError(null);
    setStep("deploy");
    try {
      const client = new SquadsClient(connection, wallet);
      // Permissions: full mask = 7 (Initiate | Vote | Execute) for v4
      const members = includedSigners.map((s) => ({
        key: new PublicKey(s.walletAddress),
        permissions: { mask: 7 },
      }));

      const { signature, multisigPda, vaultPda } = await client.createMultisig({
        members,
        threshold,
        timeLock,
      });

      // Persist on backend: attach to team + register in vault registry
      await Promise.all([
        fetch(`/api/team/${teamId}/vault`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vaultAddress: multisigPda }),
        }),
        addVault({
          address: multisigPda,
          label: `${teamName} Vault`,
          kind: "multisig",
        }),
      ]);

      setResult({ vaultPda, multisigPda, signature });
      setStep("done");
      AppEventBus.emit("UI_NOTIFICATION", {
        message: `✨ Squads vault deployed for ${teamName}`,
      });
      try {
        setActiveVault(multisigPda);
      } catch {}
      refresh?.();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Deployment failed");
      setStep("configure");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-violet-100 bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <Shield className="h-5 w-5 text-violet-600" />
            Create vault for {teamName}
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {(["review", "configure", "deploy", "done"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <span className={step === s ? "text-violet-600" : ""}>{i + 1}. {s}</span>
              {i < 3 && <span className="text-slate-300">›</span>}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Users className="h-4 w-4 text-violet-500" />
              Pick who can sign on-chain. Defaults: owners, admins, signers.
            </div>
            <div className="max-h-[260px] space-y-1 overflow-y-auto rounded-xl border border-violet-100 bg-violet-50/30 p-2">
              {signers.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">No active team members yet. Invite members first.</p>
              ) : (
                signers.map((s) => (
                  <label key={s.walletAddress} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={s.include}
                      onChange={() => toggleSigner(s.walletAddress)}
                      className="h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {s.displayName || s.walletAddress.slice(0, 4) + "…" + s.walletAddress.slice(-4)}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">{s.walletAddress}</p>
                    </div>
                    <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                      {s.role}
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => setStep("configure")}
                disabled={includedSigners.length < 2}
                className="bg-violet-600 text-white hover:bg-violet-700"
              >
                Continue ({includedSigners.length} signers)
              </Button>
            </div>
          </div>
        )}

        {step === "configure" && (
          <div className="space-y-5">
            <div>
              <Label className="text-sm text-slate-700">Approval threshold</Label>
              <p className="mt-1 text-xs text-slate-500">
                How many signers must approve before a transaction can execute.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={includedSigners.length}
                  value={threshold}
                  onChange={(e) => setThreshold(Math.max(1, Math.min(includedSigners.length, parseInt(e.target.value) || 1)))}
                  className="w-24 border-violet-200"
                />
                <span className="text-sm text-slate-600">
                  of <span className="font-semibold text-violet-700">{includedSigners.length}</span> signers
                </span>
              </div>
            </div>

            <div>
              <Label className="text-sm text-slate-700">Time lock (slots)</Label>
              <p className="mt-1 text-xs text-slate-500">
                Optional cooldown between approval and execution. 0 = instant.
              </p>
              <Input
                type="number"
                min={0}
                value={timeLock}
                onChange={(e) => setTimeLock(Math.max(0, parseInt(e.target.value) || 0))}
                className="mt-2 w-32 border-violet-200"
              />
            </div>

            <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-violet-700">
                <Sparkles className="h-4 w-4" /> Deployment summary
              </p>
              <ul className="mt-2 space-y-1 text-slate-700">
                <li>• {includedSigners.length} signers, {threshold}-of-{includedSigners.length} threshold</li>
                <li>• Time lock: {timeLock} slot{timeLock === 1 ? "" : "s"}</li>
                <li>• You ({wallet?.publicKey?.toBase58().slice(0, 4)}…) will fund + sign creation</li>
                <li>• ~0.01 SOL rent + network fees</li>
              </ul>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("review")}>Back</Button>
              <Button
                onClick={handleDeploy}
                disabled={!canDeploy || busy}
                className="bg-violet-600 text-white hover:bg-violet-700"
              >
                Deploy on Solana
              </Button>
            </div>
          </div>
        )}

        {step === "deploy" && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
            <p className="text-sm font-medium text-slate-900">Deploying multisig…</p>
            <p className="text-xs text-slate-500">Approve the transaction in your wallet.</p>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="rounded-full bg-violet-100 p-3">
                <Check className="h-6 w-6 text-violet-700" />
              </div>
              <p className="text-base font-semibold text-slate-900">Vault is live</p>
              <p className="text-sm text-slate-500">{teamName} can now co-sign on-chain.</p>
            </div>
            <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/40 p-4 text-xs">
              <div>
                <p className="font-semibold text-slate-700">Multisig PDA</p>
                <p className="font-mono break-all text-slate-600">{result.multisigPda}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">Default Vault PDA</p>
                <p className="font-mono break-all text-slate-600">{result.vaultPda}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">Signature</p>
                <a
                  className="font-mono break-all text-violet-700 hover:underline"
                  href={`https://solscan.io/tx/${result.signature}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.signature}
                </a>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)} className="bg-violet-600 text-white hover:bg-violet-700">
                Open War Room
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
