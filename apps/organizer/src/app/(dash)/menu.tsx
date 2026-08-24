'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
 */

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
        <div className={`whova-menu${align === 'end' ? ' align-end' : ''}`} role="menu">
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
