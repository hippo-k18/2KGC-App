import type { CSSProperties } from 'react';
import {
  headingIds,
  learnRichParagraphs,
  videoEmbed,
  type LearnBlock,
  type LearnPageContent,
  type LearnSection,
  type PageImage,
  type Person,
  type RichContent,
} from '@kgc/shared';
import { blockAttrs, HeadingText, isV2Block, LearnV2Block } from '../../(dash)/content/learn-page/preview-blocks/blocks';
import { Button, ItemLink, Picture as BlockPicture, SmartLink, type BlockCtx } from '../../(dash)/content/learn-page/preview-blocks/parts';
import { MarkdownSpans, RichBlocks, RichInline, richHasText } from '../../(dash)/content/learn-page/preview-blocks/rich';
import { SectionBackground, SectionLayout, sectionShell } from '../../(dash)/content/learn-page/preview-blocks/section';
import { LinkedIn } from './linkedin-icon';
import './learn-page-view.css';
import '../../(dash)/content/learn-page/preview-blocks/learn-blocks.css';

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
 * Text goes through `rich-text-core`'s span parser (v1 Markdown) or the
 * `RichDoc` node renderer (v2) and into elements and text nodes. There is no
 * `dangerouslySetInnerHTML` anywhere on this path.
 *
 * v2 (T319): the fourteen new block kinds, rich documents, and the new block,
 * section and page options live in `./learn-blocks/`, which the dashboard
 * preview copies byte for byte. The page sits in an `lp-page` box that is the
 * size container every v2 phone rule measures, so the dashboard's narrow
 * preview frame gets the phone layout without a narrow window.
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
  /** Server time for the countdown's first paint (defaults to now). */
  now?: number;
}

type Ctx = BlockCtx & { content: LearnPageContent };

export function LearnPageView({ content, assetOrigin = '', remoteImages = 'plain', now }: LearnPageViewProps) {
  const sections = content.sections.filter((s) => !s.hidden && s.blocks.some((b) => !b.hidden));
  const ctx: Ctx = {
    assetOrigin,
    remoteImages,
    firstImage: { used: false },
    headingIds: headingIds(content),
    now: now ?? Date.now(),
    content,
  };

  // The page needs one h1. A level-1 heading block is it; otherwise the image
  // in the first wave (today's wordmark) is, as on the hand-built page; and
  // failing both, the page title, for screen readers only.
  const hasH1 = sections.some((s) => s.blocks.some((b) => !b.hidden && b.kind === 'heading' && b.level === 1));
  const artSection = hasH1 ? undefined : sections.find((s) => s.waveBehindFirstImage && artIndex(s) >= 0);

  return (
    <div className="lp-page">
      {!hasH1 && !artSection && <h1 className="sr-only">{content.seoTitle}</h1>}
      {sections.map((s) => (
        <Section key={s.id} section={s} ctx={ctx} artIsH1={s === artSection} />
      ))}
    </div>
  );
}

function artIndex(section: LearnSection): number {
  // A multi-column section has no single "first image" to put the wave behind.
  if (!section.waveBehindFirstImage || (section.layout && section.layout !== 'single')) return -1;
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
  const shell = sectionShell(section);
  const vars = { ...(wave && ctx.assetOrigin ? { '--lp-wave': `url("${ctx.assetOrigin}${wave}")` } : {}), ...shell.style };
  const style = Object.keys(vars).length ? (vars as CSSProperties) : undefined;

  const className = [
    'lp-band',
    `lp-bg-${section.background}`,
    art >= 0 ? 'lp-wave-art' : '',
    `lp-pt-${section.paddingTop}`,
    `lp-pb-${section.paddingBottom}`,
    ...shell.classes,
  ]
    .filter(Boolean)
    .join(' ');

  const layered = section.layout && section.layout !== 'single';
  const wrap = (list: LearnBlock[]) =>
    list.length > 0 && (
      <div className={`wrap-kgc lp-width-${section.width}`}>
        {layered ? (
          <SectionLayout section={section} blocks={list} render={(b) => <Block key={b.id} block={b} ctx={ctx} />} />
        ) : (
          list.map((b) => <Block key={b.id} block={b} ctx={ctx} />)
        )}
      </div>
    );

  return (
    <section className={className} style={style} data-section={section.id} id={section.anchor}>
      <SectionBackground section={section} ctx={ctx} />
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

function Block({ block, ctx }: { block: LearnBlock; ctx: Ctx }) {
  if (isV2Block(block)) return <LearnV2Block block={block} ctx={ctx} content={ctx.content} />;
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4';
      const size = block.size ?? (block.level === 1 ? 'x-large' : block.level === 2 ? 'large' : 'normal');
      return (
        <Tag {...blockAttrs(block, `lp-hs-${size}`)} id={ctx.headingIds.get(block.id) ?? block.anchor}>
          <HeadingText block={block} />
        </Tag>
      );
    }

    case 'text':
      return (
        <div {...blockAttrs(block, `lp-ts-${block.size ?? 'normal'}`, typeof block.text === 'string' ? '' : 'lp-rich')}>
          <RichBlocks value={block.text} />
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
        <figure {...blockAttrs(block, `lp-iw-${block.width}`)}>
          {block.href ? <SmartLink href={block.href}>{picture}</SmartLink> : picture}
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }

    case 'buttons':
      return (
        <div {...blockAttrs(block)}>
          {block.buttons.map((b, i) => (
            <Button key={i} button={b} />
          ))}
        </div>
      );

    case 'people':
      return block.style === 'list' ? (
        <div {...blockAttrs(block, 'lp-people-list', `lp-cols-${block.columns}`)}>
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
        <div {...blockAttrs(block, 'lp-people-cards', `lp-cols-${block.columns}`)}>
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
          <RichInline value={it.text} />
          {it.link && (
            <>
              {' '}
              <ItemLink link={it.link} />
            </>
          )}
          {it.children && it.children.length > 0 && (
            <ul>
              {it.children.map((c, i) => (
                <li key={i}>
                  <MarkdownSpans spans={learnRichParagraphs(c)[0]?.flat() ?? []} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ));
      return block.ordered ? (
        <ol {...blockAttrs(block)}>{items}</ol>
      ) : (
        <ul {...blockAttrs(block)}>{items}</ul>
      );
    }

    case 'columns':
      return (
        <div {...blockAttrs(block, `lp-cols-${block.columns}`)}>
          {block.items.map((it) => (
            <div key={it.id} className="lp-column">
              {it.image && <Picture image={it.image} ctx={ctx} className="lp-column-image" />}
              {it.title && <h3>{it.title}</h3>}
              {richHasText(it.text) && <RichBlocks value={it.text} />}
              {it.link && (
                <p className="lp-column-link">
                  <ItemLink link={it.link} />
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
        <figure {...blockAttrs(block)}>
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
      return <hr {...blockAttrs(block)} />;

    case 'spacer':
      return <div {...blockAttrs(block, `lp-space-${block.size}`)} aria-hidden="true" />;

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

function Bio({ text }: { text: RichContent }) {
  return (
    <div className="bio">
      <RichBlocks value={text} />
    </div>
  );
}

function Picture({ image, ctx, className }: { image: PageImage; ctx: Ctx; className?: string }) {
  return <BlockPicture image={image} ctx={ctx} className={className} />;
}
