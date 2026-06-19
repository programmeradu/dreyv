import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "solana-multisig-treasury-management";
const GUIDE = getGuide(SLUG)!;
const PATH = `/guides/${SLUG}`;

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.description,
  alternates: { canonical: PATH },
  keywords: [
    "solana multisig treasury management",
    "solana multisig",
    "crypto treasury management",
    "dao treasury solana",
    "squads multisig",
    "non-custodial treasury",
    "command-ops treasury",
  ],
  openGraph: {
    title: `${GUIDE.title} | dreyv`,
    description: GUIDE.description,
    type: "article",
    url: PATH,
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
      <GuideShell topic="Treasury Ops" guide={GUIDE}>
        <h2>Click-ops is killing your treasury</h2>
        <p>
          Most Solana multisig treasuries are still run by clicking. Someone in
          the Discord proposes a transfer, a contributor builds it in the
          Squads UI, signers open the proposal, eyeball a list of program
          calls they can&apos;t read, and click approve. It works until it
          doesn&apos;t — wrong address, wrong amount, wrong program, a Jupiter
          route that quietly burns 30 bps to MEV, or a Marinade unstake
          someone forgot has a cooldown.
        </p>
        <p>
          The teams that survive this cycle have moved to{" "}
          <strong>command-ops</strong>: intent expressed in language,
          simulated on a fork before signing, executed through the multisig
          with human-readable approvals. This guide is the operating model.
        </p>

        <h2>What &quot;multisig treasury management&quot; actually covers</h2>
        <ul>
          <li><strong>Vault structure</strong> — how many vaults, what sits in each, who can move what.</li>
          <li><strong>Signer policy</strong> — who signs, what threshold, how recovery works when someone leaves.</li>
          <li><strong>Proposal flow</strong> — how an idea becomes a transaction that lands in the vault for signing.</li>
          <li><strong>Risk modeling</strong> — what each transaction does to balances, runway, concentration, and yield assumptions.</li>
          <li><strong>Execution surface</strong> — Jupiter, Marinade, Jito, Kamino, marginfi, Drift, payroll streams.</li>
          <li><strong>Books and reporting</strong> — cost basis, PnL, transfers vs swaps, audit trail.</li>
        </ul>

        <h2>The command-ops loop</h2>
        <ol>
          <li><strong>Intent.</strong> A treasurer or contributor describes the goal in plain language: <em>&quot;Stake 40% of the strategic reserve via JitoSOL, keep 6 months of runway in USDC, rebalance weekly if drift exceeds 5%.&quot;</em></li>
          <li><strong>Plan.</strong> The intent is decomposed into concrete transactions — swaps, stakes, transfers — with the venues, slippage, and order specified.</li>
          <li><strong>Simulate.</strong> The plan runs on a fork of mainnet. Signers see exact balance deltas, fees, MEV exposure, and any program-level surprises before anyone signs.</li>
          <li><strong>Propose.</strong> The simulated bundle lands in the Squads vault with a human-readable summary attached — recipient verification, amount, expected slippage, runway impact.</li>
          <li><strong>Sign.</strong> Each signer reviews the summary, optionally re-simulates from their own wallet, and signs from a hardware device.</li>
          <li><strong>Execute &amp; book.</strong> The transaction lands. Cost basis, PnL, and approval log update automatically.</li>
        </ol>

        <h2>Vault structure for a serious DAO or protocol</h2>
        <ul>
          <li><strong>Operating vault</strong> — stables for payroll, grants, vendors. Lower threshold (e.g. 2-of-4), higher-frequency approvals.</li>
          <li><strong>Strategic reserve vault</strong> — majors and LSTs. Higher threshold (e.g. 4-of-6), separate signer list where possible.</li>
          <li><strong>Token treasury vault</strong> — your own token. Governed separately, never counted as runway at peak prices.</li>
          <li><strong>Yield vault (optional)</strong> — explicit allocations to money markets and LSTs, sized so a depeg or validator slash does not threaten runway.</li>
        </ul>
        <p>
          The full setup walkthrough is in{" "}
          <Link href="/guides/how-to-create-solana-multisig-wallet">how to create a Solana multisig wallet</Link>{" "}
          and the comparison of multisig tools in{" "}
          <Link href="/guides/best-solana-multisig-tools">best Solana multisig tools</Link>.
        </p>

        <h2>Signer policy that survives turnover</h2>
        <ul>
          <li><strong>Hardware wallets only.</strong> Hot-wallet signers give you the operational pain of a multisig with the security of a single key.</li>
          <li><strong>Individual humans, not roles.</strong> &quot;Head of Ops&quot; is not a signer; the person currently in that seat is.</li>
          <li><strong>Documented off-boarding.</strong> Write down the exact onchain rotation steps before anyone joins the signer set. Run them as part of every departure.</li>
          <li><strong>Geographic and device diversity.</strong> Two signers on the same laptop is one signer.</li>
        </ul>

        <h2>Risk modeling for every proposal</h2>
        <p>
          The default Squads UI shows program calls. That is not risk modeling
          — it is hexadecimal. A serious treasury attaches the following to
          every proposal before it goes to signers:
        </p>
        <ul>
          <li><strong>Balance deltas</strong> per asset, per vault, in USD and native units.</li>
          <li><strong>Runway impact</strong> — how many months of stables remain after this transaction at the current burn.</li>
          <li><strong>Concentration impact</strong> — change in exposure to any single token, protocol, or custodian.</li>
          <li><strong>Slippage and MEV expectations</strong> for swaps and DCA.</li>
          <li><strong>Counterparty / program audit status</strong> — is the target program audited, who audited, when.</li>
          <li><strong>Recipient verification</strong> — for transfers, is the destination address on the known-good list or new.</li>
        </ul>

        <h2>The execution surface on Solana in 2026</h2>
        <ul>
          <li><strong>Jupiter</strong> — swaps and DCA. Multisig-compatible; route quality matters more than venue choice.</li>
          <li><strong>Marinade / Jito</strong> — liquid staking via mSOL / JitoSOL. See <Link href="/guides/solana-liquid-staking-treasury">Solana liquid staking for treasuries</Link>.</li>
          <li><strong>Kamino / marginfi / Drift</strong> — lending and money markets for stablecoin yield.</li>
          <li><strong>Streamflow / Mean</strong> — recurring payments, payroll, vesting from the vault.</li>
          <li><strong>Squads v4</strong> — the multisig substrate the rest of this stack signs through.</li>
        </ul>

        <h2>Books that don&apos;t embarrass you</h2>
        <p>
          The single hardest part of multisig treasury management is keeping
          books that an auditor or board can trust. Multisig vaults make it
          worse: every approval, every executor refund, every program-level
          fee shows up in the ledger and needs to be classified.
        </p>
        <p>
          Cost basis, transfers vs swaps, realized vs unrealized PnL, audit
          trails — covered end-to-end in{" "}
          <Link href="/guides/solana-treasury-accounting-guide">Solana treasury accounting</Link>.
        </p>

        <h2>Where dreyv fits</h2>
        <p>
          dreyv is the command-ops layer on top of Squads. You plan in
          language, dreyv simulates the plan on a fork, every proposal lands
          in your vault pre-loaded with balance deltas, runway impact,
          concentration changes, and recipient verification. Signers approve
          with context instead of guessing. Books update as transactions
          confirm.
        </p>
        <p>
          See the broader operating model in{" "}
          <Link href="/guides/crypto-treasury-management-solana">crypto treasury management on Solana</Link>{" "}
          and the agentic variant in{" "}
          <Link href="/guides/ai-agent-treasury-management">AI agent treasury management</Link>.
        </p>

        <h2>Next</h2>
        <p>
          Building from zero?{" "}
          <Link href="/guides/how-to-create-solana-multisig-wallet">create the multisig</Link>,
          then walk the{" "}
          <Link href="/guides/crypto-treasury-management-startup-playbook">startup playbook</Link>.
          Running a DAO? Start with the{" "}
          <Link href="/guides/solana-dao-treasury-management">Solana DAO treasury playbook</Link>.
        </p>
      </GuideShell>
    </>
  );
}
