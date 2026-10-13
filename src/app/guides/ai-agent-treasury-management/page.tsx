import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "ai-agent-treasury-management";
const GUIDE = getGuide(SLUG)!;
const PATH = `/guides/${SLUG}`;

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.description,
  alternates: { canonical: PATH },
  openGraph: {
    title: `${GUIDE.title} | dreyv`,
    description: GUIDE.description,
    type: "article",
    publishedTime: `${GUIDE.publishedAt}T12:00:00.000Z`,
  },
};

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        path={PATH}
        headline={GUIDE.title}
        description={GUIDE.description}
        datePublished={`${GUIDE.publishedAt}T12:00:00.000Z`}
      />
      <GuideShell topic="Agents" guide={GUIDE}>
        <h2>The pattern: plan, simulate, sign</h2>
        <p>
          Agentic treasury management is not &quot;an AI moves your money&quot;. The
          pattern that survives a security review is a three-step loop where the
          agent owns planning, a fork owns verification, and humans own signing.
        </p>
        <ol>
          <li>
            <strong>Plan.</strong> The agent reads vault balances, market state, and
            the team&apos;s intent (&quot;rotate 20% of SOL into JitoSOL&quot;,
            &quot;keep 9 months runway in USDC&quot;) and emits a candidate set of
            transactions.
          </li>
          <li>
            <strong>Simulate.</strong> The plan runs against a forked Solana state.
            Outputs are concrete: balance deltas, concentration changes, fee impact,
            slippage, runway after the change.
          </li>
          <li>
            <strong>Sign.</strong> The human-readable summary plus the raw
            transactions go into a Squads multisig proposal. Approvers sign based on
            the summary and the simulation, not on base64.
          </li>
        </ol>

        <h2>What agents are good at right now</h2>
        <ul>
          <li>
            Translating goals into a concrete sequence of swaps, stakes, and
            transfers.
          </li>
          <li>
            Sanity-checking the plan against current balances (&quot;you don&apos;t
            have enough USDC for this&quot;).
          </li>
          <li>
            Explaining the change in language an approver can understand without a
            DeFi background.
          </li>
          <li>
            Watching for anomalies (sudden depeg, sharp concentration shift, runway
            crossing a threshold) and proposing a response.
          </li>
        </ul>

        <h2>Where agents fail</h2>
        <ul>
          <li>
            <strong>Final approval.</strong> An LLM that signs is a single point of
            compromise. Keep the human in the loop.
          </li>
          <li>
            <strong>Stale prices.</strong> Plans built on cached oracles vs. live
            quotes diverge fast. Always quote at execution time.
          </li>
          <li>
            <strong>Hallucinated venues.</strong> Pin the agent to a known set of
            programs. Don&apos;t let it invent a pool that doesn&apos;t exist.
          </li>
        </ul>

        <h2>Guardrails worth shipping</h2>
        <ul>
          <li>Hard caps on per-transaction notional and per-day notional.</li>
          <li>
            A whitelist of allowed programs (Squads, Jupiter, Marinade, Jito,
            Kamino, marginfi, Drift): refuse anything else.
          </li>
          <li>
            Mandatory simulation before every proposal. No simulation, no signature
            request.
          </li>
          <li>
            Audit log of every plan the agent emitted, whether or not it was signed.
          </li>
        </ul>

        <h2>How dreyv implements this</h2>
        <p>
          dreyv is the AI treasury workspace for Solana teams. The agent plans
          against your live <Link href="/">non-custodial vault</Link>, runs every
          plan on a forked state with{" "}
          <Link href="/atlas">Solana Atlas</Link> intelligence, and hands the result
          to <Link href="/guides/squads-multisig-setup-guide">Squads</Link> for
          human signatures. Keys never leave your wallets.{" "}
          <Link href="/auth?redirect=/app">Start free</Link>. The free plan needs no card.
        </p>
      </GuideShell>
    </>
  );
}
