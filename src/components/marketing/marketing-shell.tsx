import type { ReactNode } from "react";
import { newsreader, inter } from "./fonts";
import { SiteFooter } from "./site-footer";
import "./marketing.css";

/** Frame for every redesigned marketing page: fonts, skip link, main landmark, footer. */
export function MarketingShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className={`mk ${newsreader.variable} ${inter.variable}`}>
      <a href="#content" className="mk-skip">
        Skip to content
      </a>
      {header}
      <main id="content" tabIndex={-1} className="mk-main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
