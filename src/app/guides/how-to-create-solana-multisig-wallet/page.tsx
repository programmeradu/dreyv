import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "how-to-create-solana-multisig-wallet";
const GUIDE = getGuide(SLUG)!;
const PATH = `/guides/${SLUG}`;

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.description,
  alternates: { canonical: PATH },
  keywords: [
    "how to create a multisig wallet solana",
    "solana multisig wallet",
    "create solana multisig",
    "squads v4 setup",
    "multisig wallet solana",
    "best solana multisig",
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
      <GuideShell topic="Multisig" guide={GUIDE}>
        <h2>Before you click anything</h2>
        <p>
          A Solana multisig wallet is a program-owned vault that requires
          <strong> M-of-N</strong> signers to approve any transaction. Setting
          one up well takes maybe an hour. Setting one up badly — wrong signer
          list, wrong threshold, no recovery plan — can quietly cost you the
          treasury when someone leaves the team. Spend the hour.
        </p>
        <p>
          This guide uses <strong>Squads v4</strong> because it is the most-used
          multisig on Solana, has the deepest integrations, and is what most
          treasury tooling (including dreyv) understands natively. The same
          mental model applies to Snowflake Safe or Mean Multisig — see{" "}
          <Link href="/guides/best-solana-multisig-tools">best Solana multisig tools</Link>{" "}
          if you want to compare first.
        </p>

        <h2>Step 1 — Pick your signers</h2>
        <ul>
          <li><strong>Use individual humans, not roles.</strong> &quot;CTO&quot; is not a signer. The person currently holding that role is.</li>
          <li><strong>Hardware wallets only.</strong> Ledger or similar. A multisig with hot-wallet signers gives you the operational pain of a multisig with the security of a single key.</li>
          <li><strong>Geographic and device diversity.</strong> Two signers on the same laptop in the same office is one signer.</li>
          <li><strong>Document the off-boarding plan</strong> for each signer before you add them. If you cannot describe how to remove them, do not add them.</li>
        </ul>

        <h2>Step 2 — Pick your threshold</h2>
        <p>
          The threshold is how many signers must co-sign a transaction. A common
          mistake is optimising for security only — &quot;5-of-5&quot; sounds
          safe until one signer is on a plane and payroll is due.
        </p>
        <ul>
          <li><strong>Small team (3 signers):</strong> 2-of-3. One signer can be unavailable.</li>
          <li><strong>Mid team (5 signers):</strong> 3-of-5. Tolerates two absent signers.</li>
          <li><strong>DAO / protocol (7+):</strong> 4-of-7 or 5-of-9, often with a separate higher-threshold cold vault.</li>
        </ul>
        <p>
          If you cannot reach the threshold within 24 hours on a normal weekday,
          your threshold is too high.
        </p>

        <h2>Step 3 — Deploy the vault on Squads v4</h2>
        <ol>
          <li>Connect a wallet that holds a small amount of SOL (~0.05 SOL is plenty) at <code>app.squads.so</code>.</li>
          <li>Create a new Squad, give it a name that includes the entity (e.g. &quot;Acme Labs — Treasury&quot;).</li>
          <li>Add each signer&apos;s Solana address. Triple-check each address — paste, then read aloud, then have the signer confirm.</li>
          <li>Set the threshold you decided in step 2.</li>
          <li>Confirm and sign the creation transaction. The vault is now live onchain.</li>
        </ol>
        <p>
          For the full walkthrough including programmable signer policies, see
          the dedicated{" "}
          <Link href="/guides/squads-multisig-setup-guide">Squads multisig setup guide</Link>.
        </p>

        <h2>Step 4 — Fund the vault (the right way)</h2>
        <ul>
          <li><strong>Send a small test transfer first.</strong> $10 of USDC or 0.01 SOL. Confirm it lands in the vault address.</li>
          <li><strong>Send the real balance from a wallet you control</strong>, not directly from an exchange withdrawal on the first transfer. Exchanges occasionally fat-finger memos or addresses.</li>
          <li><strong>Verify the vault address on a block explorer</strong> before any large transfer.</li>
        </ul>

        <h2>Step 5 — Do a fire drill before you trust it</h2>
        <p>
          Before the vault holds anything material, run a dry run of the
          workflows you will actually use:
        </p>
        <ol>
          <li>Propose a small SOL transfer out of the vault.</li>
          <li>Have every signer review and approve from their hardware wallet.</li>
          <li>Execute. Time how long it took end-to-end.</li>
          <li>Repeat with a token swap and a staking action if you plan to do those.</li>
        </ol>
        <p>
          If anyone struggled, fix it now — bad UX during a fire drill becomes
          missed payroll during a real one.
        </p>

        <h2>Step 6 — Wire up the intelligence layer</h2>
        <p>
          A bare multisig shows signers raw program calls. dreyv connects to
          your Squads vault and, for every proposal, shows human-readable
          balance deltas, recipient verification, and a fork-simulated result
          before anyone signs. See{" "}
          <Link href="/guides/intent-driven-treasury-solana">intent-driven treasury on Solana</Link>{" "}
          for why this matters and{" "}
          <Link href="/guides/ai-agent-treasury-management">AI agent treasury management</Link>{" "}
          for the agentic version.
        </p>

        <h2>Common mistakes</h2>
        <ul>
          <li><strong>Adding the deployer wallet as a signer &quot;temporarily.&quot;</strong> Temporary signers become permanent. Remove them as part of step 3.</li>
          <li><strong>Threshold of 1.</strong> That is a single-sig wallet with extra steps.</li>
          <li><strong>Signers on browser-only wallets.</strong> Phantom-only signers are a key-exposure risk; pair them with a hardware device.</li>
          <li><strong>No documented recovery.</strong> Write down, in plain English, how the team would replace a lost signer. Store it where new joiners can read it.</li>
        </ul>

        <h2>Next</h2>
        <p>
          Multisig done? Decide what actually sits in it with{" "}
          <Link href="/guides/crypto-treasury-management-solana">crypto treasury management on Solana</Link>,
          then look at{" "}
          <Link href="/guides/solana-treasury-yield-strategies">Solana treasury yield strategies</Link>{" "}
          for the yield bucket.
        </p>
      </GuideShell>
    </>
  );
}
