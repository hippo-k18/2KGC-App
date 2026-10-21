import Image from 'next/image';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  focalPosition,
  isStorageImageSrc,
  learnRichParagraphs,
  videoEmbed,
  type InlineSpan,
  type LearnBlock,
  type LearnPageContent,
  type LearnSection,
  type LinkButton,
  type PageImage,
  type Person,
} from '@kgc/shared';
import { LinkedIn } from './linkedin-icon';
import './learn-page-view.css';

/**
 * The KGC | Learn page drawn from data (`pageLayouts/learn`), T311.
 *
 * Plain React with no server-only import, so the dashboard's editor can render
 * the same component as its preview. Every option in the contract is a class
 * (`lp-*` in `learn-page-view.css`), never free CSS, so an edit can change the
 * look only in the ways the brand allows.
 *
 * The content is expected to have been through `parseLearnPageContent` (the
 * /learn route does that), but hidden sections and blocks are skipped here too,
 * so the editor can hand it a raw draft.
 *
 * Text goes through `rich-text-core`'s span parser and into text nodes. There
 * is no `dangerouslySetInnerHTML` anywhere on this path.
 */
export interface LearnPageViewProps {
  content: LearnPageContent;
  /**
   * Prefix for site asset paths (`/kgc/...`): empty on the website, the
   * website's origin in the dashboard, which does not serve those files.
   */
  assetOrigin?: string;
  /**
   * `optimize` sends Storage images through `next/image`'s optimizer, which
   * needs the host in `next.config.ts` `images.remotePatterns` (the website
   * has it). `plain` serves them as they are, for an app without that config.
   */
  remoteImages?: 'optimize' | 'plain';
}

interface Ctx {
  assetOrigin: string;
  remoteImages: 'optimize' | 'plain';
  /** Mutable: the first image on the page loads with priority. */
  firstImage: { used: boolean };
}

export function LearnPageView({ content, assetOrigin = '', remoteImages = 'plain' }: LearnPageViewProps) {
  const sections = content.sections.filter((s) => !s.hidden && s.blocks.some((b) => !b.hidden));
  const ctx: Ctx = { assetOrigin, remoteImages, firstImage: { used: false } };

  // The page needs one h1. A level-1 heading block is it; otherwise the image
  // in the first wave (today's wordmark) is, as on the hand-built page; and
  // failing both, the page title, for screen readers only.
  const hasH1 = sections.some((s) => s.blocks.some((b) => !b.hidden && b.kind === 'heading' && b.level === 1));
  const artSection = hasH1 ? undefined : sections.find((s) => s.waveBehindFirstImage && artIndex(s) >= 0);

  return (
    <>
      {!hasH1 && !artSection && <h1 className="sr-only">{content.seoTitle}</h1>}
      {sections.map((s) => (
        <Section key={s.id} section={s} ctx={ctx} artIsH1={s === artSection} />
      ))}
    </>
  );
}

function artIndex(section: LearnSection): number {
  if (!section.waveBehindFirstImage) return -1;
  return section.blocks.findIndex((b) => !b.hidden && b.kind === 'image');
}

const WAVES: Partial<Record<LearnSection['background'], string>> = {
  'white-wave': '/kgc/wave-3.png',
  'light-blue-wave': '/kgc/wave-3.png',
  'grey-wave': '/kgc/wave-13.png',
};

function Section({ section, ctx, artIsH1 }: { section: LearnSection; ctx: Ctx; artIsH1: boolean }) {
  const blocks = section.blocks.filter((b) => !b.hidden);
  const art = artIndex({ ...section, blocks });
  const before = art >= 0 ? blocks.slice(0, art) : blocks;
  const after = art >= 0 ? blocks.slice(art + 1) : [];
  const artBlock = art >= 0 ? blocks[art] : undefined;

  const wave = WAVES[section.background];
  const style =
    wave && ctx.assetOrigin ? ({ '--lp-wave': `url("${ctx.assetOrigin}${wave}")` } as CSSProperties) : undefined;

  const className = [
    'lp-band',
    `lp-bg-${section.background}`,
    art >= 0 ? 'lp-wave-art' : '',
    `lp-pt-${section.paddingTop}`,
    `lp-pb-${section.paddingBottom}`,
  ]
    .filter(Boolean)
    .join(' ');

  const wrap = (list: LearnBlock[]) =>
    list.length > 0 && (
      <div className={`wrap-kgc lp-width-${section.width}`}>
        {list.map((b) => (
          <Block key={b.id} block={b} ctx={ctx} />
        ))}
      </div>
    );

  return (
    <section className={className} style={style} data-section={section.id}>
      {wrap(before)}
      {artBlock?.kind === 'image' && (
        <div className="lp-art">
          {artIsH1 ? (
            <h1 className="lp-art-inner">
              <Picture image={artBlock.image} ctx={ctx} className={`lp-iw-${artBlock.width}`} />
            </h1>
          ) : (
            <div className="lp-art-inner">
              <Picture image={artBlock.image} ctx={ctx} className={`lp-iw-${artBlock.width}`} />
            </div>
          )}
        </div>
      )}
      {wrap(after)}
    </section>
  );
}

function blockClass(block: LearnBlock, ...extra: string[]): string {
  return [
    'lp-block',
    `lp-${block.kind}`,
    block.align ? `lp-a-${block.align}` : '',
    block.spaceAbove ? `lp-sa-${block.spaceAbove}` : '',
    block.spaceBelow ? `lp-sb-${block.spaceBelow}` : '',
    ...extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function Block({ block, ctx }: { block: LearnBlock; ctx: Ctx }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      const size = block.size ?? (block.level === 1 ? 'x-large' : block.level === 2 ? 'large' : 'normal');
      return (
        <Tag className={blockClass(block, `lp-hs-${size}`)}>
          <Lines paragraphs={learnRichParagraphs(block.text)} />
        </Tag>
      );
    }

    case 'text':
      return (
        <div className={blockClass(block, `lp-ts-${block.size ?? 'normal'}`)}>
          {learnRichParagraphs(block.text).map((lines, i) => (
            <p key={i}>
              <Lines paragraphs={[lines]} />
            </p>
          ))}
        </div>
      );

    case 'image': {
      const picture = (
        <Picture
          image={block.image}
          ctx={ctx}
          className={`lp-shape-${block.shape}`}
        />
      );
      return (
        <figure className={blockClass(block, `lp-iw-${block.width}`)}>
          {block.href ? <SmartLink href={block.href}>{picture}</SmartLink> : picture}
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }

    case 'buttons':
      return (
        <div className={blockClass(block)}>
          {block.buttons.map((b, i) => (
            <Button key={i} button={b} />
          ))}
        </div>
      );

    case 'people':
      return block.style === 'list' ? (
        <div className={blockClass(block, 'lp-people-list', `lp-cols-${block.columns}`)}>
          {block.people.map((p) => (
            <div key={p.id}>
              <span className="name">{p.name}</span>
              {p.role && <span className="role">{p.role}</span>}
              {p.bio && <Bio text={p.bio} />}
              <LinkedIn href={p.linkedin} />
            </div>
          ))}
        </div>
      ) : (
        <div className={blockClass(block, 'lp-people-cards', `lp-cols-${block.columns}`)}>
          {block.people.map((p) => (
            <PersonCard key={p.id} person={p} ctx={ctx} />
          ))}
        </div>
      );

    case 'list': {
      const items = block.items.map((it) => (
        <li key={it.id}>
          {it.title && (
            <>
              <strong>{it.title}</strong>{' '}
            </>
          )}
          <Lines paragraphs={learnRichParagraphs(it.text)} />
          {it.link && (
            <>
              {' '}
              {it.link.style === 'text' ? (
                <SmartLink href={it.link.href}>{it.link.label}</SmartLink>
              ) : (
                <Button button={it.link} />
              )}
            </>
          )}
          {it.children && it.children.length > 0 && (
            <ul>
              {it.children.map((c, i) => (
                <li key={i}>
                  <Spans spans={learnRichParagraphs(c)[0]?.flat() ?? []} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ));
      return block.ordered ? (
        <ol className={blockClass(block)}>{items}</ol>
      ) : (
        <ul className={blockClass(block)}>{items}</ul>
      );
    }

    case 'columns':
      return (
        <div className={blockClass(block, `lp-cols-${block.columns}`)}>
          {block.items.map((it) => (
            <div key={it.id} className="lp-column">
              {it.image && <Picture image={it.image} ctx={ctx} className="lp-column-image" />}
              {it.title && <h3>{it.title}</h3>}
              {it.text.trim() !== '' &&
                learnRichParagraphs(it.text).map((lines, i) => (
                  <p key={i}>
                    <Lines paragraphs={[lines]} />
                  </p>
                ))}
              {it.link && (
                <p className="lp-column-link">
                  {it.link.style === 'text' ? (
                    <SmartLink href={it.link.href}>{it.link.label}</SmartLink>
                  ) : (
                    <Button button={it.link} />
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      );

    case 'video': {
      const embed = videoEmbed(block.url);
      if (!embed) return null;
      return (
        <figure className={blockClass(block)}>
          <div className="lp-video-frame">
            <iframe
              src={embed.src}
              title={block.caption || (embed.provider === 'youtube' ? 'YouTube video' : 'Vimeo video')}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }

    case 'divider':
      return <hr className={blockClass(block)} />;

    case 'spacer':
      return <div className={blockClass(block, `lp-space-${block.size}`)} aria-hidden="true" />;

    default:
      return null;
  }
}

function PersonCard({ person, ctx }: { person: Person; ctx: Ctx }) {
  return (
    <div className="lp-person">
      {person.photo && <Picture image={{ ...person.photo, alt: person.photo.alt || person.name }} ctx={ctx} />}
      <div className="row">
        <div>
          <span className="name">{person.name}</span>
          {person.role && <p className="role">{person.role}</p>}
        </div>
        {person.linkedin && <LinkedIn href={person.linkedin} />}
      </div>
      {person.bio && <Bio text={person.bio} />}
    </div>
  );
}

function Bio({ text }: { text: string }) {
  return (
    <div className="bio">
      {learnRichParagraphs(text).map((lines, i) => (
        <p key={i}>
          <Lines paragraphs={[lines]} />
        </p>
      ))}
    </div>
  );
}

function Picture({ image, ctx, className }: { image: PageImage; ctx: Ctx; className?: string }) {
  const local = image.src.startsWith('/');
  const src = local ? `${ctx.assetOrigin}${image.src}` : image.src;
  const optimized = local ? !ctx.assetOrigin : ctx.remoteImages === 'optimize' && isStorageImageSrc(image.src);
  const priority = !ctx.firstImage.used;
  ctx.firstImage.used = true;
  const objectPosition = focalPosition(image);
  return (
    <Image
      src={src}
      alt={image.alt}
      width={image.width}
      height={image.height}
      className={className}
      priority={priority}
      unoptimized={!optimized}
      style={objectPosition ? { objectPosition } : undefined}
    />
  );
}

function Button({ button }: { button: LinkButton }) {
  const cls =
    button.style === 'primary'
      ? 'btn btn-primary lp-btn'
      : button.style === 'secondary'
        ? 'btn btn-secondary lp-btn'
        : 'lp-btn-text';
  return (
    <SmartLink href={button.href} className={cls}>
      {button.label}
    </SmartLink>
  );
}

/** Our own pages and `mailto:` keep the tab; other sites open a new one. */
function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const external = /^https?:\/\//i.test(href);
  return external ? (
    <a href={href} className={className} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** Paragraphs of lines, all joined by line breaks (inside one element). */
function Lines({ paragraphs }: { paragraphs: InlineSpan[][][] }) {
  const lines = paragraphs.flat();
  return (
    <>
      {lines.map((spans, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Spans spans={spans} />
        </Fragment>
      ))}
    </>
  );
}

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.kind) {
          case 'strong':
            return <strong key={i}>{s.text}</strong>;
          case 'em':
            return <em key={i}>{s.text}</em>;
          case 'code':
            return <code key={i}>{s.text}</code>;
          case 'link':
            return (
              <SmartLink key={i} href={s.href}>
                {s.text}
              </SmartLink>
            );
          default:
            return s.text;
        }
      })}
    </>
  );
}
