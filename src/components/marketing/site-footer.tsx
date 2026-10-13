import Link from "next/link";

const COLS = [
  {
    title: "Product",
    links: [
      { label: "Start free", href: "/auth?redirect=/app" },
      { label: "Pricing", href: "/pricing" },
      { label: "Compare", href: "/compare" },
      { label: "Solana Atlas", href: "/atlas" },
      { label: "Guides", href: "/guides" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Developers", href: "/developers" },
      { label: "MCP server", href: "/developers/mcp" },
      { label: "REST API", href: "/developers/api" },
      { label: "OpenAPI spec", href: "/openapi.json" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
      { label: "Refunds", href: "/legal/refunds" },
      { label: "Cookies", href: "/legal/cookies" },
    ],
  },
];

const SOCIALS = [
  { label: "X", href: "https://x.com/dreyvapp" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/dreyv/" },
  { label: "Crunchbase", href: "https://www.crunchbase.com/organization/dreyv" },
];

/*
 * Footer: hand-inked vignettes on a dotted path (people at work and rest,
 * dreyv agents as small violet robots carrying the work between them).
 * Desktop uses one wide drawing pinned to the bottom edge; phones use a top
 * piece, a repeating dotted-line tile down the left edge and a bottom piece.
 * All art is decorative and hidden from assistive tech.
 */
export function SiteFooter() {
  return (
    <footer className="mk-footer">
      {/* eslint-disable @next/next/no-img-element */}
      <picture className="mk-ft-art mk-ft-art-d" aria-hidden="true">
        <source
          type="image/avif"
          srcSet="/art/footer-ink-1440.avif 1440w, /art/footer-ink-2400.avif 2400w"
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet="/art/footer-ink-1440.webp 1440w, /art/footer-ink-2400.webp 2400w"
          sizes="100vw"
        />
        <img
          src="/art/footer-ink-1440.webp"
          alt=""
          width={2400}
          height={1018}
          loading="lazy"
          decoding="async"
        />
      </picture>
      <picture className="mk-ft-art mk-ft-art-m mk-ft-art-m-top" aria-hidden="true">
        <source type="image/avif" srcSet="/art/footer-ink-m-top.avif" />
        <img
          src="/art/footer-ink-m-top.webp"
          alt=""
          width={768}
          height={460}
          loading="lazy"
          decoding="async"
        />
      </picture>
      <div className="mk-ft-art mk-ft-art-m mk-ft-art-m-mid" aria-hidden="true" />
      <picture className="mk-ft-art mk-ft-art-m mk-ft-art-m-bot" aria-hidden="true">
        <source type="image/avif" srcSet="/art/footer-ink-m-bottom.avif" />
        <img
          src="/art/footer-ink-m-bottom.webp"
          alt=""
          width={768}
          height={416}
          loading="lazy"
          decoding="async"
        />
      </picture>

      <div className="mk-ft-inner">
        <div className="mk-ft-brand">
          <Link href="/" className="mk-ft-logo" aria-label="dreyv home">
            <img src="/art/dreyv-logo.webp" alt="dreyv" width={300} height={79} loading="lazy" />
          </Link>
          {/* eslint-enable @next/next/no-img-element */}
          <p className="mk-ft-tag">
            Treasury operations for teams on Solana, simulated before anyone signs.
          </p>
          <p className="mk-ft-place">Nicosia, Cyprus</p>
        </div>

        <nav className="mk-ft-cols" aria-label="Footer">
          {COLS.map((c) => (
            <div className="mk-ft-col" key={c.title}>
              <h2>{c.title}</h2>
              <ul>
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mk-ft-col">
            <h2>Contact</h2>
            <address className="mk-ft-mail">
              <dl>
                <div>
                  <dt>General</dt>
                  <dd>
                    <a href="mailto:hello@dreyv.app">hello@dreyv.app</a>
                  </dd>
                </div>
                <div>
                  <dt>Samuel</dt>
                  <dd>
                    <a href="mailto:samuel@dreyv.com">samuel@dreyv.com</a>
                  </dd>
                </div>
              </dl>
            </address>
          </div>
        </nav>

        <div className="mk-ft-bar">
          <ul className="mk-socials" aria-label="dreyv on social media">
            {SOCIALS.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mk-ft-copy">&copy; {new Date().getFullYear()} dreyv</p>
        </div>
      </div>
    </footer>
  );
}
