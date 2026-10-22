'use client';

import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { defaultEmbedTitle, parseLearnSection, tocEntries, type LearnBlock, type LearnPageContent, type LearnSection } from '@kgc/shared';
import { EMBED_PROVIDERS, embedSrc, type BlockOf } from '@/lib/learn-editor-core';
import { pageAnchors } from '@/lib/learn-tools-core';
import { isV2Block, LearnV2Block, type BlockCtx, type V2Block } from './preview-blocks';
import { ButtonRow, Picture, TextLink } from './preview-parts';
import { RichBlocks, RichLine } from './preview-rich';

/**
 * The 14 v2 block kinds in the editor preview.
 *
 * A finished block is drawn by T319's twin of the website's renderer
 * (`preview-blocks/`), so the preview is the page. The twins assume content
 * that `parseLearnPageContent` has already made safe, as it is on the
 * website, but the preview draws the raw draft and old versions (T320). So
 * each block goes through the same parser first (`parseLearnSection`), and
 * the twin draws what comes out. A block the parser drops is one the website
 * would not show (a gallery with no photos, an embed with a link we do not
 * allow, a countdown with no date): the editor still has to show it, so the
 * bodies in `V2_BODIES` (T318) draw it with a hint instead.
 *
 * The shell around every block (`BlockView` in `preview.tsx`) already applies
 * spacing, maximum width, the box, the text colour, the anchor and the
 * screens it shows on, and dims rather than hides a block meant for another
 * width. Those options are taken off the twin's copy so they are not applied
 * twice.
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

/**
 * The twins' render context (`makeBlockCtx`). The preview keeps one object
 * while the heading ids stay the same, so typing does not re-render every
 * block that reads it.
 */
export const PreviewBlockCtxContext = createContext<BlockCtx | null>(null);

/**
 * The saved sections the preview draws from: a map once loaded, null while
 * loading, undefined where nobody passed one (Compare, History). Lets a
 * Saved section block that could not be drawn say why (T325, E F7).
 */
export const PreviewLibraryContext = createContext<ReadonlyMap<string, LearnSection> | null | undefined>(undefined);

function ReusablePlaceholder({ block }: { block: Extract<LearnBlock, { kind: 'reusable' }> }) {
  const library = useContext(PreviewLibraryContext);
  let text = 'Saved section from your library. It shows here as it is in the library.';
  if (!block.libraryId) text = 'Choose a saved section in the panel.';
  else if (library === null) text = 'Loading the saved section...';
  else if (library && !library.has(block.libraryId)) text = 'This saved section was deleted. Remove this block or pick another saved section.';
  else if (library && block.hidden) text = 'Saved section, hidden.';
  const missing = !!library && !!block.libraryId && !library.has(block.libraryId);
  return <div className={`lp-v2-reusable${missing ? ' is-missing' : ''}`}>{text}</div>;
}

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

/** How the editor draws a v2 block the website would not show yet, kind by kind. */
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
        title={block.title || defaultEmbedTitle(block.provider)}
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
  reusable: ({ block }) => <ReusablePlaceholder block={block} />,
};

/** The block as the website would draw it, without the options the shell applies; null when the site would not draw it. */
function twinOf(block: LearnBlock): V2Block | null {
  // `hidden` is the shell's business too: a hidden block is drawn, dimmed.
  const parsed = parseLearnSection({ id: 'preview', blocks: [{ ...block, hidden: false }] })?.blocks[0];
  if (!parsed || parsed.kind !== block.kind || !isV2Block(parsed)) return null;
  const twin: V2Block = { ...parsed };
  delete twin.spaceAbove;
  delete twin.spaceBelow;
  delete twin.maxWidth;
  delete twin.boxed;
  delete twin.textColor;
  delete twin.anchor;
  delete twin.visibleOn;
  return twin;
}

function TocTwin({ block, ctx }: { block: Extract<V2Block, { kind: 'toc' }>; ctx: BlockCtx }) {
  const content = useContext(PreviewContentContext);
  if (!content || tocEntries(content, ctx.headingIds).length === 0) {
    return <p className="lp-v2-muted">Contents: headings on the page are listed here.</p>;
  }
  return <LearnV2Block block={block} ctx={ctx} content={content} />;
}

/** The body of a v2 block, or null for a v1 kind. */
export function V2Body(props: { block: LearnBlock; siteOrigin: string; selected: boolean }) {
  const ctx = useContext(PreviewBlockCtxContext);
  const twin = useMemo(() => (isV2Block(props.block) ? twinOf(props.block) : null), [props.block]);
  if (twin && ctx) {
    return (
      // Tabs, photos, frames and folds answer clicks once the block is
      // selected; before that a click anywhere on it selects it.
      <div className="lp-twin" style={props.selected ? undefined : { pointerEvents: 'none' }}>
        {twin.kind === 'toc' ? <TocTwin block={twin} ctx={ctx} /> : <LearnV2Block block={twin} ctx={ctx} />}
      </div>
    );
  }
  const render = V2_BODIES[props.block.kind] as ((p: V2BodyProps<LearnBlock['kind']>) => ReactNode) | undefined;
  if (!render) return null;
  return <>{render(props as V2BodyProps<LearnBlock['kind']>)}</>;
}
