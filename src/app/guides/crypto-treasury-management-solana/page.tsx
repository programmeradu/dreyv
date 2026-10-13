import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "crypto-treasury-management-solana";
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
      <GuideShell topic="Treasury" guide={GUIDE}>
        <h2>What crypto treasury management actually means in 2026</h2>
        <p>
          The phrase covers two very different jobs. The legacy version (pioneered by
          Fireblocks, Bitwave, Fortris, and Request) is custody, accounting, and
          fiat on/off ramps for companies that hold crypto on their balance sheet. The
          newer version, the one this guide is about, is <em>operating</em> a treasury
          on a fast L1: paying contributors, earning yield, rebalancing, and approving
          transactions without leaving self-custody.
        </p>
        <p>
          Solana changed the economics of operating onchain. Sub-cent fees and
          sub-second settlement made it realistic to do treasury work directly from a
          multisig instead of moving funds to a custodian first. That shift is what
          dreyv is built for.
        </p>

        <h2>The Solana-native crypto treasury stack</h2>
        <p>A working stack in 2026 has five layers:</p>
        <ol>
          <li>
            <strong>Custody: Squads v4 multisig.</strong> Non-custodial, programmable
            thresholds, hardware-wallet friendly. See the{" "}
            <Link href="/guides/squads-multisig-setup-guide">Squads setup guide</Link>.
          </li>
          <li>
            <strong>Yield: liquid staking + curated DeFi.</strong> JitoSOL and mSOL
            for SOL exposure; Kamino, marginfi, and Drift for stablecoin yield with
            published risk parameters.
          </li>
          <li>
            <strong>Execution: Jupiter aggregator.</strong> Best-route swaps with
            simulated price impact before signing. DCA programs from a multisig where
            the funding window matters more than the entry price.
          </li>
          <li>
            <strong>Accounting: onchain history + tagged labels.</strong> The chain
            already has the ledger; the work is labelling vendors, grants, and inter-
            vault transfers so a CFO can read it. Most teams export to a spreadsheet
            or a tool like Bitwave.
          </li>
          <li>
            <strong>Planning: AI + simulation.</strong> The newest layer. Agents that
            translate intent (&quot;rebalance to 60/30/10, keep 6 months runway in
            USDC&quot;) into a concrete plan, simulate it on a forked state, and hand
            it to humans to sign. This is what dreyv does.
          </li>
        </ol>

        <h2>Common mistakes</h2>
        <ul>
          <li>
            <strong>Single-signer hot wallet for &quot;ops speed&quot;.</strong> The
            $50M+ losses of 2023-2024 were almost all single-signer compromises.
            Squads costs you 30 seconds per transaction and removes the entire risk.
          </li>
          <li>
            <strong>Yield without an exit plan.</strong> Locked positions, illiquid
            LP tokens, or isolated lending markets can take days to unwind. Treasury
            money should default to instant-redeem instruments unless there&apos;s a
            written reason otherwise.
          </li>
          <li>
            <strong>Approving what you can&apos;t read.</strong> Multisig approvers
            routinely sign base64 transactions they don&apos;t understand. Simulation
            with human-readable impact (&quot;this will move 12,000 USDC out of the
            ops vault and increase concentration in mSOL by 3.2 percentage points&quot;)
            is the fix.
          </li>
        </ul>

        <h2>Where AI fits, and where it shouldn&apos;t</h2>
        <p>
          AI is good at the <em>planning</em> step: turning a goal into a candidate
          set of transactions, sizing them against current balances, and explaining
          what changes. AI is bad at being a final approver. The pattern that works
          is: agent plans, fork simulates, multisig humans sign. Read more in the{" "}
          <Link href="/guides/ai-agent-treasury-management">AI agent treasury</Link>{" "}
          guide.
        </p>

        <h2>How dreyv fits</h2>
        <p>
          dreyv sits on the planning + simulation layer. You describe intent in
          plain English; dreyv builds the plan against your live vault, runs it on
          a forked Solana state, and hands you a Squads proposal with a human-readable
          impact summary. Keys never leave your wallets. Try the{" "}
          <Link href="/atlas">Solana Atlas</Link> for read-only intelligence, or{" "}
          <Link href="/auth?redirect=/app">start free</Link> for the full workspace.
        </p>
      </GuideShell>
    </>
  );
}
