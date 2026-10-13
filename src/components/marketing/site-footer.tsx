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

export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-top">
        <div className="mk-footer-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="mk-footer-mascot"
            src="/art/mascot-greet.webp"
            alt="The dreyv mascot, a violet fox, waving"
            width={291}
            height={360}
            loading="lazy"
            decoding="async"
          />
          <div>
            <Link href="/" className="mk-logo" aria-label="dreyv home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art/dreyv-logo.webp" alt="dreyv" width={300} height={79} loading="lazy" />
            </Link>
            <p className="mk-small" style={{ marginTop: 14, maxWidth: "32ch" }}>
              Treasury operations for teams on Solana, simulated before anyone signs.
            </p>
            <address className="mk-small" style={{ fontStyle: "normal", marginTop: 14 }}>
              Nicosia, Cyprus
              <br />
              General: <a href="mailto:hello@dreyv.app">hello@dreyv.app</a>
              <br />
              Samuel: <a href="mailto:samuel@dreyv.com">samuel@dreyv.com</a>
            </address>
          </div>
        </div>
        <div className="mk-footer-cols">
          {COLS.map((c) => (
            <div key={c.title}>
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
        </div>
      </div>
      <div className="mk-footer-bottom">
        <span>&copy; {new Date().getFullYear()} dreyv</span>
        <ul className="mk-socials">
          {SOCIALS.map((s) => (
            <li key={s.href}>
              <a href={s.href} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
