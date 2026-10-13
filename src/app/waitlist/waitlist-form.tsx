"use client";

import { useState } from "react";
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

const inputBase = "mk-input";
const labelBase = "mk-label";

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
      <div className="mk-center" style={{ textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/art/mascot-celebrate.webp"
          alt="The dreyv mascot celebrating"
          width={314}
          height={360}
          style={{ width: 140, height: "auto", margin: "0 auto" }}
        />
        <h2 className="mk-h3" style={{ marginTop: 20 }}>
          {state.alreadyOnList ? "You\u2019re already on the list." : "You\u2019re on the list."}
        </h2>
        <p className="mk-body" style={{ marginTop: 10 }}>
          Position <strong className="mk-tnum" style={{ color: "var(--mk-violet)" }}>#{state.position}</strong>. Watch
          your inbox: we&rsquo;ll send a single-use invite when your cohort opens. No reminders, no countdowns.
        </p>
        <div className="mk-actions mk-actions-center" style={{ marginTop: 24 }}>
          <a href="/compare" className="mk-btn mk-btn-outline mk-btn-sm">
            See how it compares
          </a>
          <a href="/developers" className="mk-btn mk-btn-outline mk-btn-sm">
            Developer surface
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mk-form">
      <div className="mk-form-row">
        <div>
          <label htmlFor="wl-email" className={labelBase}>
            Email <span aria-hidden="true" style={{ color: "var(--mk-violet)" }}>*</span>
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
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "wl-email-err" : undefined}
          />
          {errors.email && (
            <p id="wl-email-err" className="mk-error">
              {errors.email}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="wl-name" className={labelBase}>
            Name
          </label>
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

      <div className="mk-form-row">
        <div>
          <label htmlFor="wl-org" className={labelBase}>
            Organization
          </label>
          <input
            id="wl-org"
            type="text"
            autoComplete="organization"
            value={form.organization || ""}
            onChange={(e) => update("organization", e.target.value)}
            className={inputBase}
            placeholder="DAO, fund or protocol name"
          />
        </div>
        <div>
          <label htmlFor="wl-role" className={labelBase}>
            Your role
          </label>
          <select
            id="wl-role"
            value={form.role || ""}
            onChange={(e) => update("role", (e.target.value || undefined) as WaitlistSubmission["role"])}
            className={inputBase}
          >
            <option value="">Select\u2026</option>
            {WAITLIST_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mk-form-row">
        <div>
          <label htmlFor="wl-orgtype" className={labelBase}>
            Org type
          </label>
          <select
            id="wl-orgtype"
            value={form.orgType || ""}
            onChange={(e) => update("orgType", (e.target.value || undefined) as WaitlistSubmission["orgType"])}
            className={inputBase}
          >
            <option value="">Select\u2026</option>
            {WAITLIST_ORG_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-labelledby="wl-chains-label">
          <span id="wl-chains-label" className={labelBase}>
            Chains used
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {WAITLIST_CHAINS.map((c) => {
              const active = (form.chains || []).includes(c.value as never);
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleChain(c.value)}
                  className="mk-chip"
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
          placeholder="For example Squads, Jupiter, Birdeye and spreadsheets"
        />
      </div>

      <div className="mk-form-row">
        <div>
          <label htmlFor="wl-aum" className={labelBase}>
            Treasury size
          </label>
          <select
            id="wl-aum"
            value={form.aumBand || ""}
            onChange={(e) => update("aumBand", (e.target.value || undefined) as WaitlistSubmission["aumBand"])}
            className={inputBase}
            aria-describedby="wl-aum-help"
          >
            <option value="">Select\u2026</option>
            {WAITLIST_AUM_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          <p id="wl-aum-help" className="mk-small" style={{ marginTop: 6 }}>
            Coarse buckets only, used to size cohorts. Never displayed publicly.
          </p>
        </div>
        <div>
          <label htmlFor="wl-ref" className={labelBase}>
            How did you hear about us?
          </label>
          <select
            id="wl-ref"
            value={form.referralSource || ""}
            onChange={(e) =>
              update("referralSource", (e.target.value || undefined) as WaitlistSubmission["referralSource"])
            }
            className={inputBase}
          >
            <option value="">Select\u2026</option>
            {WAITLIST_REFERRAL_SOURCES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="wl-usecase" className={labelBase}>
          What would you use dreyv for?
        </label>
        <textarea
          id="wl-usecase"
          rows={4}
          maxLength={500}
          value={form.useCase || ""}
          onChange={(e) => update("useCase", e.target.value)}
          className={inputBase}
          style={{ resize: "vertical" }}
          placeholder="The one or two jobs you want dreyv to do: DCA, rebalancing, multisig coordination, agent execution, MEV monitoring and so on."
        />
        <p className="mk-small mk-tnum" style={{ marginTop: 6 }}>
          {(form.useCase || "").length} of 500
        </p>
      </div>

      {state.kind === "error" && (
        <p className="mk-error" role="alert" style={{ fontSize: 15 }}>
          {state.message}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button type="submit" disabled={state.kind === "submitting"} className="mk-btn mk-btn-solid">
          {state.kind === "submitting" ? "Joining\u2026" : "Request a seat"}
        </button>
      </div>
    </form>
  );
}
