'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The interactive bits Whova's screens lean on and ours were faking.
 *
 * Everything here is a `<details>`-backed or `useState`-backed popover rather
 * than a positioned portal. Whova uses react-bootstrap with popper; that buys
 * collision detection against the viewport edge, which matters when a menu
 * opens near the bottom of a 2000px page. It is not worth a dependency here —
 * this dashboard's menus have at most six items and sit inside a 1060px box —
 * but it is the one place these are genuinely less capable than theirs, so it
 * is written down rather than discovered.
 *
 * The horizontal half of that collision detection is no longer missing, and the
 * reason is worth keeping. `RowActions` hangs its menu off the *right* edge of a
 * 24px button, so the panel reaches 150px to the left of wherever the button
 * sits. On a laptop that is harmless. On a phone, where a table row is a card
 * and the button is near the left margin, the whole menu landed at a negative
 * x: the labels were sliced down their left side and none of the items could be
 * hit. `useNudgeIntoView` below measures the open panel once and slides it back
 * inside the window. The vertical half is still absent, and still fine: these
 * menus are short and a phone scrolls.
 */

/**
 * Slide an open popover back inside the window if either edge is outside it.
 *
 * Measured rather than guessed, because which edge overflows depends on where
 * the trigger happens to sit, and a CSS rule that flips every `align-end` menu
 * to the left on narrow screens just moves the overflow to the other side for
 * every trigger near the right margin.
 */
function useNudgeIntoView(open: boolean) {
  const panel = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setLeft(null);
      return;
    }
    const el = panel.current;
    // The offset parent is `.whova-dropdown`, which is `position: relative`, so
    // a `left` on the panel is measured from it.
    const anchor = el?.offsetParent as HTMLElement | null | undefined;
    if (!el || !anchor) return;

    /*
     * The edges the panel actually has to stay inside, which are not always the
     * window's.
     *
     * A table sits in `.whova-table-wrapper`, which is `overflow-x: auto` so a
     * wide table can be swiped. That makes it a clipping box, and a menu pushed
     * to the window's left margin is then cut off at the wrapper's instead: the
     * first attempt at this moved the panel to x=8, measured it as fully inside
     * the window, and still lost the first letter of every label on screen.
     */
    const bounds = () => {
      let low = 0;
      let high = document.documentElement.clientWidth;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        if (a === document.body || a === document.documentElement) continue;
        const r = a.getBoundingClientRect();
        low = Math.max(low, r.left);
        high = Math.min(high, r.right);
      }
      return { low, high };
    };

    const place = () => {
      /*
       * `left`, not `transform`. A translate is composited: it moves where the
       * panel is drawn without moving the box it is clipped against, so inside
       * that same wrapper the panel went on being cut where it used to be.
       * Setting `left` moves the box itself.
       *
       * Cleared first so the measurement is of where CSS would put the panel,
       * not of where the last run put it. React writes the style attribute back
       * on the render that `setLeft` schedules.
       */
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      const r = el.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      const { low, high } = bounds();
      const gutter = 8;
      if (r.left < low + gutter) setLeft(Math.round(low + gutter - a.left));
      else if (r.right > high - gutter) setLeft(Math.round(high - gutter - r.width - a.left));
      else setLeft(null);
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  return {
    ref: panel,
    style: left === null ? undefined : { left, right: 'auto' as const },
  };
}

export interface MenuItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Rendered as a small uppercase group heading above this item. */
  section?: string;
}

/**
 * A real dropdown. Closes on outside click and on Escape, which the disabled
 * `Export ▾` buttons this replaces obviously did not.
 */
export function Dropdown({
  label,
  items,
  className = 'btn btn-default',
  align = 'start',
}: {
  label: ReactNode;
  items: MenuItem[];
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const nudge = useNudgeIntoView(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="whova-dropdown" ref={box}>
      <button
        type="button"
        className={className}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          className={`whova-menu${align === 'end' ? ' align-end' : ''}`}
          role="menu"
          ref={nudge.ref}
          style={nudge.style}
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.section ? <div className="whova-section-header">{it.section}</div> : null}
              {it.href && !it.disabled ? (
                <Link
                  className={`whova-menu-item${it.danger ? ' danger' : ''}`}
                  href={it.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  {it.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className={`whova-menu-item${it.danger ? ' danger' : ''}`}
                  role="menuitem"
                  disabled={it.disabled}
                  title={it.disabled ? 'Not built yet' : undefined}
                  onClick={() => {
                    it.onSelect?.();
                    setOpen(false);
                  }}
                >
                  {it.label}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Whova's per-row `⋮`. Same menu, a different trigger. */
export function RowActions({ items }: { items: MenuItem[] }) {
  return (
    <Dropdown
      label={<span aria-hidden="true">⋮</span>}
      items={items}
      className="row-actions-btn"
      align="end"
    />
  );
}

/**
 * The `?` next to a label.
 *
 * A `<details>` so it works with JavaScript still loading and needs no state.
 * Whova's is a popper-positioned popover; the trade is noted at the top of this
 * file.
 */
export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <details className="help-tip">
      <summary aria-label="What is this?">?</summary>
      <div className="help-tip-body">{children}</div>
    </details>
  );
}

/** A character counter, which Whova prints under every length-capped field. */
export function CharCount({ id, max, initial = 0 }: { id: string; max: number; initial?: number }) {
  const [n, setN] = useState(initial);

  useEffect(() => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return;
    const on = () => setN(el.value.length);
    on();
    el.addEventListener('input', on);
    return () => el.removeEventListener('input', on);
  }, [id]);

  return (
    <div className="whova-char-limit">
      {n}/{max}
    </div>
  );
}
