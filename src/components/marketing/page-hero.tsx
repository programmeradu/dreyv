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
 * fading up into the paper. Exactly one screen tall at every size (compact: a short band).
 */
export function PageHero({ art, title, sub, actions, meta, compact = false, id = "hero-title" }: Props) {
  const [l, t, r] = PAGE_ART[art].box;
  const style = { "--mk-hero-bg": PAGE_ART[art].bg } as CSSProperties;
  const artStyle = {
    "--art-top": t,
    "--art-sw": +(r - l).toFixed(3),
    "--art-cx": +((l + r) / 2).toFixed(3),
  } as CSSProperties;
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
      <div className="mk-phero-art" style={artStyle}>
        <PageArtPicture art={art} />
      </div>
    </section>
  );
}
