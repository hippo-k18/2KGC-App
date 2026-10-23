'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { BlockKind } from '@/lib/learn-editor-core';
import { AddBlockPicker } from '../add-block-picker';
import { floatingLayer } from './fields';

const PICKER_WIDTH = 420;
const MARGIN = 12;

/**
 * The "+" between blocks on the page (T329): hover the gap, press +, pick a
 * block, and it appears right there. The same picker as the outline's.
 *
 * The picker is drawn outside the preview frame, which is zoomed to fit its
 * pane, so it keeps its real size and cannot be cut off by the frame's edge.
 * It opens under the + (or over it near the bottom of the window), and on a
 * phone it is a sheet along the bottom.
 */
export function InsertGap({ onInsert, last = false }: { onInsert: (kind: BlockKind) => void; last?: boolean }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw < 700) {
        setStyle({ position: 'fixed', left: 0, right: 0, bottom: 0 });
        return;
      }
      const width = Math.min(PICKER_WIDTH, vw - 2 * MARGIN);
      const left = Math.max(MARGIN, Math.min(vw - width - MARGIN, r.left + r.width / 2 - width / 2));
      const below = vh - r.bottom;
      setStyle(
        below > 360 || below > r.top
          ? { position: 'fixed', left, width, top: r.bottom + 8, maxHeight: below - 20 }
          : { position: 'fixed', left, width, bottom: vh - r.top + 8, maxHeight: r.top - 20 },
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  return (
    <div className={`lp-gap${last ? ' is-last' : ''}`} data-open={open || undefined} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btn}
        type="button"
        className="lp-gap-btn"
        aria-label={last ? 'Add a block at the end' : 'Add a block here'}
        title="Add something here"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        style &&
        createPortal(
          <div className="lp-gap-pick" style={style} onClick={(e) => e.stopPropagation()}>
            <AddBlockPicker
              onPick={(kind) => {
                setOpen(false);
                onInsert(kind);
              }}
              onClose={() => {
                setOpen(false);
                btn.current?.focus();
              }}
            />
          </div>,
          floatingLayer(),
        )}
    </div>
  );
}
