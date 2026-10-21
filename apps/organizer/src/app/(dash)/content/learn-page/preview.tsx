'use client';

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { isSafeHref } from '@kgc/shared';
import type { LearnBlock, LearnSection, LinkButton, PageImage, ImageShape, Person } from '@kgc/shared';
import {
  blockSummary,
  kindLabel,
  markdownToDoc,
  videoEmbedUrl,
  type BlockOf,
  type EditAction,
  type InlineNode,
  type Selection,
} from '@/lib/learn-editor-core';
import { resolveSrc, type Device, type PaneProps } from './editor-types';
import { RichInlineEditor } from './rich-inline-editor';
import './preview.css';

/**
 * The Learn page as the website draws it, with the editor's hands on it (T310).
 *
 * The markup and the `lp-` rules in `preview.css` follow the website's
 * `/learn` page and its `.learn-*` CSS. The frame width comes from `device`,
 * not from the window, so the phone and tablet layouts are attribute rules on
 * `.lp-root` rather than media queries.
 *
 * Every block is memoised and receives only primitives plus its own block
 * object, so typing in one heading re-renders that heading and its section
 * shell, not the photographs further down.
 */

type SelectFn = (sel: Selection) => void;
type EditFn = (action: EditAction) => void;

function selKey(sel: Selection): string | null {
  if (sel.kind === 'block') return `b:${sel.blockId}`;
  if (sel.kind === 'section') return `s:${sel.sectionId}`;
  return null;
}

function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

function waveUrl(siteOrigin: string, name: string): string {
  return `url(${JSON.stringify(`${siteOrigin}/kgc/${name}`)})`;
}

// ─── Rich text ──────────────────────────────────────────────────────────────

function renderNodes(nodes: InlineNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'hardBreak') return <br key={i} />;
    let out: ReactNode = n.text ?? '';
    const marks = n.marks ?? [];
    const link = marks.find((m) => m.type === 'link');
    if (link?.attrs?.href && isSafeHref(link.attrs.href)) out = <a href={link.attrs.href}>{out}</a>;
    if (marks.some((m) => m.type === 'italic')) out = <em>{out}</em>;
    if (marks.some((m) => m.type === 'bold')) out = <strong>{out}</strong>;
    return <Fragment key={i}>{out}</Fragment>;
  });
}

/** Paragraphs, for a text block. */
function RichParagraphs({ text }: { text: string }) {
  const doc = markdownToDoc(text);
  return (
    <>
      {doc.content.map((p, i) => (
        <p key={i}>{renderNodes(p.content)}</p>
      ))}
    </>
  );
}

/** One line of inline text: paragraphs, if any slipped in, become line breaks. */
function RichInline({ text }: { text: string }) {
  const doc = markdownToDoc(text);
  return (
    <>
      {doc.content.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderNodes(p.content)}
        </Fragment>
      ))}
    </>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Picture({
  image,
  shape,
  siteOrigin,
  className,
}: {
  image: PageImage;
  shape: ImageShape;
  siteOrigin: string;
  className?: string;
}) {
  const crop = shape === 'square' || shape === 'circle';
  const ratio = image.width > 0 && image.height > 0 ? `${image.width} / ${image.height}` : undefined;
  if (!image.src) {
    return (
      <div className={`lp-img-empty lp-shape-${shape} ${className ?? ''}`} style={{ aspectRatio: crop ? '1 / 1' : ratio ?? '16 / 9' }}>
        No image yet
      </div>
    );
  }
  const style: CSSProperties = {
    objectPosition: `${(image.focusX ?? 0.5) * 100}% ${(image.focusY ?? 0.5) * 100}%`,
    aspectRatio: crop ? '1 / 1' : ratio,
  };
  return (
    // Site assets and Storage URLs from any origin; next/image would need each host configured.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`lp-img lp-shape-${shape} ${className ?? ''}`}
      src={resolveSrc(image.src, siteOrigin)}
      alt={image.alt}
      width={image.width || undefined}
      height={image.height || undefined}
      style={style}
      loading="lazy"
      decoding="async"
    />
  );
}

function LinkedInIcon({ href }: { href: string }) {
  return (
    <a className="lp-li" href={href} aria-label="LinkedIn profile">
      <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
        <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
      </svg>
    </a>
  );
}

function TextLink({ link }: { link: LinkButton }) {
  return (
    <a className="lp-textlink" href={isSafeHref(link.href) ? link.href : undefined}>
      {link.label}
    </a>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

function PersonCard({ person, siteOrigin }: { person: Person; siteOrigin: string }) {
  return (
    <div className="lp-person">
      {person.photo?.src ? (
        <Picture image={person.photo} shape="square" siteOrigin={siteOrigin} className="lp-person-photo" />
      ) : (
        <div className="lp-person-photo lp-person-nophoto" aria-hidden="true">
          {initials(person.name)}
        </div>
      )}
      <div className="lp-person-row">
        <div>
          <span className="lp-person-name">{person.name}</span>
          <p className="lp-person-role">{person.role}</p>
        </div>
        {person.linkedin && <LinkedInIcon href={person.linkedin} />}
      </div>
      {person.bio && (
        <div className="lp-person-bio">
          <RichParagraphs text={person.bio} />
        </div>
      )}
    </div>
  );
}

// ─── Block bodies ───────────────────────────────────────────────────────────

const HEADING_DEFAULT_SIZE = { 1: 'x-large', 2: 'large', 3: 'normal' } as const;

function BlockBody({ block, siteOrigin, selected }: { block: LearnBlock; siteOrigin: string; selected: boolean }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      return (
        <Tag className={`lp-heading lp-h-${block.size ?? HEADING_DEFAULT_SIZE[block.level]}`}>
          <RichInline text={block.text} />
        </Tag>
      );
    }
    case 'text':
      return (
        <div className={`lp-text lp-t-${block.size ?? 'normal'}`}>
          <RichParagraphs text={block.text} />
        </div>
      );
    case 'image': {
      const pic = <Picture image={block.image} shape={block.shape} siteOrigin={siteOrigin} />;
      return (
        <figure className={`lp-figure lp-w-${block.width}`}>
          {block.href ? <a href={isSafeHref(block.href) ? block.href : undefined}>{pic}</a> : pic}
          {block.caption && <figcaption className="lp-caption">{block.caption}</figcaption>}
        </figure>
      );
    }
    case 'buttons':
      return (
        <div className="lp-buttons">
          {block.buttons.map((b, i) => (
            <a key={i} className={`lp-btn lp-btn-${b.style}`} href={isSafeHref(b.href) ? b.href : undefined}>
              {b.label}
            </a>
          ))}
        </div>
      );
    case 'people':
      if (block.style === 'list') {
        return (
          <div className="lp-roster" style={cssVars({ '--lp-cols': block.columns })}>
            {block.people.map((p) => (
              <div key={p.id}>
                <span className="lp-roster-name">{p.name}</span>
                <span className="lp-roster-role">{p.role}</span>
                {p.linkedin && <LinkedInIcon href={p.linkedin} />}
              </div>
            ))}
          </div>
        );
      }
      return (
        <div
          className="lp-people"
          style={cssVars({ '--lp-cols': block.columns, '--lp-cols-t': Math.min(block.columns, 2) })}
        >
          {block.people.map((p) => (
            <PersonCard key={p.id} person={p} siteOrigin={siteOrigin} />
          ))}
        </div>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className="lp-list">
          {block.items.map((item) => (
            <li key={item.id}>
              {item.title && <strong>{item.title}</strong>}
              {item.title && item.text ? ' ' : null}
              <RichInline text={item.text} />
              {item.link && (
                <>
                  {' '}
                  <TextLink link={item.link} />
                </>
              )}
              {item.children && item.children.length > 0 && (
                <ul>
                  {item.children.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </List>
      );
    }
    case 'columns':
      return (
        <div
          className="lp-columns"
          style={cssVars({ '--lp-cols': block.columns, '--lp-cols-t': Math.min(block.columns, 2) })}
        >
          {block.items.map((item) => (
            <div key={item.id} className="lp-col">
              {item.image && <Picture image={item.image} shape="original" siteOrigin={siteOrigin} className="lp-col-img" />}
              {item.title && <h3 className="lp-col-title">{item.title}</h3>}
              {item.text && (
                <div className="lp-col-text">
                  <RichParagraphs text={item.text} />
                </div>
              )}
              {item.link && <TextLink link={item.link} />}
            </div>
          ))}
        </div>
      );
    case 'video': {
      const embed = videoEmbedUrl(block.url);
      return (
        <figure className="lp-video">
          {embed ? (
            <iframe
              src={embed}
              title={block.caption || 'Video'}
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              // Until the block is selected, a click on the player selects the block.
              style={selected ? undefined : { pointerEvents: 'none' }}
            />
          ) : (
            <div className="lp-video-empty">Paste a YouTube or Vimeo link</div>
          )}
          {block.caption && <figcaption className="lp-caption">{block.caption}</figcaption>}
        </figure>
      );
    }
    case 'divider':
      return <hr className="lp-hr" />;
    case 'spacer':
      return <div className={`lp-spacer lp-spacer-${block.size}`} aria-hidden="true" />;
  }
}

// ─── Block shell ────────────────────────────────────────────────────────────

interface BlockViewProps {
  block: LearnBlock;
  sectionId: string;
  selected: boolean;
  warning?: string;
  siteOrigin: string;
  onSelect: SelectFn;
  onEdit: EditFn;
  wasLocal: (blockId: string) => boolean;
}

const BlockView = memo(function BlockView({
  block,
  sectionId,
  selected,
  warning,
  siteOrigin,
  onSelect,
  onEdit,
  wasLocal,
}: BlockViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const label = kindLabel(block.kind);
  const editing = selected && (block.kind === 'heading' || block.kind === 'text');

  const select = () => {
    if (!selected) onSelect({ kind: 'block', sectionId, blockId: block.id });
  };

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    select();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      select();
    } else if (e.key === 'Escape' && selected) {
      e.stopPropagation();
      onSelect({ kind: 'section', sectionId });
    }
  };

  const exit = useCallback(() => {
    onSelect({ kind: 'section', sectionId });
    ref.current?.focus();
  }, [onSelect, sectionId]);

  const shouldFocus = useCallback(() => wasLocal(block.id), [wasLocal, block.id]);

  const onText = useCallback(
    (text: string) => onEdit({ type: 'updateBlock', sectionId, blockId: block.id, patch: { text } }),
    [onEdit, sectionId, block.id],
  );

  const onLevel = useCallback(
    (level: 1 | 2 | 3) => onEdit({ type: 'updateBlock', sectionId, blockId: block.id, patch: { level } }),
    [onEdit, sectionId, block.id],
  );

  let body: ReactNode;
  if (editing && block.kind === 'heading') {
    body = (
      <div className={`lp-heading lp-h-${block.size ?? HEADING_DEFAULT_SIZE[block.level]} lp-editing`}>
        <RichInlineEditor
          text={block.text}
          single
          ariaLabel="Heading text"
          onChange={onText}
          onExit={exit}
          shouldFocus={shouldFocus}
          level={block.level}
          onLevel={onLevel}
          fallback={<RichInline text={block.text} />}
        />
      </div>
    );
  } else if (editing && block.kind === 'text') {
    body = (
      <div className={`lp-text lp-t-${(block as BlockOf<'text'>).size ?? 'normal'} lp-editing`}>
        <RichInlineEditor
          text={block.text}
          single={false}
          ariaLabel="Text"
          onChange={onText}
          onExit={exit}
          shouldFocus={shouldFocus}
          fallback={<RichParagraphs text={block.text} />}
        />
      </div>
    );
  } else {
    body = <BlockBody block={block} siteOrigin={siteOrigin} selected={selected} />;
  }

  const classes = [
    'lp-block',
    `lp-block-${block.kind}`,
    `lp-al-${block.align ?? 'left'}`,
    `lp-sa-${block.spaceAbove ?? 'none'}`,
    block.spaceBelow ? `lp-sb-${block.spaceBelow}` : 'lp-sb-default',
  ].join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      data-lp-block={block.id}
      data-selected={selected || undefined}
      data-hidden={block.hidden || undefined}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${blockSummary(block)}${block.hidden ? ' (hidden)' : ''}${warning ? ` (warning: ${warning})` : ''}, select to edit`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {selected && <span className="lp-tag lp-tag-block" aria-hidden="true">{label}</span>}
      {block.hidden && <span className="lp-tag lp-tag-hidden" aria-hidden="true">Hidden</span>}
      {warning && (
        <span className="lp-warn" title={warning} aria-hidden="true">
          !
        </span>
      )}
      <div className="lp-block-body">{body}</div>
    </div>
  );
});

// ─── Section ────────────────────────────────────────────────────────────────

interface SectionViewProps {
  section: LearnSection;
  selected: boolean;
  selectedBlockId: string | null;
  /** Block id to its warnings, joined; `''` for the section's own. */
  warnings: Record<string, string> | undefined;
  siteOrigin: string;
  onSelect: SelectFn;
  onEdit: EditFn;
  wasLocal: (blockId: string) => boolean;
}

const SectionView = memo(function SectionView({
  section,
  selected,
  selectedBlockId,
  warnings,
  siteOrigin,
  onSelect,
  onEdit,
  wasLocal,
}: SectionViewProps) {
  const block = (b: LearnBlock) => (
    <BlockView
      key={b.id}
      block={b}
      sectionId={section.id}
      selected={selectedBlockId === b.id}
      warning={warnings?.[b.id]}
      siteOrigin={siteOrigin}
      onSelect={onSelect}
      onEdit={onEdit}
      wasLocal={wasLocal}
    />
  );

  const wrap = (blocks: LearnBlock[], key: string) => (
    <div key={key} className={`lp-wrap lp-width-${section.width}`}>
      <div className="lp-measure">{blocks.map(block)}</div>
    </div>
  );

  const artIndex =
    section.background === 'grey-wave' && section.waveBehindFirstImage
      ? section.blocks.findIndex((b) => b.kind === 'image')
      : -1;

  let inner: ReactNode;
  if (section.blocks.length === 0) {
    inner = (
      <div className={`lp-wrap lp-width-${section.width}`}>
        <div className="lp-measure lp-section-empty">Empty section. Add a block from the panel.</div>
      </div>
    );
  } else if (artIndex >= 0) {
    inner = (
      <>
        {artIndex > 0 && wrap(section.blocks.slice(0, artIndex), 'before')}
        <div className="lp-art" style={{ backgroundImage: waveUrl(siteOrigin, 'wave-13.png') }}>
          {block(section.blocks[artIndex])}
        </div>
        {artIndex < section.blocks.length - 1 && wrap(section.blocks.slice(artIndex + 1), 'after')}
      </>
    );
  } else {
    inner = wrap(section.blocks, 'all');
  }

  const bgImage =
    section.background === 'white-wave' || section.background === 'light-blue-wave'
      ? waveUrl(siteOrigin, 'wave-3.png')
      : section.background === 'grey-wave' && artIndex < 0
        ? waveUrl(siteOrigin, 'wave-13.png')
        : undefined;

  const sectionWarning = warnings?.[''];

  return (
    <div
      className="lp-section-shell"
      data-lp-section={section.id}
      data-selected={selected || undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!selected) onSelect({ kind: 'section', sectionId: section.id });
      }}
    >
      {selected && <span className="lp-tag lp-tag-section" aria-hidden="true">{section.label || 'Section'}</span>}
      {section.hidden && <span className="lp-tag lp-tag-hidden lp-tag-section-hidden" aria-hidden="true">Hidden</span>}
      {sectionWarning && (
        <span className="lp-warn lp-warn-section" title={sectionWarning} aria-hidden="true">
          !
        </span>
      )}
      <section
        className={`lp-section lp-bg-${section.background} lp-pt-${section.paddingTop} lp-pb-${section.paddingBottom}`}
        data-hidden={section.hidden || undefined}
        aria-label={`${section.label || 'Section'}${section.hidden ? ' (hidden)' : ''}`}
        style={bgImage ? { backgroundImage: bgImage } : undefined}
      >
        {inner}
      </section>
    </div>
  );
});

// ─── The pane ───────────────────────────────────────────────────────────────

export function LearnPreview(props: PaneProps & { siteOrigin: string; device: Device }) {
  const { content, selection, warnings, siteOrigin, device } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  // Stable callbacks, so memoised blocks are not re-rendered by a new arrow from the shell.
  const handlers = useRef({ onSelect: props.onSelect, onEdit: props.onEdit });
  useEffect(() => {
    handlers.current = { onSelect: props.onSelect, onEdit: props.onEdit };
  });

  /** The last selection made by clicking or typing in this pane, which must not scroll or steal focus. */
  const localKey = useRef<string | null>(null);

  const onSelect = useCallback<SelectFn>((sel) => {
    localKey.current = selKey(sel);
    handlers.current.onSelect(sel);
  }, []);
  const onEdit = useCallback<EditFn>((action) => handlers.current.onEdit(action), []);
  const wasLocal = useCallback((blockId: string) => localKey.current === `b:${blockId}`, []);

  const key = selKey(selection);
  useEffect(() => {
    if (!key || key === localKey.current) return;
    localKey.current = null;
    const attr = key.startsWith('b:') ? 'data-lp-block' : 'data-lp-section';
    const el = rootRef.current?.querySelector(`[${attr}="${CSS.escape(key.slice(2))}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [key]);

  const warningsBySection = useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const w of warnings) {
      const bySection = (out[w.sectionId] ??= {});
      const k = w.blockId ?? '';
      bySection[k] = bySection[k] ? `${bySection[k]}; ${w.message}` : w.message;
    }
    return out;
  }, [warnings]);

  const selectedSectionId = selection.kind === 'section' ? selection.sectionId : null;
  const selectedBlockId = selection.kind === 'block' ? selection.blockId : null;
  const selectedBlockSection = selection.kind === 'block' ? selection.sectionId : null;

  return (
    <div
      ref={rootRef}
      className="lp-root"
      data-device={device}
      // The preview is a picture of the page: links in it never navigate.
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
    >
      {content.sections.map((s) => (
        <SectionView
          key={s.id}
          section={s}
          selected={selectedSectionId === s.id}
          selectedBlockId={selectedBlockSection === s.id ? selectedBlockId : null}
          warnings={warningsBySection[s.id]}
          siteOrigin={siteOrigin}
          onSelect={onSelect}
          onEdit={onEdit}
          wasLocal={wasLocal}
        />
      ))}
      {content.sections.length === 0 && <div className="lp-page-empty">This page has no sections yet.</div>}
    </div>
  );
}
