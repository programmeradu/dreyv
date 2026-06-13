import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "solana-liquid-staking-treasury";
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
      <GuideShell topic="Liquid Staking" guide={GUIDE}>
        <h2>Why treasuries care about LSTs</h2>
        <p>
          Native SOL staking yields roughly 6–7% but locks capital for an
          epoch (~2–3 days) on unstake. Liquid staking tokens (LSTs) solve
          that by giving you a transferable receipt token — JitoSOL, mSOL,
          bSOL — that earns staking yield while remaining usable as
          collateral, swap liquidity, or treasury reserve.
        </p>
        <p>
          For a treasury, the question isn&apos;t &quot;should we stake
          SOL?&quot; It&apos;s &quot;which LST, and what fraction of the SOL
          bucket?&quot;
        </p>

        <h2>The big three</h2>
        <ul>
          <li>
            <strong>JitoSOL.</strong> Run by Jito; captures MEV tips on top
            of base staking yield. Highest realized APY most epochs. Deepest
            DEX liquidity. The default for most Solana treasuries in 2026.
          </li>
          <li>
            <strong>mSOL (Marinade).</strong> The original Solana LST.
            Decentralized validator set, strong governance track record,
            mature integrations across Kamino, marginfi, Drift.
          </li>
          <li>
            <strong>bSOL (BlazeStake).</strong> Smaller, but exposed to
            stake-pool MEV and validator gauges. Useful as a diversifier,
            not as a core position.
          </li>
        </ul>

        <h2>Risks worth pricing in</h2>
        <ul>
          <li>
            <strong>Smart-contract risk.</strong> Each LST is a program. An
            exploit on the stake pool affects every holder.
          </li>
          <li>
            <strong>Depeg risk.</strong> LSTs trade slightly above 1 SOL
            (accrued yield) but can briefly trade below in stress events.
            If you have to exit through the DEX instead of the unstake queue,
            you eat slippage.
          </li>
          <li>
            <strong>Validator concentration.</strong> Check the stake pool&apos;s
            validator set. A pool concentrated in a handful of validators
            inherits their slashing and uptime risk.
          </li>
        </ul>

        <h2>Sizing the allocation</h2>
        <p>
          A typical Solana DAO treasury splits its SOL bucket roughly:
        </p>
        <ul>
          <li>10–20% liquid SOL (operational, fast exits).</li>
          <li>50–70% in one or two LSTs (JitoSOL ± mSOL).</li>
          <li>10–20% native staked (lowest smart-contract risk, longest unbond).</li>
        </ul>
        <p>
          See the{" "}
          <Link href="/guides/solana-dao-treasury-management">
            DAO treasury playbook
          </Link>{" "}
          for how this fits inside the broader runway / yield / opportunity
          bucket framework.
        </p>

        <h2>Unstake mechanics</h2>
        <p>
          Every LST offers two exits: the native unstake queue (slow, par
          value) and the secondary market (instant, market price). For
          treasury-sized exits, simulate both paths before signing. dreyv
          quotes them side by side so approvers see the real cost of an
          instant exit vs. waiting an epoch.
        </p>

        <h2>How dreyv handles LSTs</h2>
        <p>
          Tell dreyv <em>&ldquo;stake 40% of idle SOL into JitoSOL&rdquo;</em>{" "}
          and it plans the swap, simulates impact on runway and
          concentration, and routes the proposal to your{" "}
          <Link href="/guides/squads-multisig-setup-guide">Squads multisig</Link>.
          Keys never leave your wallets.{" "}
          <Link href="/waitlist">Join the waitlist</Link> for early access.
        </p>
      </GuideShell>
    </>
  );
}
