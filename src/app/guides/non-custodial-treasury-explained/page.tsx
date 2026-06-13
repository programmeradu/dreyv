import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "non-custodial-treasury-explained";
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
      <GuideShell topic="Custody" guide={GUIDE}>
        <h2>What &quot;non-custodial&quot; actually means</h2>
        <p>
          Non-custodial means the keys that can move funds never leave the
          wallets your team controls. No third party — including the
          software vendor you signed in with — can sign a transaction on
          your behalf or freeze your assets. If the vendor disappeared
          tomorrow, you would still control every dollar.
        </p>

        <h2>The three custody models</h2>
        <ul>
          <li>
            <strong>Custodial.</strong> A third party (an exchange, a
            qualified custodian) holds your keys. They can sign, they can
            freeze, they can lose them. Regulated and convenient. Not
            crypto-native.
          </li>
          <li>
            <strong>MPC (multi-party computation).</strong> Keys are split
            across servers (usually vendor-operated). The vendor can sign
            with you, sometimes for you, depending on policy. Better than
            custodial, but the vendor is still in the trust path.
          </li>
          <li>
            <strong>Non-custodial multisig.</strong> Keys live in your
            team&apos;s hardware/wallet devices. A program on-chain
            (e.g.{" "}
            <Link href="/guides/squads-multisig-setup-guide">Squads</Link>)
            enforces an M-of-N rule. No vendor can sign.
          </li>
        </ul>

        <h2>Why it matters for treasuries</h2>
        <ul>
          <li>
            <strong>Vendor failure.</strong> Cloud outages, acquisitions,
            shutdowns. Non-custodial means your operations survive.
          </li>
          <li>
            <strong>Insider risk.</strong> A custodial or MPC vendor
            employee with the wrong access can move funds. Multisig means
            no single party — internal or external — can act alone.
          </li>
          <li>
            <strong>Regulatory clarity.</strong> Non-custodial software is
            generally not regulated as a money transmitter because it
            never takes possession of funds.
          </li>
        </ul>

        <h2>Questions to ask any treasury tool</h2>
        <ol>
          <li>Can you sign a transaction without my keys? If yes, it&apos;s not non-custodial.</li>
          <li>Where do my keys live? &quot;In your wallet/hardware device&quot; is the only good answer.</li>
          <li>Can you freeze or block a transaction? If yes, you have a counterparty.</li>
          <li>If your servers are offline, can I still move funds using the underlying multisig? The answer must be yes.</li>
          <li>What permissions does your app request from my wallet? Read-only or per-transaction signature requests only.</li>
        </ol>

        <h2>Where the line gets blurry</h2>
        <p>
          A non-custodial tool can still hold <em>data</em> about your
          treasury — balances, labels, simulation history — without
          holding keys. That&apos;s fine. The custody test is signing
          authority, not data access. The risk to watch is &quot;agentic&quot;
          products that quietly take a signing key &quot;to automate&quot;.
          That&apos;s custodial in non-custodial clothing.
        </p>

        <h2>How dreyv stays non-custodial</h2>
        <p>
          dreyv never holds a signing key. Plans are prepared off-chain,
          simulated on a forked state, and submitted as a proposal to your
          existing{" "}
          <Link href="/guides/squads-multisig-setup-guide">Squads multisig</Link>.
          Your team signs from your own hardware wallets. dreyv is read +
          plan + simulate. Signing stays with you.{" "}
          <Link href="/waitlist">Join the waitlist</Link>.
        </p>
      </GuideShell>
    </>
  );
}
