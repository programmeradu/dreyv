import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "crypto-treasury-management-startup-playbook";
const GUIDE = getGuide(SLUG)!;
const PATH = `/guides/${SLUG}`;

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.description,
  alternates: { canonical: PATH },
  keywords: [
    "crypto treasury management",
    "crypto treasury",
    "startup crypto treasury",
    "stablecoin treasury",
    "crypto treasury companies",
    "treasury management for startups",
    "onchain treasury",
  ],
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
      <GuideShell topic="Playbook" guide={GUIDE}>
        <h2>Who this is for</h2>
        <p>
          You are a founder, COO, or finance lead at a seed-to-Series-B crypto
          company. Some or all of your runway is onchain. You want a treasury
          that does not lose money to dumb mistakes, does not get rugged by
          chasing yield, and produces numbers you can put in front of an
          investor without flinching.
        </p>
        <p>
          This is the operating playbook: what to hold, how to hold it, and
          what to report.
        </p>

        <h2>The runway bucket model</h2>
        <p>
          Do not run one giant pile of capital. Split it into named buckets with
          stated purposes. The exact mix depends on your stage and burn, but the
          shape is consistent:
        </p>
        <ol>
          <li><strong>Operating reserve (3 to 6 months of burn).</strong> 100% stablecoins. USDC primary, USDT secondary if you need redundancy. This is payroll, vendors, taxes. It does not earn yield. It does not move.</li>
          <li><strong>Working capital (3 to 9 months).</strong> Stablecoins, optionally in a blue-chip money market (Kamino, marginfi) for low-single-digit yield. Liquid in under 24 hours.</li>
          <li><strong>Strategic reserve (12+ months).</strong> A mix of stables and majors (SOL, BTC, ETH). This is the bucket that can earn meaningful yield via liquid staking: see <Link href="/guides/solana-liquid-staking-treasury">Solana liquid staking for treasuries</Link>.</li>
          <li><strong>Token treasury (if you have a token).</strong> Your own token. Separate accounting, separate signer policy, never counted toward runway at market price.</li>
        </ol>

        <h2>Where to actually hold it</h2>
        <ul>
          <li><strong>Operating reserve →</strong> non-custodial multisig (Squads on Solana, Safe on Ethereum). See <Link href="/guides/how-to-create-solana-multisig-wallet">how to create a Solana multisig wallet</Link>.</li>
          <li><strong>Working capital →</strong> same multisig, with money-market positions managed through it.</li>
          <li><strong>Strategic reserve →</strong> a separate, higher-threshold cold multisig. Different signer list where possible.</li>
          <li><strong>Hot operating wallet →</strong> a small float (one to two weeks of opex) for fast vendor payments. Treat losing this as an acceptable cost, not a catastrophe.</li>
        </ul>

        <h2>Yield without idiocy</h2>
        <p>
          The fastest way to blow up a treasury is to chase yield past the line
          where you understand the risk. A useful test: if you cannot explain in
          two sentences <em>where the yield comes from</em> and <em>what breaks
          it</em>, you do not understand it.
        </p>
        <ul>
          <li><strong>OK:</strong> blue-chip lending (Kamino, marginfi, Aave), liquid staking (JitoSOL, mSOL), short-dated tokenised t-bills.</li>
          <li><strong>Only with explicit allocation caps:</strong> delta-neutral strategies, LP positions on majors.</li>
          <li><strong>Not from the treasury:</strong> leverage, long-tail farms, anything calling itself &quot;sustainable&quot; APY above 20%.</li>
        </ul>
        <p>
          The full menu with failure modes is in{" "}
          <Link href="/guides/solana-treasury-yield-strategies">Solana treasury yield strategies</Link>.
        </p>

        <h2>Approvals that survive an incident</h2>
        <ol>
          <li><strong>Threshold first, speed second.</strong> Pick a multisig threshold you can reach in 24 hours on a normal weekday, and not lower.</li>
          <li><strong>Signer hygiene.</strong> Hardware wallets, individual humans (not roles), documented off-boarding for every signer.</li>
          <li><strong>Spending tiers.</strong> Small payments out of the operating multisig with the standard threshold; anything over a stated USD limit requires the strategic-reserve threshold. Write it down.</li>
          <li><strong>Simulation before signing.</strong> Every meaningful transaction is simulated on a fork so signers see balance deltas, not raw program calls. Why: <Link href="/guides/intent-driven-treasury-solana">intent-driven treasury on Solana</Link>.</li>
        </ol>

        <h2>Reporting your investors expect</h2>
        <p>
          A credible 2026 board update treats the crypto treasury like any other
          part of the balance sheet. At minimum, monthly:
        </p>
        <ul>
          <li><strong>Total runway in months,</strong> calculated at conservative valuations (e.g. 30-day average, not spot).</li>
          <li><strong>Bucket-by-bucket balances</strong> with the wallet addresses listed once and re-referenced.</li>
          <li><strong>Realized PnL and yield</strong> for the period, separated from unrealized mark-to-market.</li>
          <li><strong>Concentration risk</strong>: exposure to any single token, protocol, or custodian above a set threshold.</li>
          <li><strong>Approvals log</strong>: what moved, who signed, why.</li>
        </ul>
        <p>
          The accounting side (cost basis, transfers vs swaps, audit trails)
          gets its own guide:{" "}
          <Link href="/guides/solana-treasury-accounting-guide">Solana treasury accounting</Link>.
        </p>

        <h2>Failure modes to design around</h2>
        <ul>
          <li><strong>Stablecoin depeg.</strong> Don&apos;t concentrate the operating reserve in a single issuer. Have a documented response if a peg slips more than 1%.</li>
          <li><strong>Custodian failure.</strong> The lesson of every cycle. Non-custodial-by-default for anything you cannot afford to lose.</li>
          <li><strong>Wrong-address transfers.</strong> Use named recipient lists, simulate every transfer, treat new addresses as a separate higher-friction approval.</li>
          <li><strong>Signer turnover.</strong> Rotate signers as part of off-boarding, the same way you rotate code access.</li>
          <li><strong>Token treasury volatility.</strong> Never let your own token count as runway at peak prices. Founders have explained themselves out of jobs over this.</li>
        </ul>

        <h2>Where dreyv fits</h2>
        <p>
          dreyv is the operating layer on top of your multisig. You plan in
          language (&quot;move 6 months of runway into the operating reserve and
          stake 40% of the strategic reserve via JitoSOL&quot;), dreyv simulates
          the actions, your signers approve with context, and the books update
          as transactions confirm. If you are also thinking about agentic
          execution, see{" "}
          <Link href="/guides/ai-agent-treasury-management">AI agent treasury management</Link>.
        </p>

        <h2>Next</h2>
        <p>
          Want the broader category context? Read{" "}
          <Link href="/guides/what-is-a-digital-asset-treasury">what is a digital asset treasury</Link>.
          Comparing chains?{" "}
          <Link href="/guides/solana-multisig-vs-ethereum-safe">Solana multisig vs Ethereum Safe</Link>.
        </p>
      </GuideShell>
    </>
  );
}
