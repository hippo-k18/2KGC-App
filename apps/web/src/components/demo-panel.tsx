'use client';

import { useState } from 'react';

export interface DemoRow {
  label: string;
  value: string;
  /** Rendered in a monospace face. Card numbers and codes; not names. */
  mono?: boolean;
}

/**
 * The credentials panel that sits at the bottom of the viewport during a demo.
 *
 * It exists because of what goes wrong on a stage: the presenter is talking,
 * the room is watching a projector, and the one thing that reliably breaks the
 * flow is having to remember an email address or a card number. Everything
 * needed to drive the screen is printed, one tap fills it, and a click on any
 * value copies it.
 *
 * Fixed rather than inline so it survives scrolling — the checkout form is
 * longer than a laptop screen with the registration questions expanded, and a
 * hint that has scrolled off is a hint that is not there.
 *
 * Collapsible because it covers the bottom of the page, and the confirmation
 * screen's claim code is the thing the audience is meant to be looking at.
 */
export function DemoPanel({
  title = 'Demo credentials',
  note,
  rows,
  onFill,
  fillLabel = 'Fill the form',
}: {
  title?: string;
  note?: string;
  rows: DemoRow[];
  onFill?: () => void;
  fillLabel?: string;
}) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1200);
    } catch {
      // Clipboard access is denied in some embedded browsers. The value is
      // printed regardless, which is the part that matters.
    }
  };

  return (
    <aside className={`demo-panel${open ? '' : ' collapsed'}`} aria-label={title}>
      <div className="demo-panel-head">
        <span className="demo-panel-tag">Demo</span>
        <strong>{title}</strong>
        <button
          type="button"
          className="demo-panel-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open ? (
        <div className="demo-panel-body">
          {note ? <p className="demo-panel-note">{note}</p> : null}
          <div className="demo-panel-rows">
            {rows.map((r) => (
              <button
                key={r.label}
                type="button"
                className="demo-panel-row"
                onClick={() => copy(r.value)}
                title="Click to copy"
              >
                <span className="demo-panel-label">{r.label}</span>
                <span className={`demo-panel-value${r.mono ? ' mono' : ''}`}>{r.value}</span>
                <span className="demo-panel-copy">{copied === r.value ? 'copied' : 'copy'}</span>
              </button>
            ))}
          </div>
          {onFill ? (
            <button type="button" className="demo-panel-fill" onClick={onFill}>
              {fillLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
