import type { Metadata } from "next";
import Image from "next/image";
import { WaitlistForm } from "./waitlist-form";
import { COHORT_LABEL, COHORT_WINDOW } from "@/lib/waitlist/constants";
import { getSiteOrigin } from "@/lib/seo/site";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";

const TITLE = "Join the dreyv waitlist — Command-Ops for treasuries";
const DESCRIPTION =
  "dreyv is invite-only while we onboard the first cohorts of treasuries, DAOs, funds and protocols. Tell us about your stack — we'll send a seat when your slot opens.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${getSiteOrigin()}/waitlist` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${getSiteOrigin()}/waitlist`,
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function WaitlistPage() {
  return (
    <>
      <SiteHeader />
      <main className="relative isolate min-h-screen bg-white text-slate-900 font-[var(--font-manrope),Manrope,ui-sans-serif,system-ui] pt-16">
        {/* Ambient violet glows — solid violet only, no gradients/fuchsia */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[520px] w-[1100px] rounded-full bg-violet-400/25 blur-[160px]" />
        <div className="absolute top-[42%] -right-40 h-[420px] w-[420px] rounded-full bg-violet-300/30 blur-[140px]" />
        <div className="absolute bottom-0 -left-40 h-[420px] w-[420px] rounded-full bg-violet-300/25 blur-[140px]" />
      </div>

      <section className="relative mx-auto max-w-6xl px-6 pt-10 pb-16 lg:pt-16 lg:pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center">
          {/* Left: hero copy */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-600" aria-hidden />
              Invite-only · {COHORT_LABEL}
            </span>

            <h1 className="mt-6 text-[clamp(2.5rem,5vw,4rem)] font-bold leading-[1.05] tracking-[-0.025em] text-slate-900">
              Command-Ops for treasuries.
              <br />
              <span className="text-violet-600">By invitation.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              dreyv is the non-custodial treasury workspace for teams that want intent → plan →
              simulate → sign in one surface. We onboard in small cohorts so every account gets a
              real walkthrough. Tell us about your stack and we'll send a seat when your slot opens.
            </p>

            <p className="mt-3 text-sm text-slate-500">
              Onboarding window: <span className="text-violet-700 font-medium">{COHORT_WINDOW}</span>.
            </p>

            <p className="mt-8 text-[11px] font-mono uppercase tracking-[0.3em] text-slate-400">
              Non-custodial · Simulation-first · Multisig-native
            </p>
          </div>

          {/* Right: Dryv mascot welcoming you in */}
          <div className="relative hidden lg:flex items-center justify-center">
            <div className="absolute inset-0 -z-10 m-auto h-[420px] w-[420px] rounded-full bg-violet-400/25 blur-[110px]" />
            <div className="absolute inset-0 -z-10 m-auto h-[260px] w-[260px] rounded-full bg-violet-300/40 blur-[80px]" />
            <Image
              src="/_next/image?url=%2F&w=16&q=1"
              alt=""
              width={1}
              height={1}
              aria-hidden
              className="hidden"
            />
            <div className="relative">
              <Image
                src={require("@/assets/mascot/dryv-greet.png")}
                alt="Dryv, the dreyv mascot, waving you onto the waitlist"
                width={460}
                height={460}
                priority
                className="select-none drop-shadow-[0_30px_60px_rgba(124,58,237,0.35)]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Centered form — borderless, breathing room */}
      <section className="relative mx-auto max-w-2xl px-6 pb-24">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Request your seat</h2>
          <p className="mt-2 text-sm text-slate-500">A few details so we can place you in the right cohort.</p>
        </div>
        <WaitlistForm />
      </section>

      {/* What to expect strip */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-2xl border border-violet-200 bg-white/85 backdrop-blur p-8 lg:p-10">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">What happens next</h2>
          <ol className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-600">
            {[
              {
                step: "01",
                title: "Confirmation",
                body: "You'll get an email confirming your position. No countdown timers, no fake urgency.",
              },
              {
                step: "02",
                title: "Cohort review",
                body: "We pick each cohort by fit — chain, stack, treasury shape — not by signup order.",
              },
              {
                step: "03",
                title: "Single-use invite",
                body: "When you're up, you get a single-use invite link valid for 14 days. Connect a wallet — that's it.",
              },
            ].map((s) => (
              <li key={s.step} className="rounded-xl border border-violet-200 bg-white p-5">
                <span className="text-[11px] font-mono uppercase tracking-[0.25em] text-violet-600">
                  {s.step}
                </span>
                <p className="mt-2 text-base font-semibold text-slate-900">{s.title}</p>
                <p className="mt-1 leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      </main>
      <SiteFooter />
    </>
  );
}
