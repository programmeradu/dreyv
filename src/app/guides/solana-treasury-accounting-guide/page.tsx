import type { Metadata } from "next";
import Link from "next/link";
import { ArticleJsonLd } from "@/components/seo/ArticleJsonLd";
import { getGuide } from "@/lib/seo/guides";
import { GuideShell } from "@/components/guides/guide-shell";

const SLUG = "solana-treasury-accounting-guide";
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
      <GuideShell topic="Accounting" guide={GUIDE}>
        <h2>Why onchain accounting is harder than it looks</h2>
        <p>
          A wire transfer is one row. A Solana swap can be a dozen inner
          instructions, three token transfers, a routing fee, a priority
          fee, and a rent reclaim — all in a single transaction signature.
          Treating every transfer as a separate event will give your
          auditor a heart attack and your PnL a fictional number.
        </p>

        <h2>The four event types that matter</h2>
        <ul>
          <li>
            <strong>Internal transfer.</strong> Wallet A to Wallet B, both
            owned by the entity. No PnL event. Cost basis carries over.
          </li>
          <li>
            <strong>External transfer.</strong> In/out of the entity.
            Establishes or relieves cost basis at the time-of-transfer
            price.
          </li>
          <li>
            <strong>Swap.</strong> One asset disposed, another acquired.
            Realized PnL on the disposed leg, new cost basis on the
            acquired leg, fees expensed.
          </li>
          <li>
            <strong>Yield event.</strong> Staking rewards, lending
            interest, MEV tips. Income at fair-market-value on receipt;
            new cost basis at the same value.
          </li>
        </ul>

        <h2>Cost basis methods</h2>
        <p>
          Most jurisdictions accept FIFO; some allow specific-ID or
          weighted average. Pick one, document it, and apply it
          consistently. Switching mid-year is the fastest way to a
          messy audit.
        </p>

        <h2>The transfer-vs-swap trap</h2>
        <p>
          A common mistake: treating an LST mint as a swap. Staking SOL to
          receive JitoSOL is often best treated as a wrapping event (no
          disposal), not a taxable swap — but rules differ by jurisdiction.
          Same for unwrapping. Get an explicit position from your
          accountant and codify it in your labeling rules.
        </p>

        <h2>What auditors actually want</h2>
        <ol>
          <li>A complete list of wallets owned by the entity, with proof of control.</li>
          <li>Every transaction signature in the period, labeled by event type.</li>
          <li>The price source used for each valuation (e.g. Pyth/Birdeye TWAP at block time).</li>
          <li>Cost basis lot tracking, in/out, per asset.</li>
          <li>Reconciliation between onchain balances and the books at period end.</li>
        </ol>

        <h2>Practical setup for a Solana treasury</h2>
        <ul>
          <li>Maintain a wallet registry — every vault, signer, hot wallet, intermediate account.</li>
          <li>Pull transactions via Helius or your own RPC indexer, not a third-party CSV export.</li>
          <li>Anchor valuations to a consistent price feed (Pyth is the typical Solana choice).</li>
          <li>Run period-end reconciliations and lock the books — late edits destroy auditability.</li>
        </ul>

        <h2>Where dreyv helps</h2>
        <p>
          dreyv reads from your{" "}
          <Link href="/">non-custodial vaults</Link>, classifies every
          transaction, tracks cost basis, and exports a clean ledger for
          your accountant. Yield events, swaps, internal transfers, and
          fees are labeled automatically so your books match the chain.{" "}
          <Link href="/auth?redirect=/app">Start free</Link>. The free plan needs no card.
        </p>
      </GuideShell>
    </>
  );
}
