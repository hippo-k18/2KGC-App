import type { ReactNode } from 'react';
import { listSessions } from '@/lib/data';
import { QR_QUIET_ZONE, linkQr } from '@/lib/qr';

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

/**
 * A link QR, drawn inline.
 *
 * ── This is not the badge symbol, and the difference is the whole point ─────
 *
 * `linkQr` encodes a public URL. The badge QR encodes `qrSecret`, which is a
 * bearer credential for attendance, and nothing on an App Adoption screen may
 * ever carry one: these screens exist to hand an organizer something they will
 * print on a table sign and paste in front of a thousand people. `@/lib/qr`
 * keeps the two builders apart so that the mistake has to be made deliberately.
 *
 * Level Q (chosen inside `linkQr`) rather than the encoder's default, because
 * this symbol gets read off a printed card under conference lighting by a phone
 * at arm's length — 25% recovery buys back the glare spot and the coffee ring.
 *
 * `shapeRendering="crispEdges"` matters more than it looks: the default
 * antialiasing softens a module edge, and a soft edge at small print sizes is
 * the difference between a symbol that reads first time and one somebody has to
 * hold still for.
 */
export function QrSymbol({
  text,
  px = 180,
  label,
}: {
  text: string;
  px?: number;
  /** Accessible name. The URL itself, usually — it is what the symbol says. */
  label: string;
}) {
  const { d, size } = linkQr(text);
  const box = size + QR_QUIET_ZONE * 2;

  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{ background: '#fff', display: 'block' }}
    >
      <path d={d} fill="#000" transform={`translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})`} />
    </svg>
  );
}

/**
 * The same symbol as standalone SVG markup, for pasting into a slide, an email
 * or a page.
 *
 * SVG rather than a PNG data URI because there is no rasteriser in this
 * project and a vector symbol prints at whatever resolution the printer has —
 * which is exactly what a table sign needs. It is also small enough to paste:
 * a version-4 symbol is a few kilobytes of path, against a hundred for an
 * image big enough to print.
 */
export function qrSvgMarkup(text: string, px = 240): string {
  const { d, size } = linkQr(text);
  const box = size + QR_QUIET_ZONE * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges" role="img">` +
    `<rect width="${box}" height="${box}" fill="#fff"/>` +
    `<path transform="translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})" fill="#000" d="${d}"/>` +
    `</svg>`
  );
}
