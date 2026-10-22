'use client';

import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import type { LearnBlock, LearnPageContent } from '@kgc/shared';
import { EMBED_PROVIDERS, embedSrc, type BlockOf } from '@/lib/learn-editor-core';
import { pageAnchors } from '@/lib/learn-tools-core';
import { ButtonRow, Picture, TextLink } from './preview-parts';
import { RichBlocks, RichLine } from './preview-rich';

/**
 * The 14 v2 block kinds in the editor preview (T318).
 *
 * ── Interim ──────────────────────────────────────────────────────────────────
 * T319 builds pixel twins of the website's v2 blocks in `preview-blocks/`.
 * These are close enough to edit against, laid out with the same `lp-` rules
 * as v1, and keyed by kind in `V2_BODIES` so integration replaces one entry at
 * a time: `V2_BODIES.gallery = (p) => <T319Gallery block={p.block} ... />`.
 * The shell around them (selection, tags, hidden state, columns) stays here.
 */

export interface V2BodyProps<K extends LearnBlock['kind']> {
  block: BlockOf<K>;
  siteOrigin: string;
  selected: boolean;
}

/**
 * The whole draft, for the one block that reads beyond itself (contents).
 * A context rather than a prop, so typing in one block does not re-render
 * every memoised block on the page.
 */
export const PreviewContentContext = createContext<LearnPageContent | null>(null);

type Bodies = { [K in LearnBlock['kind']]?: (p: V2BodyProps<K>) => ReactNode };

function cols(n: number): CSSProperties {
  return { ['--lp-cols' as string]: n, ['--lp-cols-t' as string]: Math.min(n, 2) };
}

function Gallery({ block, siteOrigin }: V2BodyProps<'gallery'>) {
  const [at, setAt] = useState(0);
  if (block.images.length === 0) return <div className="lp-img-empty lp-v2-empty">Gallery: add photos in the panel</div>;
  if (block.layout === 'carousel') {
    const i = Math.min(at, block.images.length - 1);
    const im = block.images[i];
    return (
      <figure className="lp-v2-carousel">
        <Picture image={im} shape="original" siteOrigin={siteOrigin} />
        {im.caption && <figcaption className="lp-caption">{im.caption}</figcaption>}
        <div className="lp-v2-dots">
          {block.images.map((x, j) => (
            <button
              key={x.id}
              type="button"
              aria-label={`Photo ${j + 1}`}
              className={j === i ? 'is-on' : ''}
              onClick={(e) => {
                e.stopPropagation();
                setAt(j);
              }}
            />
          ))}
        </div>
      </figure>
    );
  }
  return (
    <div className={`lp-v2-gallery lp-v2-gallery-${block.layout}`} style={cols(block.columns)}>
      {block.images.map((im) => (
        <figure key={im.id}>
          <Picture image={im} shape={block.layout === 'grid' ? 'square' : 'original'} siteOrigin={siteOrigin} />
          {im.caption && <figcaption className="lp-caption">{im.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function Accordion({ block }: V2BodyProps<'accordion'>) {
  return (
    <div className="lp-v2-accordion">
      {block.items.map((it) => (
        <details key={it.id} open={it.open}>
          <summary>{it.title || 'Question'}</summary>
          <div className="lp-text">
            <RichBlocks value={it.text} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Tabs({ block }: V2BodyProps<'tabs'>) {
  const [at, setAt] = useState(0);
  const i = Math.min(at, Math.max(0, block.items.length - 1));
  const cur = block.items[i];
  return (
    <div className="lp-v2-tabs">
      <div className="lp-v2-tablist" role="tablist">
        {block.items.map((it, j) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={j === i}
            onClick={(e) => {
              e.stopPropagation();
              setAt(j);
            }}
          >
            {it.title || `Tab ${j + 1}`}
          </button>
        ))}
      </div>
      {cur && (
        <div className="lp-v2-tabpanel lp-text" role="tabpanel">
          <RichBlocks value={cur.text} />
        </div>
      )}
    </div>
  );
}

function Countdown({ block }: V2BodyProps<'countdown'>) {
  // Fixed at render: the preview is a picture of the page, not a ticking clock.
  const [now] = useState(() => Date.now());
  const left = block.until - now;
  if (!block.until) return <div className="lp-v2-empty lp-img-empty">Countdown: choose a date in the panel</div>;
  if (left <= 0) return <p className="lp-v2-countdown-done">{block.doneText || 'It has started.'}</p>;
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return (
    <div className="lp-v2-countdown">
      {block.label && <p className="lp-v2-countdown-label">{block.label}</p>}
      <div className="lp-v2-countdown-units">
        {[
          [d, 'days'],
          [h, 'hours'],
          [m, 'minutes'],
        ].map(([n, unit]) => (
          <span key={unit}>
            <strong>{n}</strong>
            {unit}
          </span>
        ))}
      </div>
    </div>
  );
}

function Toc({ block }: V2BodyProps<'toc'>) {
  const content = useContext(PreviewContentContext) ?? { seoTitle: '', seoDescription: '', sections: [] };
  const anchors = pageAnchors(content);
  const headings = content.sections
    .filter((s) => !s.hidden)
    .flatMap((s) =>
      s.blocks
        .filter((b) => !b.hidden && b.kind === 'heading' && b.anchor)
        .map((b) => ({ anchor: b.anchor as string, text: (b as BlockOf<'heading'>).text })),
    );
  return (
    <nav className="lp-v2-toc" aria-label={block.title || 'On this page'}>
      {block.title && <p className="lp-v2-toc-title">{block.title}</p>}
      {headings.length === 0 && anchors.length === 0 ? (
        <p className="lp-v2-muted">Give headings a link name and they appear here.</p>
      ) : (
        <ul>
          {(headings.length ? headings : anchors.map((a) => ({ anchor: a.anchor, text: a.label }))).map((h) => (
            <li key={h.anchor}>
              <a href={`#${h.anchor}`}>
                <RichLine value={h.text} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export const V2_BODIES: Bodies = {
  imageText: ({ block, siteOrigin }) => (
    <div className={`lp-v2-imagetext is-${block.imageSide} is-${block.imageWidth}`}>
      <div className="lp-v2-imagetext-img">
        <Picture image={block.image} shape={block.shape} siteOrigin={siteOrigin} />
      </div>
      <div className="lp-v2-imagetext-text lp-text">
        <RichBlocks value={block.text} />
        {block.buttons && block.buttons.length > 0 && <ButtonRow buttons={block.buttons} />}
      </div>
    </div>
  ),
  gallery: (p) => <Gallery {...p} />,
  quote: ({ block, siteOrigin }) => (
    <figure className={`lp-v2-quote is-${block.style}`}>
      <blockquote className="lp-text">
        <RichBlocks value={block.text} />
      </blockquote>
      {(block.name || block.photo?.src) && (
        <figcaption>
          {block.photo?.src && <Picture image={block.photo} shape="circle" siteOrigin={siteOrigin} className="lp-v2-quote-photo" />}
          <span>
            {block.name && <strong>{block.name}</strong>}
            {block.role && <span className="lp-v2-muted">{block.role}</span>}
          </span>
        </figcaption>
      )}
    </figure>
  ),
  callout: ({ block }) => (
    <aside className={`lp-v2-callout is-${block.tone}`}>
      {block.title && <p className="lp-v2-callout-title">{block.title}</p>}
      <div className="lp-text">
        <RichBlocks value={block.text} />
      </div>
    </aside>
  ),
  accordion: (p) => <Accordion {...p} />,
  tabs: (p) => <Tabs {...p} />,
  stats: ({ block }) => (
    <div className="lp-v2-stats" style={cols(block.columns)}>
      {block.items.map((it) => (
        <div key={it.id}>
          <strong>{it.value}</strong>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  ),
  cards: ({ block, siteOrigin }) => (
    <div className="lp-v2-cards" style={cols(block.columns)}>
      {block.items.map((it) => (
        <article key={it.id} className="lp-v2-card">
          {it.image && <Picture image={it.image} shape="original" siteOrigin={siteOrigin} fill className="lp-v2-card-img" />}
          <div className="lp-v2-card-body">
            {it.badge && <span className="lp-v2-badge">{it.badge}</span>}
            <h3 className="lp-col-title">{it.title}</h3>
            <div className="lp-text">
              <RichBlocks value={it.text} />
            </div>
            {it.link && <TextLink link={it.link} />}
          </div>
        </article>
      ))}
    </div>
  ),
  logos: ({ block, siteOrigin }) =>
    block.items.length === 0 ? (
      <div className="lp-img-empty lp-v2-empty">Logos: add them in the panel</div>
    ) : (
      <div className={`lp-v2-logos${block.grayscale ? ' is-grey' : ''}`}>
        {block.items.map((it) => (
          <Picture key={it.id} image={it} shape="original" siteOrigin={siteOrigin} />
        ))}
      </div>
    ),
  embed: ({ block, selected }) => {
    const src = embedSrc(block.provider, block.url);
    const ratio = block.aspect === 'auto' ? undefined : block.aspect.replace(':', ' / ');
    return src ? (
      <iframe
        className="lp-v2-embed"
        src={src}
        title={block.title || EMBED_PROVIDERS[block.provider].label}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ aspectRatio: ratio, height: block.aspect === 'auto' ? block.height ?? 480 : undefined, pointerEvents: selected ? undefined : 'none' }}
      />
    ) : (
      <div className="lp-video-empty">Paste a {EMBED_PROVIDERS[block.provider].label} link in the panel</div>
    );
  },
  countdown: (p) => <Countdown {...p} />,
  table: ({ block }) => (
    <figure className={`lp-v2-table${block.striped ? ' is-striped' : ''}`}>
      <div className="lp-text">
        <RichBlocks value={block.doc} />
      </div>
      {block.caption && <figcaption className="lp-caption">{block.caption}</figcaption>}
    </figure>
  ),
  toc: (p) => <Toc {...p} />,
  reusable: ({ block }) => (
    <div className="lp-v2-reusable">
      {block.libraryId ? 'Saved section from your library. It shows here as it is in the library.' : 'Choose a saved section in the panel.'}
    </div>
  ),
};

/** The body of a v2 block, or null for a v1 kind. */
export function V2Body(props: { block: LearnBlock; siteOrigin: string; selected: boolean }) {
  const render = V2_BODIES[props.block.kind] as ((p: V2BodyProps<LearnBlock['kind']>) => ReactNode) | undefined;
  if (!render) return null;
  return <>{render(props as V2BodyProps<LearnBlock['kind']>)}</>;
}
