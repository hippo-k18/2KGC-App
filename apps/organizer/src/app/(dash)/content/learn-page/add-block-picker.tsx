'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { BLOCK_KINDS, type BlockKind } from '@/lib/learn-editor-core';
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

export function AddBlockPicker({
  onPick,
  onClose,
}: {
  onPick: (kind: BlockKind) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const items = itemRefs.current;
    const current = items.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const last = BLOCK_KINDS.length - 1;
    let next = current;
    if (e.key === 'ArrowRight') next = Math.min(last, current + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (e.key === 'ArrowDown') next = Math.min(last, current + COLS);
    else if (e.key === 'ArrowUp') next = Math.max(0, current - COLS);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="le-pick" role="dialog" aria-label="Add a block" onKeyDown={onKeyDown}>
      <div className="le-pick-head">Add a block</div>
      <div className="le-pick-grid">
        {BLOCK_KINDS.map((k, i) => (
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
    </div>
  );
}
