import Link from "next/link";

const NAV = [
  { label: "Product", href: "/#product" },
  { label: "Atlas", href: "/atlas" },
  { label: "Developers", href: "/developers" },
  { label: "Pricing", href: "/pricing" },
];

type Props = {
  /** Sit on top of the hero instead of taking space in the flow. */
  overlay?: boolean;
  /** Path of the current page, for aria-current. */
  current?: string;
};

export function SiteHeader({ overlay = false, current }: Props) {
  return (
    <header className={overlay ? "mk-header mk-header-overlay" : "mk-header"}>
      <div className="mk-header-inner">
        <Link href="/" className="mk-logo" aria-label="dreyv home">
          <span className="mk-wordmark" aria-hidden="true">
            dreyv
          </span>
        </Link>
        <nav className="mk-nav" aria-label="Primary">
          {NAV.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mk-header-end">
          <details className="mk-menu">
            <summary>Menu</summary>
            <nav className="mk-menu-panel" aria-label="Menu">
              {NAV.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
              <Link href="/guides">Guides</Link>
              <Link href="/about">About</Link>
            </nav>
          </details>
          <Link href="/auth" className="mk-signin">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
