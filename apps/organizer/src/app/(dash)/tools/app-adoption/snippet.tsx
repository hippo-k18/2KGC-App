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
 * Where a public link points.
 *
 * Read from the same env var `invoice-admin.ts` uses to mint `/order/{token}`
 * links, with the same production default, so a snippet copied off this screen
 * and a confirmation email sent by this dashboard cannot disagree about which
 * host the event lives on.
 */
export function publicOrigin(): string {
  return (process.env.WEB_PUBLIC_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(/\/$/, '');
}

/**
 * The event's dates, counted rather than typed.
 *
 * `apps/web/src/lib/site.ts` holds `datesLong: '3–7 May 2027'` as a
 * presentation string, and this app cannot import it — the two websites are not
 * workspace members and neither may import the other. Copying the string here
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

/**
 * How an attendee actually gets the app, in one sentence.
 *
 * This is a second copy of `APP_DISTRIBUTION` from `apps/web/src/lib/site.ts`,
 * and it is a copy on purpose: the confirmation page prints that constant on
 * the one page every buyer reads, this dashboard writes the emails that say the
 * same thing, and the import boundary between the two apps cannot be crossed.
 * Two copies of a sentence is the cheapest of the available wrongs.
 *
 * **The claim it makes is the load-bearing part.** The app runs in Expo Go and
 * TestFlight; it is on neither public store. Every snippet on these screens
 * therefore carries an install-link placeholder rather than a store badge —
 * sending a thousand ticket holders to search an app store for "KGC" is sending
 * them to an empty result on the one day they were willing to install anything.
 * Change both copies on the day the app is listed, and not before.
 */
export const APP_DISTRIBUTION_SENTENCE =
  'We will send you an install link before the conference. The app is not on the public app stores yet.';

/** The placeholder every snippet uses for the link nobody can generate yet. */
export const INSTALL_LINK_PLACEHOLDER = '{{install link}}';
