'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { LearnBlock, LearnSection, Person } from '@kgc/shared';
import {
  blockColumnOf,
  BLOCK_KINDS,
  blockSummary,
  kindLabel,
  layoutColumns,
  previewColumns,
  previewFraction,
  previewHref,
  previewPick,
  videoEmbedUrl,
  type BlockOf,
  type EditAction,
  type Selection,
} from '@/lib/learn-editor-core';
import { colorHex } from '@/lib/learn-tools-core';
import { resolveSrc, type Device, type PaneProps } from './editor-types';
import { ButtonRow, Picture, TextLink } from './preview-parts';
import { RichBlocks, RichLine } from './preview-rich';
import { PreviewContentContext, V2Body } from './preview-v2';
import { RichInlineEditor } from './rich-inline-editor';
import './preview.css';
import './preview-v2.css';

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
/** A click with Shift or Cmd adds to a multiple selection; true means the shell took it. */
export type BlockClickFn = (sectionId: string, blockId: string, mods: { shift: boolean; meta: boolean }) => boolean;

/** The drag payload type for moving a block inside the preview, between columns or sections. */
const DRAG_TYPE = 'application/x-kgc-learn-block';

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

// Every stored enum that ends up in a class name, checked against its fixed
// list (`previewPick`), so the preview never trusts the content's shape (T320).
const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
const SPACINGS = ['none', 'small', 'medium', 'large'] as const;
const TEXT_SIZES = ['small', 'normal', 'large', 'x-large'] as const;
const IMAGE_WIDTHS = ['small', 'medium', 'large', 'full'] as const;
const BACKGROUNDS = ['plain', 'white-wave', 'light-blue-wave', 'blue', 'grey-wave'] as const;
const SECTION_WIDTHS = ['narrow', 'normal', 'wide'] as const;
const MAX_WIDTHS = ['small', 'medium', 'large', 'full'] as const;
const LAYOUTS = ['single', 'two-equal', 'two-wide-left', 'two-wide-right', 'three'] as const;
const LEVELS = [1, 2, 3, 4] as const;
const KINDS = BLOCK_KINDS.map((k) => k.kind);

/** The grid custom properties for a people or columns block, from a column count of 1 to 4 only. */
function gridVars(columns: unknown): CSSProperties {
  const n = previewColumns(columns);
  return cssVars({ '--lp-cols': n, '--lp-cols-t': Math.min(n, 2) });
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function LinkedInIcon({ href }: { href: string }) {
  // An unsafe link renders as the icon with no link, as on the website.
  return (
    <a className="lp-li" href={previewHref(href)} aria-label="LinkedIn profile">
      <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
        <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
      </svg>
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
          <RichBlocks value={person.bio} />
        </div>
      )}
    </div>
  );
}

// ─── Block bodies ───────────────────────────────────────────────────────────

const HEADING_DEFAULT_SIZE = { 1: 'x-large', 2: 'large', 3: 'normal', 4: 'small' } as const;

function BlockBody({ block, siteOrigin, selected }: { block: LearnBlock; siteOrigin: string; selected: boolean }) {
  switch (block.kind) {
    case 'heading': {
      const level = previewPick(block.level, LEVELS, 2);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      return (
        <Tag className={`lp-heading lp-h-${previewPick(block.size, TEXT_SIZES, HEADING_DEFAULT_SIZE[level])}`}>
          <RichLine value={block.text} />
        </Tag>
      );
    }
    case 'text':
      return (
        <div className={`lp-text lp-t-${previewPick(block.size, TEXT_SIZES, 'normal')}`}>
          <RichBlocks value={block.text} />
        </div>
      );
    case 'image': {
      const pic = <Picture image={block.image} shape={block.shape} siteOrigin={siteOrigin} />;
      return (
        <figure className={`lp-figure lp-w-${previewPick(block.width, IMAGE_WIDTHS, 'medium')}`}>
          {block.href ? <a href={previewHref(block.href)}>{pic}</a> : pic}
          {block.caption && <figcaption className="lp-caption">{block.caption}</figcaption>}
        </figure>
      );
    }
    case 'buttons':
      return <ButtonRow buttons={block.buttons} />;
    case 'people':
      if (block.style === 'list') {
        return (
          <div className="lp-roster" style={cssVars({ '--lp-cols': previewColumns(block.columns) })}>
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
        <div className="lp-people" style={gridVars(block.columns)}>
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
              <RichLine value={item.text} />
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
        <div className="lp-columns" style={gridVars(block.columns)}>
          {block.items.map((item) => (
            <div key={item.id} className="lp-col">
              {item.image?.src && <Picture image={item.image} shape="original" siteOrigin={siteOrigin} className="lp-col-img" />}
              {item.title && <h3 className="lp-col-title">{item.title}</h3>}
              {item.text && (
                <div className="lp-col-text">
                  <RichBlocks value={item.text} />
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
            <div className="lp-video-empty">{block.url.trim() ? 'Use a YouTube or Vimeo link' : 'Add a video link'}</div>
          )}
          {block.caption && <figcaption className="lp-caption">{block.caption}</figcaption>}
        </figure>
      );
    }
    case 'divider':
      return <hr className="lp-hr" />;
    case 'spacer':
      return <div className={`lp-spacer lp-spacer-${previewPick(block.size, SPACINGS, 'medium')}`} aria-hidden="true" />;
    default:
      return <V2Body block={block} siteOrigin={siteOrigin} selected={selected} />;
  }
}

const VISIBLE_TAG = { desktop: 'Wide screens only', mobile: 'Phones only' } as const;

/** True when the block or section would not show at this preview width. */
function offscreen(visibleOn: 'all' | 'desktop' | 'mobile' | undefined, device: Device): boolean {
  if (!visibleOn || visibleOn === 'all') return false;
  return visibleOn === 'mobile' ? device !== 'phone' : device === 'phone';
}

// ─── Block shell ────────────────────────────────────────────────────────────

interface BlockViewProps {
  block: LearnBlock;
  sectionId: string;
  selected: boolean;
  /** Part of a multiple selection. */
  multi: boolean;
  warning?: string;
  siteOrigin: string;
  device: Device;
  onSelect: SelectFn;
  onEdit: EditFn;
  onBlockClick: BlockClickFn;
  wasLocal: (blockId: string) => boolean;
}

const BlockView = memo(function BlockView({
  block,
  sectionId,
  selected,
  multi,
  warning,
  siteOrigin,
  device,
  onSelect,
  onEdit,
  onBlockClick,
  wasLocal,
}: BlockViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const label = kindLabel(block.kind);
  // In place editing covers the v1 Markdown text; a RichDoc is edited in the
  // panel until T317's inline RichEditor is wired here.
  const editing = selected && (block.kind === 'heading' || block.kind === 'text') && typeof block.text === 'string';

  const select = () => {
    if (!selected) onSelect({ kind: 'block', sectionId, blockId: block.id });
  };

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if ((e.shiftKey || e.metaKey || e.ctrlKey) && onBlockClick(sectionId, block.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })) return;
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
    (level: 1 | 2 | 3 | 4) => onEdit({ type: 'updateBlock', sectionId, blockId: block.id, patch: { level } }),
    [onEdit, sectionId, block.id],
  );

  let body: ReactNode;
  if (editing && block.kind === 'heading') {
    body = (
      <div className={`lp-heading lp-h-${previewPick(block.size, TEXT_SIZES, HEADING_DEFAULT_SIZE[previewPick(block.level, LEVELS, 2)])} lp-editing`}>
        <RichInlineEditor
          text={block.text as string}
          single
          ariaLabel="Heading text"
          onChange={onText}
          onExit={exit}
          shouldFocus={shouldFocus}
          level={block.level === 4 ? 3 : block.level}
          onLevel={onLevel}
          fallback={<RichLine value={block.text} />}
        />
      </div>
    );
  } else if (editing && block.kind === 'text') {
    body = (
      <div className={`lp-text lp-t-${previewPick((block as BlockOf<'text'>).size, TEXT_SIZES, 'normal')} lp-editing`}>
        <RichInlineEditor
          text={block.text as string}
          single={false}
          ariaLabel="Text"
          onChange={onText}
          onExit={exit}
          shouldFocus={shouldFocus}
          fallback={<RichBlocks value={block.text} />}
        />
      </div>
    );
  } else {
    body = <BlockBody block={block} siteOrigin={siteOrigin} selected={selected} />;
  }

  const classes = [
    'lp-block',
    `lp-block-${previewPick(block.kind, KINDS, 'text')}`,
    `lp-al-${previewPick(block.align, ALIGNS, 'left')}`,
    `lp-sa-${previewPick(block.spaceAbove, SPACINGS, 'none')}`,
    block.spaceBelow ? `lp-sb-${previewPick(block.spaceBelow, SPACINGS, 'none')}` : 'lp-sb-default',
    block.maxWidth ? `lp-mw-${previewPick(block.maxWidth, MAX_WIDTHS, 'full')}` : '',
    block.boxed ? 'lp-boxed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const color = colorHex(block.textColor);
  const away = offscreen(block.visibleOn, device);

  return (
    <div
      ref={ref}
      className={classes}
      id={block.anchor ? `lp-anchor-${block.anchor}` : undefined}
      data-lp-block={block.id}
      data-block-id={block.id}
      data-selected={selected || undefined}
      data-multi={multi || undefined}
      data-hidden={block.hidden || undefined}
      data-offscreen={away || undefined}
      style={color ? ({ ['--lp-text' as string]: color, color } as CSSProperties) : undefined}
      tabIndex={0}
      role="button"
      aria-pressed={selected || multi}
      aria-label={`${blockSummary(block)}${block.hidden ? ' (hidden)' : ''}${away ? ` (${VISIBLE_TAG[block.visibleOn as 'desktop' | 'mobile'].toLowerCase()})` : ''}${warning ? ` (warning: ${warning})` : ''}, select to edit`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {selected && (
        <span
          className="lp-tag lp-tag-block lp-tag-drag"
          draggable
          title="Drag to move it to another column or section"
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ sectionId, blockId: block.id }));
            e.dataTransfer.setData('text/plain', block.id);
          }}
          aria-hidden="true"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
            {[4, 8, 12].map((y) => (
              <g key={y}>
                <circle cx="5" cy={y} r="1.4" fill="currentColor" />
                <circle cx="11" cy={y} r="1.4" fill="currentColor" />
              </g>
            ))}
          </svg>
          {label}
        </span>
      )}
      {block.hidden && <span className="lp-tag lp-tag-hidden" aria-hidden="true">Hidden</span>}
      {block.visibleOn && block.visibleOn !== 'all' && (
        <span className={`lp-tag lp-tag-device${block.hidden ? ' is-second' : ''}`} aria-hidden="true">
          {VISIBLE_TAG[block.visibleOn]}
        </span>
      )}
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
  /** Ids of this section's blocks in a multiple selection, joined with spaces (a string, so memo compares it). */
  multiKey: string;
  /** Block id to its warnings, joined; `''` for the section's own. */
  warnings: Record<string, string> | undefined;
  siteOrigin: string;
  device: Device;
  onSelect: SelectFn;
  onEdit: EditFn;
  onBlockClick: BlockClickFn;
  wasLocal: (blockId: string) => boolean;
}

/** Where a dropped block lands: before `beforeId`, or at the end of `column`. */
function dropAction(
  section: LearnSection,
  data: string,
  column: number,
  beforeId: string | null,
): EditAction | null {
  let from: { sectionId: string; blockId: string };
  try {
    from = JSON.parse(data) as { sectionId: string; blockId: string };
  } catch {
    return null;
  }
  if (!from?.blockId || from.blockId === beforeId) return null;
  const rest = section.blocks.filter((b) => b.id !== from.blockId);
  let toIndex: number;
  if (beforeId) toIndex = rest.findIndex((b) => b.id === beforeId);
  else {
    // After the last block of that column, so its blocks stay together in source order.
    let last = -1;
    rest.forEach((b, i) => {
      if (blockColumnOf(section, b.id) === column) last = i;
    });
    toIndex = last + 1;
  }
  if (toIndex < 0) toIndex = rest.length;
  return { type: 'moveBlock', sectionId: from.sectionId, blockId: from.blockId, toSectionId: section.id, toIndex, toColumn: column };
}

const SectionView = memo(function SectionView({
  section,
  selected,
  selectedBlockId,
  multiKey,
  warnings,
  siteOrigin,
  device,
  onSelect,
  onEdit,
  onBlockClick,
  wasLocal,
}: SectionViewProps) {
  const [dropAt, setDropAt] = useState<{ column: number; beforeId: string | null } | null>(null);
  const multi = useMemo(() => new Set(multiKey ? multiKey.split(' ') : []), [multiKey]);
  const columns = layoutColumns(section.layout);
  const width = previewPick(section.width, SECTION_WIDTHS, 'normal');
  const background = previewPick(section.background, BACKGROUNDS, 'plain');
  const layout = previewPick(section.layout, LAYOUTS, 'single');

  const dragHandlers = (column: number, beforeId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dropAt?.column !== column || dropAt.beforeId !== beforeId) setDropAt({ column, beforeId });
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target) setDropAt(null);
    },
    onDrop: (e: DragEvent) => {
      const data = e.dataTransfer.getData(DRAG_TYPE);
      if (!data) return;
      e.preventDefault();
      e.stopPropagation();
      setDropAt(null);
      const action = dropAction(section, data, column, beforeId);
      if (action) onEdit(action);
    },
  });

  const block = (b: LearnBlock, column: number) => (
    <div key={b.id} className="lp-drop-slot" {...dragHandlers(column, b.id)}>
      {dropAt?.column === column && dropAt.beforeId === b.id && <div className="lp-drop-line" aria-hidden="true" />}
      <BlockView
        block={b}
        sectionId={section.id}
        selected={selectedBlockId === b.id}
        multi={multi.has(b.id)}
        warning={warnings?.[b.id]}
        siteOrigin={siteOrigin}
        device={device}
        onSelect={onSelect}
        onEdit={onEdit}
        onBlockClick={onBlockClick}
        wasLocal={wasLocal}
      />
    </div>
  );

  const zoneEnd = (column: number) => (
    <div className="lp-drop-end" {...dragHandlers(column, null)}>
      {dropAt?.column === column && dropAt.beforeId === null && <div className="lp-drop-line" aria-hidden="true" />}
    </div>
  );

  const wrap = (blocks: LearnBlock[], key: string) => (
    <div key={key} className={`lp-wrap lp-width-${width}`}>
      <div className="lp-measure">
        {blocks.map((b) => block(b, 0))}
        {zoneEnd(0)}
      </div>
    </div>
  );

  const artIndex =
    columns === 1 && background === 'grey-wave' && section.waveBehindFirstImage
      ? section.blocks.findIndex((b) => b.kind === 'image')
      : -1;

  let inner: ReactNode;
  if (section.blocks.length === 0) {
    inner = (
      <div className={`lp-wrap lp-width-${width}`}>
        <div className="lp-measure lp-section-empty" {...dragHandlers(0, null)}>
          Empty section. Add a block from the outline, or drag one here.
        </div>
      </div>
    );
  } else if (columns > 1) {
    inner = (
      <div className={`lp-wrap lp-width-${width}`}>
        <div className={`lp-measure lp-layout lp-layout-${layout}`}>
          {Array.from({ length: columns }, (_, c) => {
            const mine = section.blocks.filter((b) => blockColumnOf(section, b.id) === c);
            return (
              <div key={c} className="lp-layout-col" data-column={c + 1}>
                {mine.map((b) => block(b, c))}
                {mine.length === 0 && <div className="lp-layout-empty">Column {c + 1} is empty. Drag a block here.</div>}
                {zoneEnd(c)}
              </div>
            );
          })}
        </div>
      </div>
    );
  } else if (artIndex >= 0) {
    inner = (
      <>
        {artIndex > 0 && wrap(section.blocks.slice(0, artIndex), 'before')}
        <div className="lp-art" style={{ backgroundImage: waveUrl(siteOrigin, 'wave-13.png') }}>
          {block(section.blocks[artIndex], 0)}
        </div>
        {artIndex < section.blocks.length - 1 && wrap(section.blocks.slice(artIndex + 1), 'after')}
      </>
    );
  } else {
    inner = wrap(section.blocks, 'all');
  }

  const custom = colorHex(section.backgroundColor);
  const photo = section.backgroundImage?.src ? resolveSrc(section.backgroundImage.src, siteOrigin) : null;
  const waves =
    custom || photo
      ? undefined
      : background === 'white-wave' || background === 'light-blue-wave'
        ? waveUrl(siteOrigin, 'wave-3.png')
        : background === 'grey-wave' && artIndex < 0
          ? waveUrl(siteOrigin, 'wave-13.png')
          : undefined;

  const style: CSSProperties = {};
  if (waves) style.backgroundImage = waves;
  if (custom) style.backgroundColor = custom;
  if (photo) {
    const overlay = typeof section.overlay === 'number' && Number.isFinite(section.overlay) ? Math.max(0, Math.min(0.8, section.overlay)) : 0;
    const focus = section.backgroundImage
      ? `${previewFraction(section.backgroundImage.focusX) * 100}% ${previewFraction(section.backgroundImage.focusY) * 100}%`
      : 'center';
    style.backgroundImage = `linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay})), url(${JSON.stringify(photo)})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = focus;
  }
  const away = offscreen(section.visibleOn, device);
  const sectionWarning = warnings?.[''];

  return (
    <div
      className="lp-section-shell"
      data-lp-section={section.id}
      data-selected={selected || undefined}
      data-offscreen={away || undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!selected) onSelect({ kind: 'section', sectionId: section.id });
      }}
    >
      {selected && <span className="lp-tag lp-tag-section" aria-hidden="true">{section.label || 'Section'}</span>}
      {section.hidden && <span className="lp-tag lp-tag-hidden lp-tag-section-hidden" aria-hidden="true">Hidden</span>}
      {section.visibleOn && section.visibleOn !== 'all' && (
        <span className="lp-tag lp-tag-device lp-tag-section-device" aria-hidden="true">
          {VISIBLE_TAG[section.visibleOn]}
        </span>
      )}
      {sectionWarning && (
        <span className="lp-warn lp-warn-section" title={sectionWarning} aria-hidden="true">
          !
        </span>
      )}
      <section
        id={section.anchor ? `lp-anchor-${section.anchor}` : undefined}
        className={`lp-section lp-bg-${background} lp-pt-${previewPick(section.paddingTop, SPACINGS, 'large')} lp-pb-${previewPick(section.paddingBottom, SPACINGS, 'large')}${photo ? ' lp-has-photo' : ''}`}
        data-hidden={section.hidden || undefined}
        aria-label={`${section.label || 'Section'}${section.hidden ? ' (hidden)' : ''}`}
        style={Object.keys(style).length ? style : undefined}
      >
        {inner}
      </section>
    </div>
  );
});

// ─── The pane ───────────────────────────────────────────────────────────────

export interface LearnPreviewProps extends PaneProps {
  siteOrigin: string;
  device: Device;
  /** Blocks in a multiple selection (outline or Shift and Cmd clicks here). */
  multi?: ReadonlySet<string>;
  onBlockClick?: BlockClickFn;
}

export function LearnPreview(props: LearnPreviewProps) {
  const { content, selection, warnings, siteOrigin, device, multi } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  // Stable callbacks, so memoised blocks are not re-rendered by a new arrow from the shell.
  const handlers = useRef({ onSelect: props.onSelect, onEdit: props.onEdit, onBlockClick: props.onBlockClick });
  useEffect(() => {
    handlers.current = { onSelect: props.onSelect, onEdit: props.onEdit, onBlockClick: props.onBlockClick };
  });

  /** The last selection made by clicking or typing in this pane, which must not scroll or steal focus. */
  const localKey = useRef<string | null>(null);

  const onSelect = useCallback<SelectFn>((sel) => {
    localKey.current = selKey(sel);
    handlers.current.onSelect(sel);
  }, []);
  const onEdit = useCallback<EditFn>((action) => handlers.current.onEdit(action), []);
  const onBlockClick = useCallback<BlockClickFn>((s, b, m) => handlers.current.onBlockClick?.(s, b, m) ?? false, []);
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
    <PreviewContentContext.Provider value={content}>
      <div
        ref={rootRef}
        className="lp-root"
        data-device={device}
        // The preview is a picture of the page: links in it never navigate, except
        // a jump to an anchor on the page, which scrolls the preview like the site.
        onClickCapture={(e) => {
          const a = (e.target as HTMLElement).closest('a');
          if (!a) return;
          e.preventDefault();
          const href = a.getAttribute('href') ?? '';
          if (href.startsWith('#') && href.length > 1)
            rootRef.current
              ?.querySelector(`#lp-anchor-${CSS.escape(href.slice(1))}`)
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }}
      >
        {content.sections.map((s) => (
          <SectionView
            key={s.id}
            section={s}
            selected={selectedSectionId === s.id}
            selectedBlockId={selectedBlockSection === s.id ? selectedBlockId : null}
            multiKey={multi && multi.size > 0 ? s.blocks.filter((b) => multi.has(b.id)).map((b) => b.id).join(' ') : ''}
            warnings={warningsBySection[s.id]}
            siteOrigin={siteOrigin}
            device={device}
            onSelect={onSelect}
            onEdit={onEdit}
            onBlockClick={onBlockClick}
            wasLocal={wasLocal}
          />
        ))}
        {content.sections.length === 0 && <div className="lp-page-empty">This page has no sections yet.</div>}
      </div>
    </PreviewContentContext.Provider>
  );
}
