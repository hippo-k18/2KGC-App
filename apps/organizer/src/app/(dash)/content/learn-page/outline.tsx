'use client';

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { BandBackground, LearnBlock, LearnSection } from '@kgc/shared';
import {
  blockSummary,
  createBlock,
  createSection,
  kindLabel,
  type BlockKind,
  type Selection,
} from '@/lib/learn-editor-core';
import { AddBlockPicker } from './add-block-picker';
import type { PaneProps } from './editor-types';
import './outline.css';

/**
 * The page outline: sections and their blocks as a tree the course lead can
 * click, reorder and add to. It never edits content itself; every change is an
 * EditAction handed to the shell, so it lands on the undo stack.
 */

const SWATCH: Record<BandBackground, string> = {
  plain: '#ffffff',
  'white-wave': '#f7f9fb',
  'light-blue-wave': '#e7f1fb',
  blue: '#2069bc',
  'grey-wave': '#e9ecef',
};

const SWATCH_LABEL: Record<BandBackground, string> = {
  plain: 'Plain',
  'white-wave': 'White wave',
  'light-blue-wave': 'Light blue wave',
  blue: 'Blue',
  'grey-wave': 'Grey wave',
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function Svg({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const KIND_ICON: Record<BlockKind, ReactNode> = {
  heading: <path d="M3 3v10M11 3v10M3 8h8M13.5 13V8l-1.5 1" />,
  text: <path d="M2.5 4h11M2.5 7h11M2.5 10h11M2.5 13h7" />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="10.5" cy="6.5" r="1.2" />
      <path d="M2.5 12l4-4.5 3 3 1.5-1.5 2.5 3" />
    </>
  ),
  buttons: (
    <>
      <rect x="1.5" y="5.5" width="6" height="5" rx="2.5" />
      <rect x="8.5" y="5.5" width="6" height="5" rx="2.5" />
    </>
  ),
  people: (
    <>
      <circle cx="5.5" cy="5.5" r="2.2" />
      <path d="M1.5 13.5c.4-2.4 2-3.7 4-3.7s3.6 1.3 4 3.7" />
      <circle cx="11.5" cy="6" r="1.8" />
      <path d="M11 9.6c1.9 0 3.1 1.2 3.5 3.4" />
    </>
  ),
  list: (
    <>
      <path d="M6 4h8M6 8h8M6 12h8" />
      <circle cx="2.8" cy="4" r=".6" fill="currentColor" />
      <circle cx="2.8" cy="8" r=".6" fill="currentColor" />
      <circle cx="2.8" cy="12" r=".6" fill="currentColor" />
    </>
  ),
  columns: (
    <>
      <rect x="1.5" y="3" width="5.5" height="10" rx="1" />
      <rect x="9" y="3" width="5.5" height="10" rx="1" />
    </>
  ),
  video: (
    <>
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="M6.5 5.8v4.4L10.2 8z" fill="currentColor" />
    </>
  ),
  divider: <path d="M1.5 8h13" />,
  spacer: <path d="M3 2.5h10M3 13.5h10M8 5v6M6.3 6.7L8 5l1.7 1.7M6.3 9.3L8 11l1.7-1.7" />,
};

const I = {
  page: (
    <>
      <path d="M4 1.5h5.5L13 5v9.5H4z" />
      <path d="M9.5 1.5V5H13" />
    </>
  ),
  chevron: <path d="M4 6l4 4 4-4" />,
  handle: (
    <>
      {[4, 8, 12].map((y) => (
        <g key={y}>
          <circle cx="6" cy={y} r="1" fill="currentColor" stroke="none" />
          <circle cx="10" cy={y} r="1" fill="currentColor" stroke="none" />
        </g>
      ))}
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M10.1 10.1A2 2 0 0 1 5.9 5.9M4 4.9C2.4 6 1.5 8 1.5 8S3.9 12.5 8 12.5c1 0 1.9-.3 2.7-.7" />
      <path d="M2 2l12 12" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </>
  ),
  up: <path d="M8 13V3M4 7l4-4 4 4" />,
  down: <path d="M8 3v10M4 9l4 4 4-4" />,
  trash: (
    <>
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4" />
      <path d="M6.8 6.5v4.5M9.2 6.5v4.5" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
};

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`le-ol-icon${danger ? ' is-danger' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Svg>{children}</Svg>
    </button>
  );
}

// ─── Drag state ───────────────────────────────────────────────────────────────

type Dragging =
  | { type: 'section'; sectionId: string }
  | { type: 'block'; sectionId: string; blockId: string };

/** Where a drop would land: a gap index in the original list, before any removal. */
type DropAt = { type: 'section'; index: number } | { type: 'block'; sectionId: string; index: number };

const rowKey = {
  page: 'page',
  section: (id: string) => `s:${id}`,
  block: (id: string) => `b:${id}`,
};

function selectionKey(sel: Selection): string {
  if (sel.kind === 'page') return rowKey.page;
  if (sel.kind === 'section') return rowKey.section(sel.sectionId);
  return rowKey.block(sel.blockId);
}

/** Below the middle of the element means "after it". */
function isLowerHalf(e: DragEvent<HTMLElement>): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}

/** A gap index to the index `moveWithin` expects, which removes the item first. */
function gapToIndex(gap: number, from: number): number {
  return gap > from ? gap - 1 : gap;
}

// ─── Outline ──────────────────────────────────────────────────────────────────

export function Outline(props: PaneProps) {
  const { content, selection, onSelect, onEdit, warnings } = props;
  const sections = content.sections;

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ sectionId: string; index: number; anchor: string } | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);

  const rowRefs = useRef(new Map<string, HTMLElement>());
  const focusAfterRender = useRef<string | null>(null);
  const pickerOpener = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement>(null);

  const selectedKey = selectionKey(selection);

  useEffect(() => {
    rowRefs.current.get(selectedKey)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  // A row moved by keyboard is a moved DOM node, which can drop focus.
  useEffect(() => {
    const key = focusAfterRender.current;
    if (!key) return;
    focusAfterRender.current = null;
    rowRefs.current
      .get(key)
      ?.querySelector<HTMLButtonElement>('.le-ol-main')
      ?.focus();
  });

  useEffect(() => {
    if (confirming) navRef.current?.querySelector<HTMLButtonElement>('.le-ol-confirm .is-no')?.focus();
  }, [confirming]);

  const registerRow = (key: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  };

  const warningFor = new Map<string, string>();
  for (const w of warnings) {
    if (!w.blockId) continue;
    const prev = warningFor.get(w.blockId);
    warningFor.set(w.blockId, prev ? `${prev}\n${w.message}` : w.message);
  }

  // ── Actions ──

  const toggleCollapsed = (sectionId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  const moveSectionTo = (sectionId: string, toIndex: number) => {
    const from = sections.findIndex((s) => s.id === sectionId);
    if (from < 0 || toIndex === from || toIndex < 0 || toIndex >= sections.length) return;
    onEdit({ type: 'moveSection', sectionId, toIndex });
  };

  /** Moves a block one step, crossing into the neighbouring section at either end. */
  const stepBlock = (sectionIndex: number, blockIndex: number, dir: -1 | 1) => {
    const section = sections[sectionIndex];
    const block = section.blocks[blockIndex];
    const target = blockIndex + dir;
    let toSection = section;
    let toIndex = target;
    if (target < 0 || target >= section.blocks.length) {
      const neighbour = sections[sectionIndex + dir];
      if (!neighbour) return;
      toSection = neighbour;
      toIndex = dir < 0 ? neighbour.blocks.length : 0;
    }
    onEdit({ type: 'moveBlock', sectionId: section.id, blockId: block.id, toSectionId: toSection.id, toIndex });
    if (toSection.id !== section.id) {
      setCollapsed((prev) => {
        if (!prev.has(toSection.id)) return prev;
        const next = new Set(prev);
        next.delete(toSection.id);
        return next;
      });
      if (selection.kind === 'block' && selection.blockId === block.id)
        onSelect({ kind: 'block', sectionId: toSection.id, blockId: block.id });
    }
  };

  const openPicker = (sectionId: string, index: number, anchor: string, opener: HTMLElement) => {
    pickerOpener.current = opener;
    setPicker({ sectionId, index, anchor });
  };

  const closePicker = () => {
    setPicker(null);
    pickerOpener.current?.focus();
  };

  const pickBlock = (kind: BlockKind) => {
    if (!picker) return;
    const block = createBlock(kind);
    onEdit({ type: 'insertBlock', sectionId: picker.sectionId, index: picker.index, block });
    onSelect({ kind: 'block', sectionId: picker.sectionId, blockId: block.id });
    setPicker(null);
  };

  const addSection = () => {
    const section = createSection();
    onEdit({ type: 'addSection', index: sections.length, section });
    onSelect({ kind: 'section', sectionId: section.id });
  };

  // ── Drag and drop ──

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const startDrag = (e: DragEvent<HTMLElement>, d: Dragging, key: string) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', d.type === 'block' ? d.blockId : d.sectionId);
    const row = rowRefs.current.get(key);
    if (row) e.dataTransfer.setDragImage(row, 20, 16);
    setDragging(d);
    setConfirming(null);
  };

  const sameDrop = (a: DropAt | null, b: DropAt) =>
    !!a &&
    a.type === b.type &&
    a.index === b.index &&
    (a.type === 'section' || (b.type === 'block' && a.sectionId === b.sectionId));

  const over = (e: DragEvent<HTMLElement>, at: DropAt) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!sameDrop(dropAt, at)) setDropAt(at);
  };

  const drop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragging;
    const at = dropAt;
    endDrag();
    if (!d || !at) return;
    if (d.type === 'section' && at.type === 'section') {
      const from = sections.findIndex((s) => s.id === d.sectionId);
      if (from < 0) return;
      const to = gapToIndex(at.index, from);
      if (to !== from) onEdit({ type: 'moveSection', sectionId: d.sectionId, toIndex: to });
      return;
    }
    if (d.type === 'block' && at.type === 'block') {
      const fromSection = sections.find((s) => s.id === d.sectionId);
      const from = fromSection?.blocks.findIndex((b) => b.id === d.blockId) ?? -1;
      if (from < 0) return;
      const sameSection = at.sectionId === d.sectionId;
      const to = sameSection ? gapToIndex(at.index, from) : at.index;
      if (sameSection && to === from) return;
      onEdit({ type: 'moveBlock', sectionId: d.sectionId, blockId: d.blockId, toSectionId: at.sectionId, toIndex: to });
      if (!sameSection && selection.kind === 'block' && selection.blockId === d.blockId)
        onSelect({ kind: 'block', sectionId: at.sectionId, blockId: d.blockId });
    }
  };

  /** Handlers for a section's whole group: a section drag lands before or after it. */
  const sectionGroupDrag = (index: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging?.type !== 'section') return;
      over(e, { type: 'section', index: isLowerHalf(e) ? index + 1 : index });
    },
    onDrop: drop,
  });

  /** On a section's own header row, a block drag lands at the top of that section. */
  const sectionHeaderDrag = (section: LearnSection) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging?.type !== 'block') return;
      over(e, { type: 'block', sectionId: section.id, index: 0 });
    },
    onDrop: drop,
  });

  const blockRowDrag = (section: LearnSection, index: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging?.type !== 'block') return;
      over(e, { type: 'block', sectionId: section.id, index: isLowerHalf(e) ? index + 1 : index });
    },
    onDrop: drop,
  });

  const sectionEndDrag = (section: LearnSection) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging?.type !== 'block') return;
      over(e, { type: 'block', sectionId: section.id, index: section.blocks.length });
    },
    onDrop: drop,
  });

  const showBlockDrop = (sectionId: string, index: number) =>
    dropAt?.type === 'block' && dropAt.sectionId === sectionId && dropAt.index === index;
  const showSectionDrop = (index: number) => dropAt?.type === 'section' && dropAt.index === index;

  // ── Rows ──

  const confirmRow = (key: string, text: string, onYes: () => void, isBlock: boolean) =>
    confirming === key ? (
      <div className={`le-ol-confirm${isBlock ? ' is-block' : ''}`} role="alert">
        <span>{text}</span>
        <button
          type="button"
          className="is-yes"
          onClick={() => {
            setConfirming(null);
            onYes();
          }}
        >
          Yes
        </button>
        <button
          type="button"
          className="is-no"
          onClick={() => {
            setConfirming(null);
            rowRefs.current.get(key)?.querySelector<HTMLButtonElement>('.le-ol-main')?.focus();
          }}
        >
          No
        </button>
      </div>
    ) : null;

  const handle = (d: Dragging, key: string) => (
    <span
      className="le-ol-handle"
      draggable
      role="img"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      onDragStart={(e) => startDrag(e, d, key)}
      onDragEnd={endDrag}
    >
      <Svg size={12}>{I.handle}</Svg>
    </span>
  );

  const renderBlock = (section: LearnSection, sectionIndex: number, block: LearnBlock, index: number) => {
    const key = rowKey.block(block.id);
    const selected = selectedKey === key;
    const warning = warningFor.get(block.id);
    const isDragging = dragging?.type === 'block' && dragging.blockId === block.id;
    const isFirstAnywhere = sectionIndex === 0 && index === 0;
    const isLastAnywhere = sectionIndex === sections.length - 1 && index === section.blocks.length - 1;
    const summary = blockSummary(block);

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      focusAfterRender.current = key;
      stepBlock(sectionIndex, index, e.key === 'ArrowUp' ? -1 : 1);
    };

    return (
      <li key={block.id} role="none">
        {showBlockDrop(section.id, index) && <div className="le-ol-drop is-block" aria-hidden="true" />}
        <div
          ref={registerRow(key)}
          className={`le-ol-row is-block${selected ? ' is-selected' : ''}${block.hidden ? ' is-hidden' : ''}${isDragging ? ' is-dragging' : ''}`}
          draggable
          onDragStart={(e) => startDrag(e, { type: 'block', sectionId: section.id, blockId: block.id }, key)}
          onDragEnd={endDrag}
          {...blockRowDrag(section, index)}
        >
          {handle({ type: 'block', sectionId: section.id, blockId: block.id }, key)}
          <button
            type="button"
            className="le-ol-main"
            role="treeitem"
            aria-level={2}
            aria-selected={selected}
            aria-label={`${summary}${block.hidden ? ', hidden' : ''}${warning ? `, needs attention: ${warning}` : ''}`}
            title={`${summary}. Alt and arrow keys move it.`}
            onClick={() => onSelect({ kind: 'block', sectionId: section.id, blockId: block.id })}
            onKeyDown={onKeyDown}
          >
            <span className="le-ol-kind" title={kindLabel(block.kind)}>
              <Svg>{KIND_ICON[block.kind]}</Svg>
            </span>
            <span className="le-ol-text">{summary}</span>
            {warning && <span className="le-ol-warn" title={warning} />}
            {block.hidden && (
              <span className="le-ol-flag" title="Hidden">
                <Svg size={12}>{I.eyeOff}</Svg>
              </span>
            )}
          </button>
          <span className="le-ol-actions">
            <IconButton
              label={block.hidden ? 'Show block' : 'Hide block'}
              onClick={() =>
                onEdit({ type: 'updateBlock', sectionId: section.id, blockId: block.id, patch: { hidden: !block.hidden } })
              }
            >
              {block.hidden ? I.eye : I.eyeOff}
            </IconButton>
            <IconButton
              label="Move block up"
              disabled={isFirstAnywhere}
              onClick={() => stepBlock(sectionIndex, index, -1)}
            >
              {I.up}
            </IconButton>
            <IconButton
              label="Move block down"
              disabled={isLastAnywhere}
              onClick={() => stepBlock(sectionIndex, index, 1)}
            >
              {I.down}
            </IconButton>
            <IconButton
              label="Duplicate block"
              onClick={() => onEdit({ type: 'duplicateBlock', sectionId: section.id, blockId: block.id })}
            >
              {I.copy}
            </IconButton>
            <IconButton
              label="Add a block after this one"
              onClick={() => {
                const opener = rowRefs.current.get(key)?.querySelector<HTMLButtonElement>('.le-ol-main');
                if (opener) openPicker(section.id, index + 1, key, opener);
              }}
            >
              {I.plus}
            </IconButton>
            <IconButton label="Delete block" danger onClick={() => setConfirming(key)}>
              {I.trash}
            </IconButton>
          </span>
        </div>
        {confirmRow(
          key,
          'Delete this block?',
          () => onEdit({ type: 'removeBlock', sectionId: section.id, blockId: block.id }),
          true,
        )}
        {picker?.anchor === key && (
          <div className="le-ol-pickwrap">
            <AddBlockPicker onPick={pickBlock} onClose={closePicker} />
          </div>
        )}
      </li>
    );
  };

  const renderSection = (section: LearnSection, index: number) => {
    const key = rowKey.section(section.id);
    const selected = selectedKey === key;
    const open = !collapsed.has(section.id);
    const isDragging = dragging?.type === 'section' && dragging.sectionId === section.id;
    const label = section.label.trim() || 'Untitled section';
    const groupId = `le-ol-group-${section.id}`;
    const endKey = `end:${section.id}`;

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        focusAfterRender.current = key;
        moveSectionTo(section.id, index + (e.key === 'ArrowUp' ? -1 : 1));
      } else if (!e.altKey && e.key === 'ArrowLeft' && open) {
        e.preventDefault();
        toggleCollapsed(section.id);
      } else if (!e.altKey && e.key === 'ArrowRight' && !open) {
        e.preventDefault();
        toggleCollapsed(section.id);
      }
    };

    return (
      <li key={section.id} role="none" {...sectionGroupDrag(index)}>
        {showSectionDrop(index) && <div className="le-ol-drop" aria-hidden="true" />}
        <div
          ref={registerRow(key)}
          className={`le-ol-row is-section${selected ? ' is-selected' : ''}${section.hidden ? ' is-hidden' : ''}${isDragging ? ' is-dragging' : ''}`}
          draggable
          onDragStart={(e) => startDrag(e, { type: 'section', sectionId: section.id }, key)}
          onDragEnd={endDrag}
          {...sectionHeaderDrag(section)}
        >
          {handle({ type: 'section', sectionId: section.id }, key)}
          <button
            type="button"
            className="le-ol-chev"
            aria-expanded={open}
            aria-controls={groupId}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            title={open ? 'Collapse' : 'Expand'}
            onClick={() => toggleCollapsed(section.id)}
          >
            <Svg size={12}>{I.chevron}</Svg>
          </button>
          <button
            type="button"
            className="le-ol-main"
            role="treeitem"
            aria-level={1}
            aria-selected={selected}
            aria-expanded={open}
            aria-label={`Section: ${label}${section.hidden ? ', hidden' : ''}`}
            title={`${label}. Alt and arrow keys move it.`}
            onClick={() => onSelect({ kind: 'section', sectionId: section.id })}
            onKeyDown={onKeyDown}
          >
            <span
              className="le-ol-swatch"
              style={{ background: SWATCH[section.background] }}
              title={`Background: ${SWATCH_LABEL[section.background]}`}
            />
            <span className="le-ol-text">{label}</span>
            {section.hidden && (
              <span className="le-ol-flag" title="Hidden">
                <Svg size={12}>{I.eyeOff}</Svg>
              </span>
            )}
          </button>
          <span className="le-ol-actions">
            <IconButton
              label={section.hidden ? 'Show section' : 'Hide section'}
              onClick={() => onEdit({ type: 'updateSection', sectionId: section.id, patch: { hidden: !section.hidden } })}
            >
              {section.hidden ? I.eye : I.eyeOff}
            </IconButton>
            <IconButton label="Move section up" disabled={index === 0} onClick={() => moveSectionTo(section.id, index - 1)}>
              {I.up}
            </IconButton>
            <IconButton
              label="Move section down"
              disabled={index === sections.length - 1}
              onClick={() => moveSectionTo(section.id, index + 1)}
            >
              {I.down}
            </IconButton>
            <IconButton label="Duplicate section" onClick={() => onEdit({ type: 'duplicateSection', sectionId: section.id })}>
              {I.copy}
            </IconButton>
            <IconButton label="Delete section" danger onClick={() => setConfirming(key)}>
              {I.trash}
            </IconButton>
          </span>
        </div>
        {confirmRow(
          key,
          section.blocks.length
            ? `Delete this section and its ${section.blocks.length} ${section.blocks.length === 1 ? 'block' : 'blocks'}?`
            : 'Delete this section?',
          () => onEdit({ type: 'removeSection', sectionId: section.id }),
          false,
        )}
        {open && (
          <>
            <ul id={groupId} role="group">
              {section.blocks.map((b, i) => renderBlock(section, index, b, i))}
              {showBlockDrop(section.id, section.blocks.length) && (
                <li className="le-ol-drop is-block" aria-hidden="true" />
              )}
            </ul>
            {section.blocks.length === 0 && <div className="le-ol-empty">No blocks yet</div>}
            <div className="le-ol-addrow" {...sectionEndDrag(section)}>
              <button
                type="button"
                className="le-ol-add"
                onClick={(e) => openPicker(section.id, section.blocks.length, endKey, e.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={picker?.anchor === endKey}
              >
                <Svg size={12}>{I.plus}</Svg>
                Add block
              </button>
              {picker?.anchor === endKey && <AddBlockPicker onPick={pickBlock} onClose={closePicker} />}
            </div>
          </>
        )}
      </li>
    );
  };

  const pageSelected = selectedKey === rowKey.page;

  return (
    <nav ref={navRef} className="le-ol" aria-label="Page outline">
      <ul role="tree" aria-label="Page outline">
        <li role="none">
          <div ref={registerRow(rowKey.page)} className={`le-ol-row is-page${pageSelected ? ' is-selected' : ''}`}>
            <span className="le-ol-chev-space" />
            <button
              type="button"
              className="le-ol-main"
              role="treeitem"
              aria-level={1}
              aria-selected={pageSelected}
              onClick={() => onSelect({ kind: 'page' })}
            >
              <span className="le-ol-kind">
                <Svg>{I.page}</Svg>
              </span>
              <span className="le-ol-text">Page settings</span>
            </button>
          </div>
        </li>
        {sections.map(renderSection)}
        {showSectionDrop(sections.length) && <li className="le-ol-drop" aria-hidden="true" />}
      </ul>
      <div
        className="le-ol-addrow is-section"
        onDragOver={(e) => {
          if (dragging?.type !== 'section') return;
          over(e, { type: 'section', index: sections.length });
        }}
        onDrop={drop}
      >
        <button type="button" className="le-ol-add" onClick={addSection}>
          <Svg size={12}>{I.plus}</Svg>
          Add section
        </button>
      </div>
    </nav>
  );
}
