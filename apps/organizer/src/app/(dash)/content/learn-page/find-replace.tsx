'use client';

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { LearnPageContent } from '@kgc/shared';
import type { EditAction } from '@/lib/learn-editor-core';
import { findInPage, replaceInPage, type FindMatch, type FindOptions, type Where } from '@/lib/learn-tools-core';
import './tools.css';

/**
 * Find and replace over every piece of text on the page (T318).
 *
 * The search runs in `learn-tools-core`, so a result names the same place the
 * outline shows and `onJump` can select it. Every replace goes through
 * `onEdit` as one `replace` action, so a single Undo brings back everything a
 * "Replace all" changed.
 */

/** Context strings are cut at this many characters by findInPage; a full one means there is more. */
const CONTEXT = 30;

interface Group {
  key: string;
  title: string;
  items: { match: FindMatch; index: number }[];
}

function groupBySection(content: LearnPageContent, matches: FindMatch[]): Group[] {
  const groups = new Map<string, Group>();
  matches.forEach((match, index) => {
    const key = match.where.sectionId ?? '';
    let g = groups.get(key);
    if (!g) {
      const section = content.sections.find((s) => s.id === key);
      g = { key, title: key ? section?.label || 'Untitled section' : 'Page settings', items: [] };
      groups.set(key, g);
    }
    g.items.push({ match, index });
  });
  return [...groups.values()];
}

function countLabel(n: number): string {
  return n === 1 ? '1 match' : `${n} matches`;
}

export function FindReplacePanel({
  content,
  onEdit,
  onJump,
  onClose,
}: {
  content: LearnPageContent;
  onEdit: (action: EditAction) => void;
  onJump: (where: Where) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [confirmAll, setConfirmAll] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** The row whose Replace was pressed; that row is gone once the edit lands. */
  const refocus = useRef<number | null>(null);
  const ids = useId();

  // Deferred, so typing stays smooth on a long page while the walk catches up.
  const deferredQuery = useDeferredValue(query);
  const opts: FindOptions = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);
  const matches = useMemo(() => findInPage(content, deferredQuery, opts), [content, deferredQuery, opts]);
  const groups = useMemo(() => groupBySection(content, matches), [content, matches]);
  // The index can outlive a shorter list after an edit; clamp rather than reset.
  const cur = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);

  useEffect(() => {
    findRef.current?.focus();
  }, []);

  // Keep focus in the list after a single replace: the next match takes the
  // replaced one's place, or the Find box when none are left.
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>('.le-tools-result-replace');
    const target = rows?.[Math.min(at, rows.length - 1)];
    (target ?? findRef.current)?.focus();
  }, [matches]);

  useEffect(() => {
    if (confirmAll) cancelRef.current?.focus();
  }, [confirmAll]);

  useEffect(() => {
    if (cur < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const changeSearch = (fn: () => void) => {
    fn();
    setCurrent(-1);
    setConfirmAll(false);
    setDone(null);
  };

  const go = (index: number) => {
    const m = matches[index];
    if (!m) return;
    setCurrent(index);
    onJump(m.where);
  };

  const step = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const from = cur < 0 ? (dir === 1 ? -1 : 0) : cur;
    go((from + dir + matches.length) % matches.length);
  };

  const replaceOne = (m: FindMatch, index: number) => {
    const res = replaceInPage(content, deferredQuery, replacement, opts, m.id);
    if (res.count === 0) return;
    onEdit({ type: 'replace', content: res.content });
    setConfirmAll(false);
    refocus.current = index;
    setDone('Replaced 1. Undo brings it back.');
  };

  // The confirmation's buttons unmount on close, so focus needs somewhere to go.
  const cancelConfirm = () => {
    setConfirmAll(false);
    findRef.current?.focus();
  };

  const replaceAll = () => {
    const res = replaceInPage(content, deferredQuery, replacement, opts);
    setConfirmAll(false);
    if (res.count === 0) return;
    onEdit({ type: 'replace', content: res.content });
    setCurrent(-1);
    setDone(`Replaced ${res.count}. Undo brings ${res.count === 1 ? 'it' : 'them'} back.`);
    findRef.current?.focus();
  };

  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    // An open confirmation is the nearest thing to close.
    if (confirmAll) cancelConfirm();
    else onClose();
  };

  const stale = deferredQuery !== query;
  const status = !deferredQuery
    ? ''
    : matches.length === 0
      ? 'No matches'
      : cur >= 0
        ? `${cur + 1} of ${countLabel(matches.length)}`
        : countLabel(matches.length);

  return (
    <div className="le-tools-panel" role="region" aria-label="Find and replace" onKeyDown={onRootKey}>
      <div className="le-tools-head">
        <h2 className="le-tools-title">Find and replace</h2>
        <button type="button" className="le-tools-close" onClick={onClose} aria-label="Close find and replace">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="le-tools-body">
        <div className="le-tools-field">
          <label className="le-tools-label" htmlFor={`${ids}-find`}>
            Find
          </label>
          <div className="le-tools-find-row">
            <input
              ref={findRef}
              id={`${ids}-find`}
              className="whova-text-input"
              type="search"
              value={query}
              onChange={(e) => changeSearch(() => setQuery(e.target.value))}
              onKeyDown={onFindKey}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${ids}-count`}
            />
            <button
              type="button"
              className="le-tools-step"
              onClick={() => step(-1)}
              disabled={matches.length === 0}
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="le-tools-step"
              onClick={() => step(1)}
              disabled={matches.length === 0}
              aria-label="Next match"
              title="Next match (Enter)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="le-tools-field">
          <label className="le-tools-label" htmlFor={`${ids}-replace`}>
            Replace with
          </label>
          <input
            id={`${ids}-replace`}
            className="whova-text-input"
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
              setConfirmAll(false);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="le-tools-options">
          <label className="le-tools-check">
            <input type="checkbox" checked={matchCase} onChange={(e) => changeSearch(() => setMatchCase(e.target.checked))} />
            Match case
          </label>
          <label className="le-tools-check">
            <input type="checkbox" checked={wholeWord} onChange={(e) => changeSearch(() => setWholeWord(e.target.checked))} />
            Whole word
          </label>
        </div>

        <div className="le-tools-count-row">
          <span id={`${ids}-count`} className="le-tools-count" aria-live="polite" aria-busy={stale}>
            {status}
          </span>
          {!confirmAll && (
            <button
              type="button"
              className="btn btn-default btn-sm"
              onClick={() => {
                setDone(null);
                setConfirmAll(true);
              }}
              disabled={stale || matches.length === 0}
            >
              Replace all
            </button>
          )}
        </div>

        {confirmAll && (
          <div className="le-tools-confirm" role="group" aria-labelledby={`${ids}-confirm`}>
            <p id={`${ids}-confirm`}>
              {replacement
                ? `Replace ${countLabel(matches.length)} with "${replacement}"?`
                : `Remove ${countLabel(matches.length)}? The replacement is empty.`}
            </p>
            <div className="le-tools-confirm-actions">
              {/* Focus lands on Cancel, so a stray Enter does not change the page. */}
              <button type="button" className="btn btn-default btn-sm" onClick={cancelConfirm} ref={cancelRef}>
                Cancel
              </button>
              <button type="button" className="whova-btn-main small" onClick={replaceAll}>
                Replace {matches.length}
              </button>
            </div>
          </div>
        )}

        <p className="le-tools-done" role="status">
          {done}
        </p>

        {groups.length > 0 && (
          <div className="le-tools-results" ref={listRef}>
            {groups.map((g) => (
              <section key={g.key} className="le-tools-group" aria-labelledby={`${ids}-g-${g.key}`}>
                <h3 id={`${ids}-g-${g.key}`} className="le-tools-group-title">
                  {g.title} <span className="le-count">{g.items.length}</span>
                </h3>
                <ul className="le-tools-list">
                  {g.items.map(({ match: m, index }) => (
                    <li
                      key={m.id}
                      data-index={index}
                      className={`le-tools-result${index === cur ? ' is-current' : ''}`}
                    >
                      <button
                        type="button"
                        className="le-tools-result-main"
                        onClick={() => go(index)}
                        aria-current={index === cur ? 'true' : undefined}
                      >
                        <span className="le-tools-result-field">{m.where.field}</span>
                        <span className="le-tools-result-text">
                          {m.before.length >= CONTEXT && '…'}
                          {m.before}
                          <mark>{m.match}</mark>
                          {m.after}
                          {m.after.length >= CONTEXT && '…'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="le-tools-result-replace"
                        onClick={() => replaceOne(m, index)}
                        disabled={stale}
                        aria-label={`Replace "${m.match}" in ${m.where.field}`}
                      >
                        Replace
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
