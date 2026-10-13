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
        media="(max-aspect-ratio: 1/2)"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        type="image/avif"
        imageSrcSet="/art/home-seals-800.avif 800w, /art/home-seals-1252.avif 1252w"
        imageSizes="100vw"
        media="(min-aspect-ratio: 1/2)"
        fetchPriority="high"
      />
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
      <div className="mk-hero-art">
        <picture>
          <source media="(max-aspect-ratio: 1/2)" type="image/avif" srcSet="/art/home-seals-tall-768.avif" />
          <source media="(max-aspect-ratio: 1/2)" type="image/webp" srcSet="/art/home-seals-tall-768.webp" />
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
    </section>
  );
}


type StillProps = {
  /** Base name in /public/art, e.g. "home-intent". */
  name: string;
  /** Native width and height of the largest file. */
  w: number;
  h: number;
  alt: string;
  sizes: string;
  className?: string;
};

/** A generated still life, served as AVIF with a WebP fallback at 800w and native width. Lazy, below the fold. */
function Still({ name, w, h, alt, sizes, className }: StillProps) {
  const set = (ext: string) => `/art/${name}-800.${ext} 800w, /art/${name}-${w}.${ext} ${w}w`;
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/art/${name}-${w}.webp`} alt={alt} width={w} height={h} loading="lazy" decoding="async" />
    </picture>
  );
}

const HALF = "(min-width: 900px) 58vw, 100vw";
const PLATE = "(min-width: 900px) 46vw, 100vw";

export function HomePage() {
  return (
    <MarketingShell header={<SiteHeader overlay current="/" />}>
      <SealsHero />

      {/* Intent: pull-quote type on the left, the note bleeds off the right edge. */}
      <section id="product" className="hx hx-intent mk-anchor" aria-labelledby="s-intent">
        <div className="hx-intent-copy">
          <h2 id="s-intent" className="hx-h2">
            Type it like you&rsquo;d say it.
          </h2>
          <ul className="hx-quotes" aria-label="Example requests">
            <li>&ldquo;Rebalance to 60% USDC.&rdquo;</li>
            <li>&ldquo;Pay six contributors.&rdquo;</li>
            <li>&ldquo;Stake the idle SOL.&rdquo;</li>
          </ul>
          <p className="hx-body">dreyv turns the sentence into a plan you can read, one step at a time.</p>
        </div>
        <Still
          className="hx-intent-art"
          name="home-intent"
          w={1264}
          h={848}
          sizes={HALF}
          alt="A cream ledger slip with three lines of loose violet handwriting, a fountain pen resting beside it on cotton paper."
        />
      </section>

      {/* Simulation: the proof print bleeds off the left edge, copy sits lower on the right. */}
      <section className="hx hx-proof" aria-labelledby="s-sim">
        <figure className="hx-proof-art">
          <Still
            name="home-proof"
            w={1264}
            h={848}
            sizes={HALF}
            alt="A sheet of tissue paper lifted at one corner over a violet test stamp on cream card, with a brass loupe beside it."
          />
          <figcaption className="hx-caption">A test stamp on tissue, before the real one goes down.</figcaption>
        </figure>
        <div className="hx-proof-copy">
          <h2 id="s-sim" className="hx-h2">
            See the result first.
          </h2>
          <p className="hx-body">
            Every plan runs on a copy of mainnet before it goes anywhere. You see what it would do while it is still a
            draft, and nothing has moved.
          </p>
        </div>
      </section>

      {/* Readable impact: a book plate with a caption, headline set large beside it. */}
      <section className="hx hx-plate" aria-labelledby="s-read">
        <div className="hx-plate-copy">
          <h2 id="s-read" className="hx-h2">
            Read it like a statement.
          </h2>
          <p className="hx-body">
            Approvers see balances before and after, the route and the fees, in plain words. No raw hex, no guessing
            what a signature does.
          </p>
        </div>
        <figure className="hx-plate-fig">
          <div className="hx-plate-mat">
            <Still
              name="home-statement"
              w={1200}
              h={896}
              sizes={PLATE}
              alt="A cream statement folded in thirds and partly opened, tied loosely with a violet silk ribbon."
            />
          </div>
          <figcaption className="hx-caption">What a signer reads before they sign.</figcaption>
        </figure>
      </section>

      {/* Signing: one dark chapter. The photo is shot on violet linen so it becomes the section. */}
      <section className="hx hx-sign" aria-labelledby="s-sign">
        <div className="hx-sign-copy">
          <h2 id="s-sign" className="hx-h2">
            Sign where you already sign.
          </h2>
          <p className="hx-body">
            The plan lands in your Squads multisig as a normal proposal. Your signers, your threshold. dreyv never holds
            keys or funds.
          </p>
        </div>
        <Still
          className="hx-sign-art"
          name="home-signet"
          w={1200}
          h={896}
          sizes={HALF}
          alt="A gold signet ring beside a freshly pressed violet wax seal on a square of cream paper, on violet linen."
        />
      </section>

      {/* Team: staggered split, cards on the left, copy offset lower on the right. */}
      <section className="hx hx-team" aria-labelledby="s-team">
        <Still
          className="hx-team-art"
          name="home-namecards"
          w={1264}
          h={848}
          sizes={HALF}
          alt="Three folded name cards in a row on an oak desk: one ticked, one marked with a violet wax dot, one still blank."
        />
        <div className="hx-team-copy">
          <h2 id="s-team" className="hx-h2">
            Work it out together.
          </h2>
          <p className="hx-body">
            Your team sees the same plan, comments on it and approves it in one place. The treasurer proposes, signers
            ask their questions, and everyone reads the same numbers.
          </p>
        </div>
      </section>

      {/* Atlas: the map runs edge to edge, a paper panel overlaps its lower edge. */}
      <section className="hx-atlas" aria-labelledby="s-atlas">
        <Still
          className="hx-atlas-art"
          name="home-map"
          w={1376}
          h={768}
          sizes="100vw"
          alt="A folded paper map opened flat, pale contour lines with a thin violet route between three violet dots, a brass compass on one corner."
        />
        <div className="hx-atlas-panel">
          <h2 id="s-atlas" className="hx-h2">
            Solana Atlas. Free for anyone.
          </h2>
          <p className="hx-body">
            Check a token before you buy it, scan a swap for sandwich attacks, compare yields, test a strategy. No wallet
            needed.
          </p>
          <Link href="/atlas" className="mk-btn mk-btn-outline">
            Open Atlas <span className="mk-arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </section>

      {/* Agents: dark split, the config set as type, the key on night paper. */}
      <section className="hx hx-agents" aria-labelledby="s-agents">
        <div className="hx-agents-copy">
          <h2 id="s-agents" className="hx-h2">
            Your agent can use it too.
          </h2>
          <p className="hx-body">
            <span className="mk-tnum">{TOOL_COUNT}</span> tools behind one key, over MCP or REST. They are the same tools
            the app uses, and every transaction comes back unsigned.
          </p>
          <pre className="hx-code" aria-label="MCP configuration example">
            {MCP_SNIPPET}
          </pre>
          <Link href="/developers/mcp" className="mk-btn mk-btn-light">
            Connect your agent <span className="mk-arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
        <Still
          className="hx-agents-art"
          name="home-key"
          w={1200}
          h={896}
          sizes={PLATE}
          alt="An old brass key with a blank cream tag on violet string, beside a coil of violet braided cable with a brass connector."
        />
      </section>

      {/* Pricing: one large sentence and a small plate. */}
      <section className="hx hx-price" aria-labelledby="s-pricing">
        <div className="hx-price-copy">
          <h2 id="s-pricing" className="hx-price-line">
            Free to start. Mini is <span className="mk-tnum">$49</span> a month. Max is{" "}
            <span className="mk-tnum">$199</span> a month.
          </h2>
          <div className="mk-actions">
            <Link href={START} className="mk-btn mk-btn-solid">
              Start free
            </Link>
            <Link href="/pricing" className="mk-btn mk-btn-outline">
              Compare plans
            </Link>
          </div>
        </div>
        <Still
          className="hx-price-art"
          name="home-tags"
          w={1264}
          h={848}
          sizes={PLATE}
          alt="Three blank paper tags of growing size fanned out on cotton paper, two tied with violet string, the largest marked with a violet wax dot."
        />
      </section>

      {/* Questions: heading on the left, answers on the right. */}
      <section id="faq" className="hx hx-faq mk-anchor" aria-labelledby="s-faq">
        <h2 id="s-faq" className="hx-h2">
          Questions
        </h2>
        <div className="mk-faq">
          {HOME_FAQ_ITEMS.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Close */}
      <section className="hx-close mk-violet" aria-labelledby="s-close">
        <h2 id="s-close" className="hx-close-line">
          Simulate your next move before anyone signs.
        </h2>
        <Link href={START} className="mk-btn mk-btn-light">
          Start free
        </Link>
      </section>
    </MarketingShell>
  );
}
