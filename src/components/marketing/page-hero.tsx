import type { CSSProperties, ReactNode } from "react";
import { PAGE_ART, PageArtPicture, PageArtPreload, type ArtKey } from "./art";

type Props = {
  art: ArtKey;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  /** Shorter art band, for long reading pages such as single guides. */
  compact?: boolean;
  id?: string;
};

/**
 * Inner-page hero: headline and actions on paper, the page's own still life below,
 * fading up into the paper. Fits inside the first screen at every size.
 */
export function PageHero({ art, title, sub, actions, meta, compact = false, id = "hero-title" }: Props) {
  const style = { "--mk-hero-bg": PAGE_ART[art].bg } as CSSProperties;
  return (
    <section className={compact ? "mk-phero mk-phero-compact" : "mk-phero"} aria-labelledby={id} style={style}>
      <PageArtPreload art={art} />
      <div className="mk-phero-copy hero-copy">
        <h1 id={id} className="mk-h1 mk-rise">
          {title}
        </h1>
        {sub ? <p className="mk-phero-sub mk-rise mk-rise-2">{sub}</p> : null}
        {actions ? <div className="mk-actions mk-rise mk-rise-3">{actions}</div> : null}
        {meta ? <p className="mk-phero-meta">{meta}</p> : null}
      </div>
      <div className="mk-phero-art">
        <PageArtPicture art={art} />
      </div>
    </section>
  );
}
