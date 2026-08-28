'use client';

import { useState } from 'react';

export interface DemoRow {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * The credentials block inside the sign-in card while `DEMO_MODE=1`, directly
 * under the fields it fills. It was pinned to the bottom of the viewport until
 * it became clear it could cover the sign-in button on a short window.
 *
 * A deliberate copy of the one in `apps/web` rather than a shared component:
 * the two apps have separate `package.json` files and separate design systems —
 * this one is styled with the Whova class vocabulary — and the shared package
 * they both depend on is `@kgc/shared`, which holds the data model and must not
 * grow a React dependency to hold a demo affordance.
 *
 * ⚠️ It prints the passphrase that is the only thing standing between the
 * public internet and an Admin SDK that bypasses every security rule. That is
 * acceptable for exactly as long as the data behind it is the synthetic seed.
 */
export function DemoPanel({ title, note, rows }: { title: string; note?: string; rows: DemoRow[] }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1200);
    } catch {
      // Denied in some embedded browsers. The value is printed regardless.
    }
  };

  return (
    <aside className="demo-panel" aria-label={title}>
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
        </div>
      ) : null}
    </aside>
  );
}
