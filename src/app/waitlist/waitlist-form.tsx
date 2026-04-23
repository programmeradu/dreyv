"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import {
  WAITLIST_ROLES,
  WAITLIST_ORG_TYPES,
  WAITLIST_CHAINS,
  WAITLIST_AUM_BANDS,
  WAITLIST_REFERRAL_SOURCES,
} from "@/lib/waitlist/constants";
import { waitlistSubmissionSchema, type WaitlistSubmission } from "@/lib/waitlist/schema";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; position: number; alreadyOnList?: boolean }
  | { kind: "error"; message: string };

const inputBase =
  "w-full rounded-xl border border-violet-200 bg-white/90 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 transition";

const labelBase = "block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 mb-2";

export function WaitlistForm() {
  const [form, setForm] = useState<WaitlistSubmission>({
    email: "",
    name: "",
    organization: "",
    chains: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  function update<K extends keyof WaitlistSubmission>(key: K, value: WaitlistSubmission[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleChain(value: string) {
    const current = new Set(form.chains || []);
    if (current.has(value as never)) current.delete(value as never);
    else current.add(value as never);
    update("chains", Array.from(current) as WaitlistSubmission["chains"]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = waitlistSubmissionSchema.safeParse(form);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries(flat)) if (v?.[0]) map[k] = v[0];
      setErrors(map);
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: data?.error || "Something went wrong. Try again." });
        return;
      }
      setState({
        kind: "success",
        position: data.position,
        alreadyOnList: data.alreadyOnList,
      });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message || "Network error" });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white">
          <Check className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
          {state.alreadyOnList ? "You're already on the list." : "You're on the list."}
        </h2>
        <p className="mt-2 text-slate-600">
          Position{" "}
          <span className="font-semibold text-violet-700">#{state.position}</span>. Watch your inbox
          — we'll send a single-use invite when your cohort opens. No reminders, no countdowns.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <a
            href="/compare"
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-4 py-2 font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700 transition"
          >
            See how it compares
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
          <a
            href="/developers"
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-4 py-2 font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700 transition"
          >
            Developer surface
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-2xl border border-violet-200 bg-white/90 backdrop-blur p-6 lg:p-8 space-y-5"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="wl-email" className={labelBase}>
            Email <span className="text-violet-600">*</span>
          </label>
          <input
            id="wl-email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className={inputBase}
            placeholder="you@org.xyz"
          />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="wl-name" className={labelBase}>Name</label>
          <input
            id="wl-name"
            type="text"
            autoComplete="name"
            value={form.name || ""}
            onChange={(e) => update("name", e.target.value)}
            className={inputBase}
            placeholder="Full name"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="wl-org" className={labelBase}>Organization</label>
          <input
            id="wl-org"
            type="text"
            autoComplete="organization"
            value={form.organization || ""}
            onChange={(e) => update("organization", e.target.value)}
            className={inputBase}
            placeholder="DAO / fund / protocol name"
          />
        </div>
        <div>
          <label htmlFor="wl-role" className={labelBase}>Your role</label>
          <select
            id="wl-role"
            value={form.role || ""}
            onChange={(e) => update("role", (e.target.value || undefined) as WaitlistSubmission["role"])}
            className={inputBase}
          >
            <option value="">Select…</option>
            {WAITLIST_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="wl-orgtype" className={labelBase}>Org type</label>
          <select
            id="wl-orgtype"
            value={form.orgType || ""}
            onChange={(e) => update("orgType", (e.target.value || undefined) as WaitlistSubmission["orgType"])}
            className={inputBase}
          >
            <option value="">Select…</option>
            {WAITLIST_ORG_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span className={labelBase}>Chains used</span>
          <div className="flex flex-wrap gap-2">
            {WAITLIST_CHAINS.map((c) => {
              const active = (form.chains || []).includes(c.value as never);
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleChain(c.value)}
                  className={
                    "rounded-xl border px-3 py-2 text-sm font-medium transition " +
                    (active
                      ? "border-violet-600 bg-violet-600 text-white"
                      : "border-violet-200 bg-white text-slate-700 hover:border-violet-400")
                  }
                  aria-pressed={active}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="wl-stack" className={labelBase}>
          Current treasury stack
        </label>
        <input
          id="wl-stack"
          type="text"
          maxLength={280}
          value={form.currentStack || ""}
          onChange={(e) => update("currentStack", e.target.value)}
          className={inputBase}
          placeholder="e.g. Squads + Jupiter + Birdeye + spreadsheets"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="wl-aum" className={labelBase}>Treasury size</label>
          <select
            id="wl-aum"
            value={form.aumBand || ""}
            onChange={(e) => update("aumBand", (e.target.value || undefined) as WaitlistSubmission["aumBand"])}
            className={inputBase}
          >
            <option value="">Select…</option>
            {WAITLIST_AUM_BANDS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Coarse buckets only — used to size cohorts. Never displayed publicly.
          </p>
        </div>
        <div>
          <label htmlFor="wl-ref" className={labelBase}>How did you hear about us?</label>
          <select
            id="wl-ref"
            value={form.referralSource || ""}
            onChange={(e) =>
              update("referralSource", (e.target.value || undefined) as WaitlistSubmission["referralSource"])
            }
            className={inputBase}
          >
            <option value="">Select…</option>
            {WAITLIST_REFERRAL_SOURCES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="wl-usecase" className={labelBase}>What would you use dreyv for?</label>
        <textarea
          id="wl-usecase"
          rows={4}
          maxLength={500}
          value={form.useCase || ""}
          onChange={(e) => update("useCase", e.target.value)}
          className={inputBase + " resize-none"}
          placeholder="Top 1–2 jobs you want dreyv to do — DCA, rebalancing, multisig coordination, agent execution, MEV monitoring, etc."
        />
        <p className="mt-1 text-[11px] text-slate-500">{(form.useCase || "").length} / 500</p>
      </div>

      {state.kind === "error" && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={state.kind === "submitting"}
        className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-60"
      >
        {state.kind === "submitting" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Joining…
          </>
        ) : (
          <>
            Request a seat
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
