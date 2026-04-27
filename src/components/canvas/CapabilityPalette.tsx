"use client";

/**
 * CapabilityPalette — ⌘K surface that exposes all 48 capabilities from the
 * registry. Read-only capabilities ('read'/'sim'/'meta') execute inline and
 * land on the canvas as a result block. Write capabilities push a CommandBar
 * prompt so the existing planner+HITL pipeline handles them (no bypass of
 * approval/policy).
 *
 * Why we don't import the registry directly from a client component: it
 * pulls in zod schemas that are large and server-leaning. We expose a small
 * server route /api/capabilities/list and consume it here, plus a minimal
 * /api/capabilities/run for read-only execution.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { AppEventBus } from "@/lib/events";
import { Pill } from "@/components/app-shell/primitives";
import { ShieldAlert, Sparkles, Wallet } from "lucide-react";

interface CapabilitySummary {
  id: string;
  domain: string;
  description: string;
  sideEffects: "read" | "sim" | "write" | "meta";
  requiredAuth: "none" | "wallet" | "multisig";
  sensitivity: "low" | "medium" | "high";
}

const DOMAIN_LABEL: Record<string, string> = {
  treasury: "Treasury",
  trading: "Trading",
  yield: "Yield",
  intel: "Intelligence",
  studio: "Studio",
  dynamic: "Dynamic Tools",
  misc: "Misc",
  policy: "Policy",
  payments: "Payments",
  risk: "Risk",
};

export function CapabilityPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { addBlock } = useCanvas();
  const [items, setItems] = useState<CapabilitySummary[]>([]);
  const [loading, setLoading] = useState(false);

  // Lazy load — only fetch when first opened.
  useEffect(() => {
    if (!open || items.length > 0 || loading) return;
    setLoading(true);
    fetch("/api/capabilities/list", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { capabilities?: CapabilitySummary[] }) => {
        if (Array.isArray(data.capabilities)) setItems(data.capabilities);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [open, items.length, loading]);

  const grouped = useMemo(() => {
    const map = new Map<string, CapabilitySummary[]>();
    for (const c of items) {
      const arr = map.get(c.domain) ?? [];
      arr.push(c);
      map.set(c.domain, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const onSelect = (cap: CapabilitySummary) => {
    onOpenChange(false);
    if (cap.sideEffects === "read" || cap.sideEffects === "meta") {
      // Inline execution path. The route validates auth and runs the cap.
      addBlock({
        type: "narrative",
        source: "capability",
        title: `Running ${cap.id}`,
        subtitle: cap.description,
        payload: { state: "running", id: cap.id },
      });
      fetch("/api/capabilities/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cap.id, input: {} }),
      })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          addBlock({
            type: "capability-result",
            source: "capability",
            title: cap.id,
            payload: {
              operation: cap.id,
              success: ok && j?.success !== false,
              message:
                typeof j?.message === "string"
                  ? j.message
                  : ok
                    ? "Capability completed."
                    : (j?.error ?? "Capability needs more input — open the CommandBar to continue."),
              raw: j,
            },
          });
        })
        .catch(() => {
          addBlock({
            type: "capability-result",
            source: "capability",
            title: cap.id,
            payload: {
              operation: cap.id,
              success: false,
              message: "Capability needs additional inputs. Try asking via the CommandBar.",
            },
          });
        });
    } else {
      // Write/sim with side effects — route through CommandBar so planner/HITL kicks in.
      AppEventBus.emit("AGENT_COMMAND", { prompt: `Run ${cap.id}` });
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search 48 capabilities — yield, swap, simulate, watch…" />
      <CommandList>
        <CommandEmpty>
          {loading ? "Loading capabilities…" : "Nothing matches that."}
        </CommandEmpty>
        {grouped.map(([domain, caps], idx) => (
          <div key={domain}>
            {idx > 0 && <CommandSeparator />}
            <CommandGroup heading={DOMAIN_LABEL[domain] ?? domain}>
              {caps.map((cap) => (
                <CommandItem
                  key={cap.id}
                  value={`${cap.id} ${cap.description}`}
                  onSelect={() => onSelect(cap)}
                  className="flex items-start gap-3"
                >
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                    {cap.sensitivity === "high" ? (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    ) : cap.requiredAuth === "wallet" || cap.requiredAuth === "multisig" ? (
                      <Wallet className="h-3.5 w-3.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{cap.id}</span>
                      <Pill
                        tone={
                          cap.sensitivity === "high"
                            ? "rose"
                            : cap.sensitivity === "medium"
                              ? "violet"
                              : "emerald"
                        }
                        className="text-[10px]"
                      >
                        {cap.sensitivity}
                      </Pill>
                      {cap.requiredAuth !== "none" && (
                        <Pill tone="slate" className="text-[10px]">
                          {cap.requiredAuth}
                        </Pill>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{cap.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
