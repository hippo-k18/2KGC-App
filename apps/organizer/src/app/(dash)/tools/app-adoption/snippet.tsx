import type { ReactNode } from 'react';
import { listSessions } from '@/lib/data';

/**
 * The one thing every App Adoption screen is actually made of: text an
 * organizer selects and pastes somewhere else.
 *
 * Five screens share it, so it is a component rather than five copies — the
 * same argument `ui.tsx` makes for `PageHeader`. It lives beside the screens
 * instead of in `ui.tsx` because nothing outside App Adoption has a use for a
 * paste block, and a component library grows unusable one single-caller export
 * at a time.
 *
 * ── There is deliberately no Copy button ────────────────────────────────────
 *
 * A copy button needs `navigator.clipboard`, which needs `'use client'` on all
 * five of these pages, which turns five static server-rendered screens into
 * five hydrated ones to save a keystroke the browser already has. So the block
 * is `user-select: all` instead: one click selects the whole snippet and ⌘C
 * copies it. That is the entire interaction, and it costs no JavaScript.
 *
 * `white-space: pre-wrap` rather than `pre`, because an email body wraps and a
 * line of HTML does not. A horizontal scrollbar on the thing you are about to
 * select is how half a line goes missing from a paste.
 */
export function Snippet({
  title,
  note,
  text,
}: {
  title: ReactNode;
  /** What to change before sending it. Rendered above the block, not inside. */
  note?: ReactNode;
  text: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="whova-form-label">{title}</div>
      {note ? (
        <p className="whova-form-description" style={{ marginBottom: 8, marginTop: 0, maxWidth: 680 }}>
          {note}
        </p>
      ) : null}
      <pre
        style={{
          background: 'var(--surface-alt)',
          border: '1px solid var(--hairline)',
          borderRadius: 4,
          color: 'var(--body)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          lineHeight: '20px',
          margin: 0,
          overflowX: 'auto',
          padding: 12,
          userSelect: 'all',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </pre>
    </div>
  );
}

/**
 * The event's dates, counted rather than typed.
 *
 * `apps/web/src/lib/site.ts` holds `datesLong: '3–7 May 2027'` as a
 * presentation string, and this app cannot import that file — the two websites
 * are separate installs, and only what lives in `@kgc/shared` crosses between
 * them, which a date typed for one page's headline should not. Copying it here
 * would put a hand-maintained date in an email template, which is the one place
 * a stale date does real damage. So it comes from the programme: the first and
 * last `day` on a published session are what the attendee is actually being
 * invited to.
 *
 * Returns null when there is no programme yet, so a caller can fall back to a
 * visible placeholder rather than print a confident wrong date.
 */
export async function eventWindow(): Promise<string | null> {
  const sessions = await listSessions();
  const days = [...new Set(sessions.map((s) => s.day))].filter(Boolean).sort();
  if (days.length === 0) return null;

  const first = days[0];
  const last = days[days.length - 1];

  // `Date.UTC` + a UTC formatter, for the reason `formatDayHeading` gives on the
  // website: these are plain dates, and formatting them locally reads a day
  // early west of Greenwich.
  const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  };

  if (first === last) return fmt(first, { day: 'numeric', month: 'long', year: 'numeric' });
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${fmt(first, { day: 'numeric' })}–${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  return `${fmt(first, { day: 'numeric', month: 'long' })} – ${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/*
 * `publicOrigin()` and `APP_DISTRIBUTION_SENTENCE` were declared here — a
 * fourth copy of the origin resolver and a third of the app-distribution
 * sentence, the latter under a comment explaining that the import boundary
 * between the two apps could not be crossed. It could: both apps depend on
 * `@kgc/shared`, where `publicSiteOrigin()` and `APP_DISTRIBUTION` now live,
 * and the sibling file that stated the same two things sat next to this one.
 * Import them from there.
 */

/** The placeholder every snippet uses for the link nobody can generate yet. */
export const INSTALL_LINK_PLACEHOLDER = '{{install link}}';
