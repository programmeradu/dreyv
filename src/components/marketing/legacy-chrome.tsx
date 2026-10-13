import { newsreader, inter } from "./fonts";
import { SiteHeader as Header } from "./site-header";
import { SiteFooter as Footer } from "./site-footer";
import "./marketing.css";

/**
 * New header and footer for pages whose bodies have not been redesigned yet
 * (API reference, changelog, legal, marketplace and similar). Same names as the
 * old components so a page only swaps its import path.
 */
export function SiteHeader() {
  return (
    <div className={`mk mk-chrome ${newsreader.variable} ${inter.variable}`}>
      <Header />
    </div>
  );
}

export function SiteFooter() {
  return (
    <div className={`mk mk-chrome ${newsreader.variable} ${inter.variable}`}>
      <Footer />
    </div>
  );
}
