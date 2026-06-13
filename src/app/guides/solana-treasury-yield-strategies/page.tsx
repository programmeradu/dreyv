import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "solana-treasury-yield-strategies";
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
      <GuideShell topic="Yield" guide={GUIDE}>
        <h2>The treasury yield ladder</h2>
        <p>
          A Solana treasury sitting in idle USDC and SOL is a fixable
          problem. The goal isn&apos;t maximum APY — it&apos;s the best
          risk-adjusted yield that doesn&apos;t introduce a new failure mode
          for the company. Strategies sit on a ladder from boring to
          aggressive.
        </p>

        <h2>Tier 1 — money markets</h2>
        <ul>
          <li>
            <strong>Kamino.</strong> The dominant Solana lending market in
            2026. Deep USDC/SOL liquidity, automated vaults, and isolated
            markets for newer assets.
          </li>
          <li>
            <strong>marginfi.</strong> Cross-margin lending with a
            conservative risk team. Good for treasury USDC deposits.
          </li>
          <li>
            <strong>Drift.</strong> Perps venue with a spot lending side;
            useful when you also want hedging in the same account.
          </li>
        </ul>
        <p>
          Stable APYs (typically 4–8% on USDC in 2026) with smart-contract
          risk as the main exposure. Suitable for the bulk of a runway
          bucket.
        </p>

        <h2>Tier 2 — liquid staking</h2>
        <p>
          Convert idle SOL into{" "}
          <Link href="/guides/solana-liquid-staking-treasury">
            JitoSOL, mSOL, or bSOL
          </Link>{" "}
          to capture staking + MEV yield while keeping the position liquid
          and composable. Native staking yield (~6–7%) plus MEV (1–2%) on
          JitoSOL is the typical baseline.
        </p>

        <h2>Tier 3 — LST collateral loops</h2>
        <p>
          Deposit JitoSOL into Kamino, borrow USDC, deploy the USDC into a
          money market or stable LP. This stacks 8–12% in theory. In
          practice the loop introduces liquidation risk on a SOL drawdown
          and correlation risk if the LST depegs. Cap loops at a small
          fraction of treasury and re-simulate weekly.
        </p>

        <h2>Tier 4 — delta-neutral</h2>
        <p>
          Long spot SOL + short perp SOL on Drift, collecting funding when
          it&apos;s positive. Yields are good in bull regimes (10–25%
          annualized) and can flip negative fast. Treat as an opportunity
          allocation, not core treasury.
        </p>

        <h2>What to avoid</h2>
        <ul>
          <li>Single-token farms paying 100%+ — that&apos;s emissions, not yield.</li>
          <li>
            Bridged-asset LPs (assets that came across a bridge from another
            chain) for any size — bridge risk is uncompensated.
          </li>
          <li>
            New money markets with under $20M TVL — the risk premium
            isn&apos;t worth the marginal yield for treasury size.
          </li>
        </ul>

        <h2>How to actually allocate</h2>
        <p>
          Use the bucket framework from the{" "}
          <Link href="/guides/solana-dao-treasury-management">
            DAO treasury playbook
          </Link>
          . Keep 9–18 months of runway in Tier 1. Park strategic SOL in
          Tier 2. Reserve Tier 3 and Tier 4 for an opportunity bucket
          you&apos;re willing to draw down.
        </p>

        <h2>Where dreyv fits</h2>
        <p>
          Describe a yield intent — <em>&ldquo;deposit 250k USDC into the
          best Kamino vault under 70% utilization&rdquo;</em> — and dreyv
          finds the venue, simulates the deposit, shows post-trade
          concentration and runway, and ships the proposal to your{" "}
          <Link href="/guides/squads-multisig-setup-guide">Squads multisig</Link>.{" "}
          <Link href="/waitlist">Join the waitlist</Link>.
        </p>
      </GuideShell>
    </>
  );
}
