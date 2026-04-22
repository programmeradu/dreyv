import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "intent-driven-treasury-solana";
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
      <GuideShell topic="Workflow" guide={GUIDE}>
        <h2>The problem: click-heavy, fragmented treasury work</h2>
        <p>
          Treasury operators constantly switch context: a portfolio screen for balances,
          a DEX for swaps, a bridge UI for cross-chain moves, a multisig for approvals,
          and a spreadsheet for runway. Each hop introduces friction and risk. Worst case,
          signers approve transactions they do not fully understand — classic{" "}
          <strong>blind signing</strong> behavior, even for sophisticated teams.
        </p>
        <p>
          That pattern is <strong>click-heavy fragmentation</strong>: success depends on
          manual navigation through many UIs instead of a single, reviewable intent.
        </p>

        <h2>What intent-driven treasury means</h2>
        <p>
          <strong>Intent-driven treasury</strong> flips the order: you state{" "}
          <strong>strategic intent</strong> in natural language (or structured commands),
          and the system responds with a <strong>plan</strong> — steps, dependencies, and
          expected outcomes — before anything touches chain. Execution becomes a{" "}
          <strong>reviewable pipeline</strong>, not a sequence of isolated clicks.
        </p>
        <p>Typical flow:</p>
        <ol>
          <li>
            <strong>Intent</strong> — &ldquo;Swap treasury SOL to USDC, keep exposure
            within policy, prefer lowest slippage.&rdquo;
          </li>
          <li><strong>Plan</strong> — routes, venues, estimated fees, and impact on balances.</li>
          <li>
            <strong>Simulation</strong> — fork or dry-run style checks so the payload
            matches expectations.
          </li>
          <li><strong>Sign</strong> — human approval with an impact summary, not a raw hex blob.</li>
        </ol>

        <h2>Why simulation belongs in the loop</h2>
        <p>
          Smart interfaces are not enough if the underlying transaction can still fail,
          drain the wrong account, or interact with a malicious program. A strong command
          layer treats <strong>every automated payload as untrusted</strong> until it
          passes <strong>pre-execution simulation</strong> and shows a clear,
          human-readable impact report. That is how teams reduce catastrophic mistakes
          without giving up automation.
        </p>

        <h2>Non-custodial by design</h2>
        <p>
          Intent-driven treasury does not require a custodian. The workspace can
          orchestrate reads, quotes, and transaction <strong>drafts</strong> while keys
          stay in the user&rsquo;s wallet or multisig. dreyv is built around that model:{" "}
          <strong>we help you decide and compose; we do not hold your assets.</strong>
        </p>

        <h2>How dreyv implements this</h2>
        <p>
          <Link href="/">dreyv</Link> is an AI-assisted, non-custodial treasury workspace:
          a <strong>command surface</strong> for intent, <strong>simulation</strong>{" "}
          before signing, <strong>Solana Atlas</strong> for public-market context (
          <Link href="/atlas">try Atlas</Link>), and a path for builders to ship
          automations. Pricing is transparent on our{" "}
          <Link href="/pricing">pricing page</Link>.
        </p>

        <h2>Who benefits first</h2>
        <ul>
          <li><strong>DAO and protocol treasuries</strong> coordinating multisig signers across time zones.</li>
          <li><strong>Small finance teams</strong> who outgrew spreadsheets but refuse opaque custodial tools.</li>
          <li><strong>Developers</strong> who want to ship treasury-facing tools into a real distribution surface.</li>
        </ul>

        <h2>Bottom line</h2>
        <p>
          This is not hype about &ldquo;AI replacing finance.&rdquo; It is a practical
          standard: <strong>intent first, plan second, simulate third, sign last</strong>{" "}
          — with keys and policy under your control. If that matches how you want to run
          treasury on Solana, dreyv is built to operationalize it.
        </p>
      </GuideShell>
    </>
  );
}
