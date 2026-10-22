import type { CSSProperties, ReactNode } from 'react';
import {
  blockOptionClasses,
  embedBox,
  EMBED_SANDBOX,
  learnEmbedSrc,
  focalPosition,
  hasLearnImage,
  tocEntries,
  type LearnBlock,
  type LearnPageContent,
} from '@kgc/shared';
import { LearnCountdown, LearnGallery, LearnTabs, type GalleryImage } from './interactive';
import { Button, imageOptimized, imageSrc, ItemLink, Picture, SmartLink, takePriority, type BlockCtx } from './parts';
import { RichBlocks, RichInline, RichTable, richHasText } from './rich';

/** The v2 block kinds this folder draws. */
export const V2_BLOCK_KINDS = [
  'imageText',
  'gallery',
  'quote',
  'callout',
  'accordion',
  'tabs',
  'stats',
  'cards',
  'logos',
  'embed',
  'countdown',
  'table',
  'toc',
] as const satisfies readonly LearnBlock['kind'][];

export type V2Block = Extract<LearnBlock, { kind: (typeof V2_BLOCK_KINDS)[number] }>;

export function isV2Block(b: LearnBlock): b is V2Block {
  return (V2_BLOCK_KINDS as readonly string[]).includes(b.kind);
}

/**
 * The outer element's class and style for any block, v1 or v2: kind, align,
 * spacing, then the v2 options (`blockOptionClasses`). The website's v1
 * blocks and the dashboard's preview both call this so the options look the
 * same on every kind.
 */
export function blockShell(block: LearnBlock, ...extra: string[]): { className: string; style?: CSSProperties } {
  const opts = blockOptionClasses(block);
  const className = [
    'lp-block',
    `lp-${block.kind}`,
    block.align ? `lp-a-${block.align}` : '',
    block.spaceAbove ? `lp-sa-${block.spaceAbove}` : '',
    block.spaceBelow ? `lp-sb-${block.spaceBelow}` : '',
    ...extra,
    ...opts.classes,
  ]
    .filter(Boolean)
    .join(' ');
  return { className, style: opts.color ? { color: opts.color } : undefined };
}

/** Attributes every block's outer element carries: its anchor and its id for the editor's selection. */
export function blockAttrs(block: LearnBlock, ...extra: string[]) {
  const { className, style } = blockShell(block, ...extra);
  return { className, style, id: block.anchor, 'data-block-id': block.id };
}

/**
 * One v2 block. `content` is the whole page, which only the table of contents
 * reads. A `reusable` block is not drawn: Publish expands it (T315), and the
 * dashboard expands the draft before previewing.
 */
export function LearnV2Block({ block, ctx, content }: { block: V2Block; ctx: BlockCtx; content?: LearnPageContent }) {
  switch (block.kind) {
    case 'imageText':
      return (
        <div {...blockAttrs(block, `lp-it-${block.imageSide}`, `lp-it-${block.imageWidth}`)}>
          <div className="lp-it-media">
            <Picture image={block.image} ctx={ctx} className={`lp-shape-${block.shape}`} sizes="(width < 860px) 100vw, 50vw" />
          </div>
          <div className="lp-it-body">
            <RichBlocks value={block.text} />
            {block.buttons && block.buttons.length > 0 && (
              <div className="lp-it-buttons">
                {block.buttons.map((b, i) => (
                  <Button key={i} button={b} />
                ))}
              </div>
            )}
          </div>
        </div>
      );

    case 'gallery': {
      const images: GalleryImage[] = block.images.map((im) => ({
        id: im.id,
        src: imageSrc(im, ctx),
        alt: im.alt,
        width: im.width,
        height: im.height,
        caption: im.caption,
        objectPosition: focalPosition(im),
        unoptimized: !imageOptimized(im, ctx),
        priority: takePriority(ctx),
      }));
      return (
        <div {...blockAttrs(block, `lp-gallery-${block.layout}-block`)}>
          <LearnGallery images={images} layout={block.layout} columns={block.columns} lightbox={block.lightbox} />
        </div>
      );
    }

    case 'quote':
      return (
        <figure {...blockAttrs(block, `lp-quote-${block.style}`)}>
          <blockquote>
            <RichBlocks value={block.text} />
          </blockquote>
          {(block.name || hasLearnImage(block.photo)) && (
            <figcaption>
              {hasLearnImage(block.photo) && <Picture image={block.photo} ctx={ctx} alt={block.photo.alt || block.name || ''} className="lp-quote-photo" sizes="64px" />}
              <span>
                {block.name && <span className="lp-quote-name">{block.name}</span>}
                {block.role && <span className="lp-quote-role">{block.role}</span>}
              </span>
            </figcaption>
          )}
        </figure>
      );

    case 'callout':
      return (
        <div {...blockAttrs(block, `lp-tone-${block.tone}`)} role="note">
          <CalloutIcon tone={block.tone} />
          <div className="lp-callout-body">
            {block.title && <p className="lp-callout-title">{block.title}</p>}
            {richHasText(block.text) && <RichBlocks value={block.text} />}
          </div>
        </div>
      );

    case 'accordion': {
      // Native `<details>`: keyboard and screen reader behaviour come with the
      // element. Sharing a `name` makes them exclusive (one open at a time).
      const firstOpen = block.items.findIndex((it) => it.open);
      return (
        <div {...blockAttrs(block)}>
          {block.items.map((it, i) => (
            <details
              key={it.id}
              className="lp-acc-item"
              name={block.allowMany ? undefined : `lp-acc-${block.id}`}
              open={block.allowMany ? it.open : i === firstOpen}
            >
              <summary>
                <span>{it.title}</span>
                <svg className="lp-acc-chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="lp-acc-body">
                <RichBlocks value={it.text} />
              </div>
            </details>
          ))}
        </div>
      );
    }

    case 'tabs':
      return (
        <div {...blockAttrs(block)}>
          <LearnTabs titles={block.items.map((it) => it.title)}>
            {block.items.map((it) => (
              <RichBlocks key={it.id} value={it.text} />
            ))}
          </LearnTabs>
        </div>
      );

    case 'stats':
      return (
        <ul {...blockAttrs(block, `lp-cols-${block.columns}`)}>
          {block.items.map((it) => (
            <li key={it.id}>
              <span className="lp-stat-value">{it.value}</span>
              {it.label && <span className="lp-stat-label">{it.label}</span>}
            </li>
          ))}
        </ul>
      );

    case 'cards':
      return (
        <ul {...blockAttrs(block, `lp-cols-${block.columns}`)}>
          {block.items.map((it) => (
            <li key={it.id} className="lp-card">
              {hasLearnImage(it.image) && <Picture image={it.image} ctx={ctx} className="lp-card-image" sizes="(width < 860px) 100vw, 33vw" />}
              <div className="lp-card-body">
                {it.badge && <span className="lp-card-badge">{it.badge}</span>}
                <h3>{it.title}</h3>
                {richHasText(it.text) && <RichBlocks value={it.text} />}
                {it.link && (
                  <p className="lp-card-link">
                    <ItemLink link={it.link} />
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      );

    case 'logos':
      return (
        <ul {...blockAttrs(block, block.grayscale ? 'lp-logos-gray' : '')}>
          {block.items.map((it) => {
            const pic = <Picture image={it} ctx={ctx} sizes="200px" />;
            return <li key={it.id}>{it.href ? <SmartLink href={it.href}>{pic}</SmartLink> : pic}</li>;
          })}
        </ul>
      );

    case 'embed': {
      // T315's allowlist turns the stored link into the frame address; the
      // stored link itself never goes into the iframe.
      const src = learnEmbedSrc(block.provider, block.url);
      if (!src) return null;
      const box = embedBox(block);
      return (
        <div {...blockAttrs(block, `lp-embed-${block.provider}`)}>
          <div
            className="lp-embed-frame"
            style={box.ratio ? { aspectRatio: box.ratio } : { height: `${box.height}px` }}
          >
            <iframe
              src={src}
              title={block.title}
              loading="lazy"
              sandbox={EMBED_SANDBOX}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      );
    }

    case 'countdown':
      return (
        <div {...blockAttrs(block)}>
          {block.label && <p className="lp-countdown-label">{block.label}</p>}
          <time dateTime={new Date(block.until).toISOString()} className="lp-countdown-time">
            <LearnCountdown until={block.until} now={ctx.now} doneText={block.doneText} />
          </time>
        </div>
      );

    case 'table': {
      const table = block.doc.content.find((n) => n.type === 'table');
      if (!table || table.type !== 'table') return null;
      return (
        <div {...blockAttrs(block)}>
          <RichTable node={table} caption={block.caption} striped={block.striped} />
        </div>
      );
    }

    case 'toc': {
      const entries = content ? tocEntries(content, ctx.headingIds) : [];
      if (entries.length === 0) return null;
      return (
        <nav {...blockAttrs(block)} aria-label={block.title || 'On this page'}>
          {block.title && <p className="lp-toc-title">{block.title}</p>}
          <ol>
            {entries.map((e) => (
              <li key={e.id} className={`lp-toc-l${e.level}`}>
                <a href={`#${e.id}`}>{e.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      );
    }

    default:
      return null;
  }
}

/** A heading block's text, for v1 and v2 alike. */
export function HeadingText({ block }: { block: Extract<LearnBlock, { kind: 'heading' }> }): ReactNode {
  return <RichInline value={block.text} />;
}

function CalloutIcon({ tone }: { tone: 'info' | 'success' | 'warning' | 'brand' }) {
  const d = {
    info: 'M12 8h.01M11 12h1v5h1',
    success: 'M8 12.5l2.5 2.5L16 9.5',
    warning: 'M12 8v5M12 16h.01',
    brand: 'M12 7l1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 15.2 8.8 16.9l.6-3.6-2.6-2.5 3.6-.5z',
  }[tone];
  return (
    <svg className="lp-callout-icon" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
