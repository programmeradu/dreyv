import Link from "next/link";
import { MarketingShell } from "../marketing-shell";
import { SiteHeader } from "../site-header";
import { HOME_FAQ_ITEMS } from "@/lib/seo/home-faq";

const START = "/auth?redirect=/app";
const TOOL_COUNT = 347;

const MCP_SNIPPET = `{
  "mcpServers": {
    "dreyv": {
      "url": "https://dreyv.com/api/mcp",
      "headers": { "Authorization": "Bearer dk_live_..." }
    }
  }
}`;

function SealsHero() {
  return (
    <section className="mk-hero" aria-labelledby="hero-title">
      <link
        rel="preload"
        as="image"
        type="image/avif"
        href="/art/home-seals-tall-768.avif"
        media="(max-aspect-ratio: 6/5)"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        type="image/avif"
        imageSrcSet="/art/home-seals-800.avif 800w, /art/home-seals-1252.avif 1252w"
        imageSizes="100vw"
        media="(min-aspect-ratio: 6/5)"
        fetchPriority="high"
      />
      <div className="mk-hero-art">
        <picture>
          <source media="(max-aspect-ratio: 6/5)" type="image/avif" srcSet="/art/home-seals-tall-768.avif" />
          <source media="(max-aspect-ratio: 6/5)" type="image/webp" srcSet="/art/home-seals-tall-768.webp" />
          <source
            type="image/avif"
            srcSet="/art/home-seals-800.avif 800w, /art/home-seals-1252.avif 1252w"
            sizes="100vw"
          />
          <source
            type="image/webp"
            srcSet="/art/home-seals-800.webp 800w, /art/home-seals-1252.webp 1252w"
            sizes="100vw"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/home-seals-1252.webp"
            alt="Three violet wax seals in a row on cotton paper. Two are pressed; the third place is an empty embossed circle still waiting for its signer. A fountain pen rests beside them."
            width={1252}
            height={768}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      </div>
      <div className="mk-hero-copy hero-copy">
        <span className="mk-pill mk-rise">Beta</span>
        <h1 id="hero-title" className="mk-h1 mk-rise">
          Know what you&rsquo;re signing.
        </h1>
        <p className="mk-hero-sub mk-rise mk-rise-2">
          Treasury operations for teams on Solana, simulated before anyone signs.
        </p>
        <Link href={START} className="mk-btn mk-btn-solid mk-rise mk-rise-3">
          Start free
        </Link>
        <p className="mk-hero-note mk-rise mk-rise-3">Free plan, no card. Your keys stay yours.</p>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <MarketingShell header={<SiteHeader overlay current="/" />}>
      <SealsHero />

      {/* 1. Intent */}
      <section id="product" className="mk-section mk-screen mk-night mk-anchor" aria-labelledby="s-intent">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="s-intent" className="mk-h2">
            Type it like you&rsquo;d say it.
          </h2>
          <ul className="mk-commands" style={{ marginTop: "clamp(32px, 6vh, 64px)" }} aria-label="Example requests">
            <li>
              <span className="mk-quote">&ldquo;</span>Rebalance to 60% USDC.<span className="mk-quote">&rdquo;</span>
            </li>
            <li>
              <span className="mk-quote">&ldquo;</span>Pay six contributors.<span className="mk-quote">&rdquo;</span>
            </li>
            <li>
              <span className="mk-quote">&ldquo;</span>Stake the idle SOL.<span className="mk-quote">&rdquo;</span>
            </li>
          </ul>
          <p className="mk-lede mk-center mk-measure" style={{ marginTop: "clamp(28px, 5vh, 48px)" }}>
            dreyv turns the sentence into a plan, step by step.
          </p>
        </div>
      </section>

      {/* 2. Simulation (dominoes) */}
      <section className="mk-section" aria-labelledby="s-sim" style={{ paddingBottom: 0, background: "#d6ccbc" }}>
        <div className="mk-wrap-text mk-center mk-stack" style={{ position: "relative", zIndex: 1 }}>
          <h2 id="s-sim" className="mk-h2">
            See the result first.
          </h2>
          <p className="mk-lede">
            Every plan runs on a copy of mainnet before it goes anywhere. Approvers see balances before and after,
            the route and the fees, in plain words. No raw hex.
          </p>
        </div>
        <div className="mk-band" style={{ marginTop: "clamp(8px, 2vh, 24px)" }}>
          <picture>
            <source
              type="image/avif"
              srcSet="/art/sim-dominoes-800.avif 800w, /art/sim-dominoes-1376.avif 1376w"
              sizes="100vw"
            />
            <source
              type="image/webp"
              srcSet="/art/sim-dominoes-800.webp 800w, /art/sim-dominoes-1376.webp 1376w"
              sizes="100vw"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/art/sim-dominoes-1376.webp"
              alt="A long line of ivory and violet dominoes on paper by a window. The first one is caught mid-fall, so the whole chain can be seen before anything moves."
              width={1376}
              height={768}
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>
      </section>

      {/* 3. Signing */}
      <section className="mk-section mk-screen mk-night" aria-labelledby="s-sign">
        <div className="mk-wrap-text mk-center">
          <ul className="mk-threshold" aria-label="Example: a two of three multisig with two approvals in">
            <li>
              <span className="mk-seal" aria-hidden="true" />
              Signed
            </li>
            <li>
              <span className="mk-seal" aria-hidden="true" />
              Signed
            </li>
            <li>
              <span className="mk-seal mk-seal-empty" aria-hidden="true" />
              Waiting
            </li>
          </ul>
          <h2 id="s-sign" className="mk-h2" style={{ marginTop: "clamp(36px, 7vh, 72px)" }}>
            Sign where you already sign.
          </h2>
          <p className="mk-lede" style={{ marginTop: 24 }}>
            The plan lands in your Squads multisig as a normal proposal. Your signers, your threshold. dreyv never
            holds keys or funds.
          </p>
        </div>
      </section>

      {/* 4. Team */}
      <section className="mk-section mk-screen mk-bg-lilac" aria-labelledby="s-team">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="s-team" className="mk-h2">
            Work it out together.
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 24 }}>
            Your team sees the same plan, comments on it and approves it in one place.
          </p>
          <div className="mk-sheet" style={{ marginTop: "clamp(36px, 6vh, 56px)" }}>
            <div className="mk-sheet-head">
              <p className="mk-sheet-title">Pay six contributors</p>
              <span className="mk-tag">Example</span>
            </div>
            <ul className="mk-roles">
              <li>
                <span>
                  <span className="mk-role-name">Treasurer</span>
                  <span className="mk-role-note">Wrote the plan and checked the simulation</span>
                </span>
                <span className="mk-state mk-state-done">Proposed</span>
              </li>
              <li>
                <span>
                  <span className="mk-role-name">Signer</span>
                  <span className="mk-role-note">Left a comment, then approved</span>
                </span>
                <span className="mk-state mk-state-done">Approved</span>
              </li>
              <li>
                <span>
                  <span className="mk-role-name">Signer</span>
                  <span className="mk-role-note">Reviewing the result</span>
                </span>
                <span className="mk-state">Waiting</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5. Atlas */}
      <section className="mk-section mk-screen" aria-labelledby="s-atlas">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="s-atlas" className="mk-h2">
            Solana Atlas. Free for anyone.
          </h2>
          <p className="mk-lede mk-measure mk-center" style={{ marginTop: 24 }}>
            Check a token before you buy it, scan a swap for sandwich attacks, compare yields, test a strategy. No
            wallet needed.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 36 }}>
            <Link href="/atlas" className="mk-btn mk-btn-outline">
              Open Atlas <span className="mk-arrow" aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 6. Agents */}
      <section className="mk-section mk-screen mk-night" aria-labelledby="s-agents">
        <div className="mk-wrap-text mk-center">
          <h2 id="s-agents" className="mk-h2">
            Your agent can use it too.
          </h2>
          <p className="mk-lede" style={{ marginTop: 24 }}>
            <span className="mk-tnum">{TOOL_COUNT}</span> tools behind one key, over MCP or REST. These are the same
            tools the app uses, and every transaction comes back unsigned.
          </p>
          <pre className="mk-code" style={{ marginTop: 40 }} aria-label="MCP configuration example">
            {MCP_SNIPPET}
          </pre>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 32 }}>
            <Link href="/developers/mcp" className="mk-btn mk-btn-light">
              Connect your agent <span className="mk-arrow" aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 7. Pricing */}
      <section className="mk-section mk-screen mk-bg-light" aria-labelledby="s-pricing">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="s-pricing" className="mk-h2">
            Pricing
          </h2>
          <p
            className="mk-serif"
            style={{
              fontSize: "clamp(26px, 3.4vw, 44px)",
              lineHeight: 1.2,
              margin: "28px 0 0",
              color: "var(--mk-ink-2)",
              textWrap: "balance",
            }}
          >
            Free to start. Mini is <span className="mk-tnum">$49</span> a month, Max is{" "}
            <span className="mk-tnum">$199</span> a month.
          </p>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 36 }}>
            <Link href={START} className="mk-btn mk-btn-solid">
              Start free
            </Link>
            <Link href="/pricing" className="mk-btn mk-btn-outline">
              Compare plans
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mk-section mk-anchor" aria-labelledby="s-faq">
        <div className="mk-wrap-text">
          <h2 id="s-faq" className="mk-h2" style={{ textAlign: "center" }}>
            Questions
          </h2>
          <div className="mk-faq" style={{ marginTop: "clamp(32px, 6vh, 56px)" }}>
            {HOME_FAQ_ITEMS.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="mk-section mk-violet" aria-labelledby="s-close">
        <div className="mk-wrap-narrow mk-center">
          <h2 id="s-close" className="mk-h2">
            Simulate your next move before anyone signs.
          </h2>
          <div className="mk-actions mk-actions-center" style={{ marginTop: 40 }}>
            <Link href={START} className="mk-btn mk-btn-light">
              Start free
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
