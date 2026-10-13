import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "what-is-a-digital-asset-treasury";
const GUIDE = getGuide(SLUG)!;
const PATH = `/guides/${SLUG}`;

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.description,
  alternates: { canonical: PATH },
  keywords: [
    "digital asset treasury",
    "what is a digital asset treasury",
    "DAT crypto",
    "crypto treasury company",
    "bitcoin treasury company",
    "what is a bitcoin treasury company",
    "corporate crypto treasury",
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
      <GuideShell topic="Treasury 101" guide={GUIDE}>
        <h2>The short definition</h2>
        <p>
          A <strong>digital asset treasury</strong>: often shortened to DAT: is
          the balance-sheet position a company, DAO, protocol, or fund holds in
          crypto assets, together with the wallets, controls, and processes used
          to operate it. It is the crypto equivalent of a corporate cash and
          investment treasury, but the assets live in onchain wallets instead of
          bank accounts.
        </p>
        <p>
          When people say &quot;digital asset treasury company&quot; or
          &quot;bitcoin treasury company,&quot; they usually mean a public or
          private company whose balance sheet meaningfully holds crypto (often
          BTC, ETH, or SOL) as a reserve asset, not just as inventory for an
          exchange or as customer custody.
        </p>

        <h2>What sits inside a DAT</h2>
        <ul>
          <li><strong>Reserve assets:</strong> stablecoins (USDC, USDT), majors (BTC, ETH, SOL), and sometimes long-tail tokens received as fees or grants.</li>
          <li><strong>Yield-bearing positions:</strong> liquid staking tokens, money-market deposits, and short-dated tokenised t-bills.</li>
          <li><strong>Operating wallets:</strong> hot wallets for payroll, grants, vendor payments, and onchain ops.</li>
          <li><strong>Cold or multisig vaults:</strong> the long-term store of value, gated by an explicit signer policy.</li>
          <li><strong>Policy and reporting:</strong> who can move what, under which approvals, and how it shows up in the books.</li>
        </ul>

        <h2>Custodial vs non-custodial vs MPC</h2>
        <p>
          The single biggest split inside the DAT category is who holds the keys.
        </p>
        <ul>
          <li><strong>Custodial:</strong> a regulated third party (Coinbase Custody, BitGo, Anchorage) holds the keys. You get audit comfort and human support, but you also inherit counterparty risk and slower execution.</li>
          <li><strong>MPC:</strong> the key is split across parties or devices so no single signer can move funds alone. Fireblocks and Copper popularised this on the enterprise side.</li>
          <li><strong>Non-custodial multisig:</strong> a smart-contract vault (Squads on Solana, Safe on Ethereum) where M-of-N signers must co-sign. Keys never leave the team.</li>
        </ul>
        <p>
          A serious DAT usually mixes them: cold-stored majors in a non-custodial
          multisig, operating balances on MPC for speed, and exchange-side
          custody only when actively trading. We cover the trade-offs in detail
          in{" "}
          <Link href="/guides/non-custodial-treasury-explained">non-custodial treasury, explained</Link>.
        </p>

        <h2>How a DAT is different from a custodial account</h2>
        <ul>
          <li><strong>Transparency:</strong> every position is verifiable onchain. Investors and auditors can see the wallet without trusting a statement PDF.</li>
          <li><strong>Composability:</strong> the same vault can stake, lend, and pay vendors. A bank account can only move dollars.</li>
          <li><strong>Operational surface:</strong> wrong address, wrong program, MEV: the failure modes are different and require different controls.</li>
          <li><strong>Reporting:</strong> you can produce a real-time balance sheet, but you also need cost-basis tooling that understands swaps, transfers, and yield. See <Link href="/guides/solana-treasury-accounting-guide">Solana treasury accounting</Link>.</li>
        </ul>

        <h2>What a credible DAT looks like in 2026</h2>
        <ol>
          <li><strong>Documented signer policy.</strong> Who is on the multisig, what threshold, what happens when a signer leaves, and how recovery works.</li>
          <li><strong>Runway buckets, not one big pile.</strong> Operating reserve in stables, a strategic reserve in majors, a yield bucket sized to what you can afford to lock up.</li>
          <li><strong>Yield with stated risk.</strong> Liquid staking and blue-chip money markets only, sized so a depeg or validator slash does not threaten runway.</li>
          <li><strong>Simulation before signing.</strong> Every meaningful transaction is simulated on a fork so signers see balance deltas, not raw program calls.</li>
          <li><strong>Auditable books.</strong> Cost basis, realized vs unrealized PnL, transfers separated from swaps, exportable to your accountant.</li>
          <li><strong>Disclosed exposure.</strong> If you publish a treasury page, the wallet addresses are public and the methodology for valuations is documented.</li>
        </ol>

        <h2>Common DAT shapes</h2>
        <ul>
          <li><strong>Protocol DAT:</strong> a DAO treasury holding its own token plus stables and majors. Heavy emphasis on governance and disclosure.</li>
          <li><strong>Onchain company DAT:</strong> a startup running payroll, grants, and vendor payments from a multisig. Bias toward stables and short-dated yield.</li>
          <li><strong>Reserve-asset DAT:</strong> a public or private company holding BTC, ETH, or SOL as a strategic reserve. Bias toward cold storage and conservative custody.</li>
          <li><strong>Fund / family-office DAT:</strong> active allocator with diversified exposure, MPC for speed, multisig for cold.</li>
        </ul>

        <h2>Where dreyv fits</h2>
        <p>
          dreyv is the intelligence layer for a DAT on Solana. You plan in
          language, dreyv simulates the action on a fork, every proposal lands
          in your multisig pre-loaded with human-readable balance deltas, and
          the books update as transactions confirm. Pair it with{" "}
          <Link href="/guides/crypto-treasury-management-solana">crypto treasury management on Solana</Link>{" "}
          for the operating model, and{" "}
          <Link href="/guides/solana-treasury-yield-strategies">Solana treasury yield strategies</Link>{" "}
          for the yield side.
        </p>

        <h2>Next</h2>
        <p>
          Building a DAT from scratch? Start with{" "}
          <Link href="/guides/how-to-create-solana-multisig-wallet">how to create a Solana multisig wallet</Link>,
          then the{" "}
          <Link href="/guides/crypto-treasury-management-startup-playbook">startup crypto treasury playbook</Link>.
        </p>
      </GuideShell>
    </>
  );
}
