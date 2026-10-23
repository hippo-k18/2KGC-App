'use client';

import { useState } from 'react';
import type { BlockKind } from '@/lib/learn-editor-core';
import { AddBlockPicker } from '../add-block-picker';

/**
 * The "+" between blocks on the page (T329): hover the gap, press +, pick a
 * block, and it appears right there. The same picker as the outline's.
 */
export function InsertGap({ onInsert, last = false }: { onInsert: (kind: BlockKind) => void; last?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lp-gap${last ? ' is-last' : ''}`} data-open={open || undefined} onClick={(e) => e.stopPropagation()}>
      <button
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
      {open && (
        <div className="lp-gap-pick">
          <AddBlockPicker
            onPick={(kind) => {
              setOpen(false);
              onInsert(kind);
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
