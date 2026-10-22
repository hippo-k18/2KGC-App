'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BLOCK_CATEGORIES, searchBlockKinds, type BlockCategory, type BlockKind } from '@/lib/learn-editor-core';
import './outline.css';

const BLUE = '#2069bc';
const GREY = '#c4ccd6';
const GREY_DARK = '#8a96a6';
const PALE = '#e7f1fb';

/** A miniature of each block, 72 by 48, so the choice reads at a glance. */
const THUMBS: Record<BlockKind, ReactNode> = {
  heading: (
    <>
      <rect x="12" y="16" width="48" height="8" rx="2" fill={BLUE} />
      <rect x="20" y="30" width="32" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  text: (
    <>
      <rect x="10" y="12" width="52" height="3" rx="1.5" fill={GREY_DARK} />
      <rect x="10" y="19" width="48" height="3" rx="1.5" fill={GREY} />
      <rect x="10" y="26" width="52" height="3" rx="1.5" fill={GREY} />
      <rect x="10" y="33" width="34" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  image: (
    <>
      <rect x="14" y="8" width="44" height="32" rx="3" fill={PALE} stroke={BLUE} strokeWidth="1.5" />
      <circle cx="47" cy="17" r="4" fill={BLUE} opacity="0.55" />
      <path d="M16 38 L30 22 L40 32 L46 26 L56 38 Z" fill={BLUE} />
    </>
  ),
  buttons: (
    <>
      <rect x="8" y="18" width="26" height="12" rx="6" fill={BLUE} />
      <rect x="38" y="18" width="26" height="12" rx="6" fill="#fff" stroke={BLUE} strokeWidth="1.5" />
    </>
  ),
  people: (
    <>
      {[16, 36, 56].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="17" r="7" fill={BLUE} opacity={cx === 36 ? 1 : 0.7} />
          <rect x={cx - 8} y="29" width="16" height="3" rx="1.5" fill={GREY_DARK} />
          <rect x={cx - 6} y="35" width="12" height="2.5" rx="1.25" fill={GREY} />
        </g>
      ))}
    </>
  ),
  list: (
    <>
      {[13, 23, 33].map((y, i) => (
        <g key={y}>
          <circle cx="15" cy={y + 1.5} r="2.5" fill={BLUE} />
          <rect x="22" y={y} width={i === 1 ? 30 : 40} height="3" rx="1.5" fill={GREY} />
        </g>
      ))}
    </>
  ),
  columns: (
    <>
      {[8, 29, 50].map((x) => (
        <g key={x}>
          <rect x={x} y="10" width="15" height="12" rx="2" fill={PALE} stroke={BLUE} strokeWidth="1.2" />
          <rect x={x} y="26" width="15" height="3" rx="1.5" fill={GREY_DARK} />
          <rect x={x} y="32" width="12" height="2.5" rx="1.25" fill={GREY} />
        </g>
      ))}
    </>
  ),
  video: (
    <>
      <rect x="12" y="8" width="48" height="32" rx="3" fill={BLUE} />
      <path d="M32 17 L32 31 L43 24 Z" fill="#fff" />
    </>
  ),
  divider: (
    <>
      <rect x="10" y="12" width="52" height="3" rx="1.5" fill={GREY} />
      <rect x="10" y="23" width="52" height="2" fill={BLUE} />
      <rect x="10" y="33" width="52" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  spacer: (
    <>
      <rect x="12" y="10" width="48" height="28" rx="2" fill="none" stroke={GREY_DARK} strokeWidth="1.2" strokeDasharray="3 2" />
      <path d="M36 14 L36 34 M32 18 L36 14 L40 18 M32 30 L36 34 L40 30" fill="none" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  imageText: (
    <>
      <rect x="8" y="10" width="26" height="28" rx="3" fill={PALE} stroke={BLUE} strokeWidth="1.2" />
      <path d="M10 36 L20 24 L27 31 L32 27 L32 36 Z" fill={BLUE} />
      <rect x="40" y="14" width="24" height="4" rx="2" fill={GREY_DARK} />
      <rect x="40" y="22" width="22" height="3" rx="1.5" fill={GREY} />
      <rect x="40" y="28" width="18" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  gallery: (
    <>
      {[[8, 8], [29, 8], [50, 8], [8, 26], [29, 26], [50, 26]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="15" height="14" rx="2" fill={PALE} stroke={BLUE} strokeWidth="1" />
      ))}
    </>
  ),
  quote: (
    <>
      <path d="M14 14 h6 v6 l-3 6 h-3 l3 -6 h-3 z M24 14 h6 v6 l-3 6 h-3 l3 -6 h-3 z" fill={BLUE} />
      <rect x="34" y="16" width="28" height="3" rx="1.5" fill={GREY_DARK} />
      <rect x="34" y="23" width="24" height="3" rx="1.5" fill={GREY} />
      <rect x="14" y="33" width="20" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  callout: (
    <>
      <rect x="8" y="10" width="56" height="28" rx="3" fill={PALE} stroke={BLUE} strokeWidth="1.2" />
      <circle cx="17" cy="19" r="4" fill={BLUE} />
      <rect x="25" y="17" width="30" height="4" rx="2" fill={GREY_DARK} />
      <rect x="25" y="26" width="32" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  accordion: (
    <>
      {[9, 21, 33].map((y, i) => (
        <g key={y}>
          <rect x="8" y={y} width="56" height="9" rx="2" fill={i === 0 ? PALE : '#fff'} stroke={GREY_DARK} strokeWidth="1" />
          <rect x="12" y={y + 3} width="28" height="3" rx="1.5" fill={GREY_DARK} />
          <path d={`M58 ${y + 3} l-3 3 l-3 -3`} fill="none" stroke={BLUE} strokeWidth="1.3" />
        </g>
      ))}
    </>
  ),
  tabs: (
    <>
      <rect x="8" y="10" width="18" height="8" rx="2" fill={BLUE} />
      <rect x="28" y="10" width="18" height="8" rx="2" fill="#fff" stroke={GREY_DARK} strokeWidth="1" />
      <rect x="8" y="18" width="56" height="20" rx="2" fill="#fff" stroke={BLUE} strokeWidth="1.2" />
      <rect x="13" y="24" width="40" height="3" rx="1.5" fill={GREY} />
      <rect x="13" y="30" width="30" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  stats: (
    <>
      {[16, 36, 56].map((cx) => (
        <g key={cx}>
          <rect x={cx - 8} y="13" width="16" height="9" rx="2" fill={BLUE} />
          <rect x={cx - 7} y="27" width="14" height="3" rx="1.5" fill={GREY} />
        </g>
      ))}
    </>
  ),
  cards: (
    <>
      {[8, 29, 50].map((x) => (
        <g key={x}>
          <rect x={x} y="8" width="15" height="32" rx="2" fill="#fff" stroke={GREY_DARK} strokeWidth="1" />
          <rect x={x} y="8" width="15" height="11" rx="2" fill={PALE} />
          <rect x={x + 2} y="23" width="11" height="3" rx="1.5" fill={GREY_DARK} />
          <rect x={x + 2} y="30" width="9" height="2.5" rx="1.25" fill={BLUE} />
        </g>
      ))}
    </>
  ),
  logos: (
    <>
      <rect x="8" y="19" width="14" height="10" rx="2" fill={GREY_DARK} />
      <circle cx="36" cy="24" r="6" fill={GREY_DARK} />
      <path d="M50 30 L57 18 L64 30 Z" fill={GREY_DARK} />
    </>
  ),
  embed: (
    <>
      <rect x="12" y="8" width="48" height="32" rx="3" fill="#fff" stroke={BLUE} strokeWidth="1.4" />
      <path d="M30 18 l-6 6 l6 6 M42 18 l6 6 l-6 6" fill="none" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  countdown: (
    <>
      {[10, 28, 46].map((x) => (
        <g key={x}>
          <rect x={x} y="12" width="16" height="16" rx="2" fill={BLUE} />
          <rect x={x + 3} y="32" width="10" height="3" rx="1.5" fill={GREY} />
        </g>
      ))}
    </>
  ),
  table: (
    <>
      <rect x="8" y="9" width="56" height="30" rx="2" fill="#fff" stroke={GREY_DARK} strokeWidth="1" />
      <rect x="8" y="9" width="56" height="8" rx="2" fill={PALE} />
      <path d="M8 17 H64 M8 24.5 H64 M8 32 H64 M26 9 V39 M45 9 V39" stroke={GREY_DARK} strokeWidth="0.8" />
    </>
  ),
  toc: (
    <>
      <rect x="10" y="9" width="24" height="4" rx="2" fill={GREY_DARK} />
      {[18, 25, 32].map((y, i) => (
        <g key={y}>
          <rect x="12" y={y} width="3" height="3" rx="1" fill={BLUE} />
          <rect x="18" y={y} width={i === 1 ? 28 : 36} height="3" rx="1.5" fill={BLUE} opacity="0.7" />
        </g>
      ))}
    </>
  ),
  reusable: (
    <>
      <rect x="10" y="10" width="40" height="22" rx="3" fill="#fff" stroke={GREY_DARK} strokeWidth="1" strokeDasharray="3 2" />
      <rect x="22" y="16" width="40" height="22" rx="3" fill={PALE} stroke={BLUE} strokeWidth="1.2" />
      <path d="M36 27 a5 5 0 1 1 5 5 M41 32 l-3 0 l0 -3" fill="none" stroke={BLUE} strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
};

export function BlockThumb({ kind }: { kind: BlockKind }) {
  return (
    <svg className="le-pick-thumb" width="72" height="48" viewBox="0 0 72 48" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="71" height="47" rx="4" fill="#fff" stroke="#dde3ea" />
      {THUMBS[kind]}
    </svg>
  );
}

const COLS = 2;

type Filter = 'All' | BlockCategory;

/**
 * Add a block: search and categories over every block kind (T318). Typing
 * filters at once; arrow keys move from the search box into the grid and
 * around it; Enter adds; Escape closes.
 */
export function AddBlockPicker({
  onPick,
  onClose,
}: {
  onPick: (kind: BlockKind) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = useRef(onClose);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const searchId = useId();
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const kinds = useMemo(
    () => searchBlockKinds(query).filter((k) => query.trim() !== '' || filter === 'All' || k.category === filter),
    [query, filter],
  );
  itemRefs.current.length = kinds.length;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const items = itemRefs.current;
    if (e.target === searchRef.current) {
      if (e.key === 'ArrowDown' && kinds.length > 0) {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'Enter' && kinds.length > 0) {
        e.preventDefault();
        onPick(kinds[0].kind);
      }
      return;
    }
    const current = items.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const last = kinds.length - 1;
    let next = current;
    if (e.key === 'ArrowRight') next = Math.min(last, current + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (e.key === 'ArrowDown') next = Math.min(last, current + COLS);
    else if (e.key === 'ArrowUp') {
      if (current < COLS) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      next = current - COLS;
    } else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    items[next]?.focus();
  };

  const searching = query.trim() !== '';

  return (
    <div ref={rootRef} className="le-pick" role="dialog" aria-label="Add a block" onKeyDown={onKeyDown}>
      <div className="le-pick-head">Add a block</div>
      <label className="le-pick-search" htmlFor={searchId}>
        <span className="sr-only">Search blocks</span>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          placeholder="Search, for example map, faq or photo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="le-pick-cats" role="radiogroup" aria-label="Kind of block" aria-disabled={searching || undefined}>
        {(['All', ...BLOCK_CATEGORIES] as Filter[]).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={!searching && filter === c}
            className={`le-pick-cat${!searching && filter === c ? ' is-on' : ''}`}
            onClick={() => {
              setFilter(c);
              setQuery('');
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {kinds.length === 1 ? '1 block' : `${kinds.length} blocks`}
      </p>
      {kinds.length === 0 ? (
        <p className="le-pick-none">No block matches &quot;{query}&quot;. Try another word.</p>
      ) : (
        <div className="le-pick-grid">
          {kinds.map((k, i) => (
            <button
              key={k.kind}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              className="le-pick-item"
              onClick={() => onPick(k.kind)}
            >
              <BlockThumb kind={k.kind} />
              <span className="le-pick-text">
                <span className="le-pick-label">{k.label}</span>
                <span className="le-pick-hint">{k.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
