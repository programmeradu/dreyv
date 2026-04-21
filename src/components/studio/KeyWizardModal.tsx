"use client";

/**
 * KeyWizardModal
 *
 * Step-by-step wizard that collects credentials for one provider and saves
 * them via /api/dreyv-gateway/connections. Pops up automatically when a
 * mini-app calls window.dreyv.<provider>.<op>() and the gateway responds
 * with `connection_required` (HTTP 412).
 *
 * Also reused by /app/studio/connections for manual edits.
 */

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import {
  PremiumModal,
  PremiumModalDescription,
  PremiumModalTitle,
} from "@/components/ui/PremiumModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type DreyvConnection,
  type PublicProvider,
  useDreyvConnections,
} from "@/lib/studio/use-dreyv-connections";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Provider id to connect (e.g. "helius"). */
  providerId: string | null;
  /** Optional: existing connection to edit. */
  existing?: DreyvConnection | null;
  /** Called after a successful save. */
  onSaved?: (providerId: string) => void;
}

export function KeyWizardModal({
  open,
  onClose,
  providerId,
  existing,
  onSaved,
}: Props) {
  const { providers, save, loading } = useDreyvConnections();
  const provider: PublicProvider | null = useMemo(
    () => providers.find((p) => p.id === providerId) ?? null,
    [providers, providerId]
  );

  const allFields = useMemo(
    () =>
      provider
        ? [
            ...provider.secretFields.map((f) => ({ ...f, _kind: "secret" as const })),
            ...provider.publicFields.map((f) => ({ ...f, _kind: "public" as const })),
          ]
        : [],
    [provider]
  );

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when opened / provider changes
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    const seed: Record<string, string> = {};
    if (existing?.publicConfig && typeof existing.publicConfig === "object") {
      for (const [k, v] of Object.entries(existing.publicConfig)) {
        if (typeof v === "string") seed[k] = v;
      }
    }
    setValues(seed);
  }, [open, providerId, existing]);

  if (!open) return null;

  if (loading || !provider) {
    return (
      <PremiumModal isOpen={open} onClose={onClose} className="max-w-md">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      </PremiumModal>
    );
  }

  const safeProvider: PublicProvider = provider;

  if (allFields.length === 0) {
    return (
      <PremiumModal isOpen={open} onClose={onClose} className="max-w-md">
        <PremiumModalTitle>{provider.name} is ready</PremiumModalTitle>
        <PremiumModalDescription>
          {provider.name} is a public API and needs no credentials. Mini-apps
          can call it immediately.
        </PremiumModalDescription>
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </PremiumModal>
    );
  }

  const total = allFields.length;
  const field = allFields[step];
  const isLast = step === total - 1;
  const currentValue = values[field.name] ?? "";
  const canAdvance =
    !field.required || currentValue.trim().length > 0 || field._kind === "public";

  async function handleNext() {
    setError(null);
    if (!canAdvance) {
      setError(`${field.label} is required`);
      return;
    }
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    // Final step → save
    setSubmitting(true);
    try {
      const secrets: Record<string, string> = {};
      const publicConfig: Record<string, unknown> = {};
      for (const f of allFields) {
        const v = values[f.name];
        if (v === undefined || v === "") continue;
        if (f._kind === "secret") secrets[f.name] = v;
        else publicConfig[f.name] = v;
      }
      await save({
        provider: safeProvider.id,
        secrets,
        publicConfig,
      });
      onSaved?.(safeProvider.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PremiumModal isOpen={open} onClose={onClose} className="max-w-lg">
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-lg bg-violet-500/10 p-2 ring-1 ring-violet-500/20">
          <ShieldCheck className="size-5 text-violet-400" />
        </div>
        <div className="flex-1">
          <PremiumModalTitle>Connect {safeProvider.name}</PremiumModalTitle>
          <PremiumModalDescription>{safeProvider.description}</PremiumModalDescription>
        </div>
      </div>

      {/* Progress dots */}
      <div className="mb-6 flex items-center gap-1.5">
        {allFields.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? "bg-violet-500" : "bg-zinc-800"
            }`}
          />
        ))}
        <span className="ml-3 text-xs text-zinc-500">
          {step + 1} / {total}
        </span>
      </div>

      <div className="space-y-3">
        <Label htmlFor={field.name} className="text-sm font-medium text-zinc-200">
          {field.label}
          {field.required && <span className="ml-1 text-rose-400">*</span>}
        </Label>

        <div className="relative">
          <Input
            id={field.name}
            type={
              field.type === "password" && !reveal[field.name]
                ? "password"
                : field.type === "email"
                ? "email"
                : "text"
            }
            placeholder={field.placeholder}
            value={currentValue}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleNext();
            }}
            autoFocus
            className="bg-zinc-950/50 pr-10"
          />
          {field.type === "password" && (
            <button
              type="button"
              onClick={() => setReveal((r) => ({ ...r, [field.name]: !r[field.name] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
              aria-label={reveal[field.name] ? "Hide" : "Show"}
            >
              {reveal[field.name] ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          )}
        </div>

        {field.helpText && (
          <p className="text-xs text-zinc-500">{field.helpText}</p>
        )}

        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
        >
          {provider.name} docs <ExternalLink className="size-3" />
        </a>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
          className="text-sm text-zinc-400 hover:text-zinc-200"
          disabled={submitting}
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
        <Button onClick={handleNext} disabled={submitting || !canAdvance}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving…
            </>
          ) : isLast ? (
            "Save & connect"
          ) : (
            "Next"
          )}
        </Button>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">
        Keys are sealed with AES-256-GCM and stored encrypted in your treasury.
        Dreyv proxies upstream calls — your key never touches the browser.
      </p>
    </PremiumModal>
  );
}
