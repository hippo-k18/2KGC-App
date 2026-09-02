'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MIN_QUERY,
  RESULT_LIMIT,
  highlight,
  searchFeatures,
  type Hit,
  type SearchEntry,
} from '@/lib/feature-search-core';

/**
 * The feature search in the dark header.
 *
 * Whova has one and it is the single most useful thing in their chrome: 215
 * screens is far too many to navigate by clicking, and an organizer who knows
 * they want "badges" should not have to remember that badges live under
 * Attendees. The first pass rendered this as a disabled box, which was the
 * wrong call — we already ship the entire nav tree to the client for the
 * sidebar, so the index costs nothing extra.
 *
 * Matching, ranking, aliases and highlighting live in
 * `@/lib/feature-search-core`, covered by `tests/programme/feature-search.test.ts`.
 * This file is the input, the dropdown and the keyboard handling, and nothing
 * else — the ranking is subtle enough that it was quietly wrong for weeks while
 * looking fine.
 *
 * Five things here are deliberate:
 *
 *   - **`/` and ⌘K focus it from anywhere.** The whole point is to stop
 *     organizers hunting through a nine-tab, three-level tree; making them
 *     first hunt for the search box with a mouse gives most of that back.
 *   - **Empty and focused, it offers the nine sections.** A box that shows
 *     nothing until you type does not tell a first-time organizer what it
 *     searches, and the sections double as the fastest way in when you know
 *     the area but not the screen.
 *   - **The matched text is emboldened** so a list of twenty near-identical
 *     "Ticket …" titles can be scanned rather than read.
 *   - **An alias hit says which word found it** — "matched 'refund'" under
 *     Attendee Orders. Without it the top result for "refund" looks like a
 *     mistake, and a search box you do not trust is one you stop using.
 *   - **The list shows up to `RESULT_LIMIT` rows and then says how many more
 *     matched.** "ticket" matches 61 of the 215 nodes; silently showing 8 of
 *     those and saying nothing is how the previous version made an organizer
 *     believe a screen did not exist.
 */
export type { SearchEntry };

/** Offered when the box is focused and empty — the nine top-level tabs. */
function sections(entries: SearchEntry[]): SearchEntry[] {
  return entries.filter((e) => !e.path.includes('/'));
}

export function FeatureSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const searched = q.trim().length >= MIN_QUERY;
  const { hits, total } = useMemo(
    () => searchFeatures(entries, q, RESULT_LIMIT),
    [q, entries],
  );
  const top = useMemo(() => sections(entries), [entries]);

  /** What the arrow keys walk: real hits once typing, the sections before that. */
  const rows: Hit[] = searched ? hits : q.trim() ? [] : top;

  useEffect(() => setActive(0), [q]);

  // Keep the highlighted row visible; the list scrolls past what the box shows.
  useEffect(() => {
    const el = list.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, rows.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // `/` and ⌘K from anywhere. Ignored while the caret is in another field, or
  // an organizer typing a slash into a session title would lose it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable === true;
      const shortcut = e.key === '/' ? !typing : (e.metaKey || e.ctrlKey) && e.key === 'k';
      if (!shortcut) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    setQ('');
  }, []);

  return (
    <div ref={box} className="feature-search">
      <input
        ref={input}
        className="feature-search-input"
        placeholder="Search features"
        aria-label="Search features"
        aria-expanded={open && rows.length > 0}
        aria-controls="feature-search-results"
        role="combobox"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            input.current?.blur();
            return;
          }
          if (!rows.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % rows.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + rows.length) % rows.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            router.push(`/${rows[active].path}`);
            dismiss();
            input.current?.blur();
          }
        }}
      />
      {q ? null : <span className="feature-search-key" aria-hidden="true">/</span>}

      {open && rows.length > 0 ? (
        <div className="whova-menu align-end" style={{ minWidth: 340 }}>
          {!searched ? (
            <div className="feature-search-note" style={{ borderBottom: '1px solid #e3e6ec' }}>
              Jump to a section, or type to search all {entries.length} screens.
            </div>
          ) : null}

          <div
            ref={list}
            id="feature-search-results"
            role="listbox"
            aria-label="Matching features"
            style={{ maxHeight: 420, overflowY: 'auto' }}
          >
            {rows.map((h, i) => (
              <Link
                key={h.path}
                className="whova-menu-item"
                href={`/${h.path}`}
                role="option"
                aria-selected={i === active}
                style={{
                  background: i === active ? '#e9ecf1' : undefined,
                  height: 'auto',
                  padding: '8px 12px',
                }}
                onClick={dismiss}
                onMouseEnter={() => setActive(i)}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>
                    {highlight(h.title, q).map((run, n) =>
                      run.hit ? <b key={n}>{run.text}</b> : <span key={n}>{run.text}</span>,
                    )}
                  </span>
                  <span style={{ color: 'var(--muted)', display: 'block', fontSize: 12 }}>
                    {h.via ? `matched “${h.via}” · ` : ''}
                    {h.trail || 'Top level'}
                  </span>
                </span>
                {h.built ? (
                  <span className="whova-tag-main green-tag outline-tag small">built</span>
                ) : null}
              </Link>
            ))}
          </div>

          {searched && total > rows.length ? (
            <div className="feature-search-note" style={{ borderTop: '1px solid #e3e6ec' }}>
              {total - rows.length} more match “{q.trim()}”. Keep typing to narrow it.
            </div>
          ) : null}
        </div>
      ) : null}

      {open && searched && hits.length === 0 ? (
        <div className="whova-menu align-end" style={{ minWidth: 300 }}>
          <div className="feature-search-note">
            No feature matches “{q.trim()}”. Try the words on the tab you want —
            “tickets”, “attendees”, “agenda”.
          </div>
        </div>
      ) : null}
    </div>
  );
}
