import { EVENT, EVENT_ID, publicSiteOrigin } from '@kgc/shared';
import { localWallClockToIso } from './event-jsonld';
import { SITE } from './site';

/**
 * "Add to my calendar", for one published session: an `.ics` file and the two
 * hosted add-event links that cover everybody who does not download files.
 *
 * ── Deliberately pure ───────────────────────────────────────────────────────
 *
 * No `server-only`, no `db()`, no environment read beyond `publicSiteOrigin()`
 * — the same split `AGENTS.md` names between `conflicts-core.ts` and
 * `conflicts.ts`, and for the same reason: everything below is arithmetic and
 * string escaping, which is exactly the kind of code that has to be runnable
 * outside a Server Component to be checked at all. The route that reads
 * Firestore is the impure half and lives at `app/agenda/[id]/calendar.ics/`.
 *
 * ── The time question, which is the whole job ───────────────────────────────
 *
 * `startsAtLocal` / `endsAtLocal` are `YYYY-MM-DDTHH:mm` in the *venue's* wall
 * clock (`SITE.timeZone`), with no offset on them. There are two honest ways to
 * put that into a calendar, and this file takes the second:
 *
 *   (a) emit the wall clock with a `TZID` and ship a `VTIMEZONE` block, or
 *   (b) resolve the instant and emit `DTSTART:…Z`.
 *
 * (b), for two reasons. The first is agreement: Google's `dates=` and Outlook's
 * `startdt=` have no `VTIMEZONE` to carry, so a `TZID` `.ics` would still need
 * the UTC resolution for the other two links — and then the three surfaces
 * would agree only as long as two separate code paths stayed in step. Resolving
 * once and formatting three ways means they cannot disagree. The second is that
 * a hand-written `VTIMEZONE` is a copy of the tzdata rules for
 * `America/New_York` frozen at the moment somebody typed it, which is a worse
 * bet than `Intl`, whose rules the platform keeps current.
 *
 * What (b) gives up is honest: if the US ever abolishes DST *and* the sessions
 * are not re-derived, an already-downloaded event keeps the instant it was
 * given rather than following the venue's clock. That is the same exposure the
 * `startsAt` Timestamp on every `SessionDoc` already has, so it introduces no
 * new class of error.
 *
 * ⚠️ The conversion itself is **not** written here. `localWallClockToIso()` in
 * `event-jsonld.ts` already does it — two `Intl` passes so an hour adjacent to
 * a DST transition lands on the right side of it — and it is what the page's
 * own `schema.org` markup is built from. A second implementation would be a
 * second answer to "when is the keynote", on the same page, and `AGENTS.md`
 * calls this repo's wall-clock code the riskiest it has. One copy.
 *
 * `@kgc/scripts`'s `lib/time.ts` is the third-party candidate and is the wrong
 * import here: it returns a `firebase-admin` `Timestamp`, and gotcha 8 is that
 * class instances built in `@kgc/scripts` do not cross into this install's copy
 * of the SDK. A module this one is meant to be testable without a server has no
 * business pulling the Admin SDK in.
 */

/**
 * What a calendar entry needs to know about a session.
 *
 * Structurally a subset of `AgendaSession`, so `listAgenda()`'s records pass
 * straight in — but declared here rather than imported, because `data.ts` is
 * `server-only` and this module's whole point is that it is not.
 */
export interface CalendarSession {
  id: string;
  title: string;
  description?: string;
  /** `YYYY-MM-DDTHH:mm` in the venue's zone. Never an instant, never a `Z`. */
  startsAtLocal: string;
  endsAtLocal: string;
  roomName?: string;
  trackName?: string;
  speakerNames?: string[];
}

export interface CalendarOptions {
  /** The site's own origin, no trailing slash. Defaults to `publicSiteOrigin()`. */
  origin?: string;
  /** The zone the wall clocks are written in. Defaults to the venue's. */
  timeZone?: string;
  /** The edition, for the `UID`. Defaults to `EVENT_ID`. */
  eventId?: string;
  /**
   * What to stamp as `DTSTAMP`. Injectable so a generated file is reproducible
   * in a test; in production nobody passes it.
   */
  now?: Date;
}

/**
 * The `UID` domain is the conference's own host and not the deployment's.
 *
 * A `UID` is what makes re-adding a session *update* the entry an attendee
 * already has rather than duplicate it, so it has to be identical everywhere
 * the same session is offered. `publicSiteOrigin()` is per-deployment — a
 * Netlify preview is a different host — and minting the id from it would hand
 * the same talk two identities and put it in the attendee's calendar twice.
 */
const UID_HOST = new URL(EVENT.website).host;

const PRODID = `-//Knowledge Graph Conference//${EVENT.name}//EN`;

const encoder = new TextEncoder();

/**
 * Escape a value for an RFC 5545 TEXT property.
 *
 * The backslash goes first or it doubles the ones the later rules insert. `:`
 * is deliberately absent: it needs escaping in a *parameter* value, not in
 * TEXT, and escaping it there produces `\:` in the middle of every URL an
 * organizer pastes into a session description.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Fold to 75 **octets**, not characters.
 *
 * The limit is measured in bytes, so a description of accented names or an
 * emoji in a session title folds earlier than its `.length` suggests — and
 * splitting mid-sequence produces a file that some clients reject outright and
 * others render as replacement characters. Iterating code points rather than
 * UTF-16 units keeps an astral character whole; the leading space on a
 * continuation counts towards its own 75, which is why the running total
 * restarts at 1 rather than 0.
 */
function foldLine(line: string): string {
  const pieces: string[] = [];
  let current = '';
  let bytes = 0;

  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      pieces.push(current);
      current = '';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  pieces.push(current);

  return pieces.join('\r\n ');
}

/** `2027-05-05T13:00:00.000Z` → `20270505T130000Z`. */
function icsStamp(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** The same instant as Outlook wants it: seconds, no milliseconds, still UTC. */
function isoSeconds(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

/**
 * One wall clock → the instant it names at the venue.
 *
 * Throws rather than returning a fallback. A calendar entry is written down
 * once and then trusted for months; an entry at a guessed hour is worse than a
 * download that failed, because the attendee finds out about the second one.
 */
function instantOf(wallClock: string, timeZone: string, label: string): Date {
  const iso = localWallClockToIso(wallClock, timeZone);
  if (!iso) {
    throw new Error(
      `session ${label} time "${wallClock}" is not YYYY-MM-DDTHH:mm wall clock; ` +
        'the zone is supplied separately and must not be baked into the string',
    );
  }
  return new Date(iso);
}

interface Resolved {
  start: Date;
  end: Date;
  origin: string;
  eventId: string;
  /** The venue plus the room, when the session has one. */
  location: string;
  /** Where the entry points back to: the agenda, scrolled to the right day. */
  url: string;
  description: string;
}

function resolve(session: CalendarSession, opts: CalendarOptions): Resolved {
  const timeZone = opts.timeZone ?? SITE.timeZone;
  const origin = (opts.origin ?? publicSiteOrigin()).replace(/\/$/, '');

  const start = instantOf(session.startsAtLocal, timeZone, 'start');
  const end = instantOf(session.endsAtLocal, timeZone, 'end');
  if (end <= start) {
    throw new Error(
      `session "${session.id}" ends at or before it starts: ` +
        `${session.startsAtLocal} → ${session.endsAtLocal}`,
    );
  }

  /*
   * The day key, taken off the wall clock rather than computed from the
   * instant — the rule `deriveTimes()` states and the reason a 21:00 reception
   * does not file itself under the next morning.
   */
  const day = session.startsAtLocal.slice(0, 10);

  const lines: string[] = [];
  if (session.description?.trim()) lines.push(session.description.trim(), '');

  const speakers = (session.speakerNames ?? []).filter((n) => n.trim());
  if (speakers.length) lines.push(`${speakers.length > 1 ? 'Speakers' : 'Speaker'}: ${speakers.join(', ')}`);
  if (session.trackName) lines.push(`Track: ${session.trackName}`);
  if (session.roomName) lines.push(`Room: ${session.roomName}`);

  /*
   * The time is restated in the body as well as carried by DTSTART. A UTC
   * DTSTART renders in the reader's own zone, which is the correct behaviour
   * and also the moment somebody in London wonders whether the agenda page lied
   * to them. One line naming the venue's clock costs nothing and answers it.
   */
  lines.push(`${session.startsAtLocal.slice(11)}–${session.endsAtLocal.slice(11)} ${timeZone} (venue time)`);

  const url = `${origin}/agenda?day=${day}#${day}`;
  lines.push('', `Full programme: ${url}`);

  return {
    start,
    end,
    origin,
    eventId: opts.eventId ?? EVENT_ID,
    location: session.roomName ? `${session.roomName}, ${SITE.venue}` : SITE.venue,
    url,
    description: lines.join('\n'),
  };
}

/**
 * A complete `VCALENDAR` for one session, CRLF-terminated and folded.
 *
 * `METHOD:PUBLISH` rather than `REQUEST`: this is the organizer publishing an
 * entry, not inviting a named attendee, and a `REQUEST` with no `ATTENDEE`
 * makes some clients offer an RSVP that reaches nobody.
 */
export function sessionIcs(session: CalendarSession, opts: CalendarOptions = {}): string {
  const r = resolve(session, opts);
  const stamp = icsStamp(opts.now ?? new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${session.id}.${r.eventId}@${UID_HOST}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsStamp(r.start)}`,
    `DTEND:${icsStamp(r.end)}`,
    `SUMMARY:${escapeText(session.title)}`,
    `DESCRIPTION:${escapeText(r.description)}`,
    `LOCATION:${escapeText(r.location)}`,
    // URI values, not TEXT: escaping them would turn a comma in a query string
    // into `\,` and break the link.
    `URL:${r.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * The Google Calendar pre-filled event form.
 *
 * The instants are UTC and there is deliberately no `ctz=`: that parameter
 * tells Google which zone to *read* a naked wall clock in, and supplying both
 * is how one of the three surfaces ends up an offset away from the other two.
 */
export function googleCalendarUrl(session: CalendarSession, opts: CalendarOptions = {}): string {
  const r = resolve(session, opts);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: session.title,
    dates: `${icsStamp(r.start)}/${icsStamp(r.end)}`,
    details: r.description,
    location: r.location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * The Outlook.com pre-filled event form.
 *
 * `startdt` carries the `Z`, so the entry lands at the right moment whatever
 * zone the account is set to. Without it Outlook reads the value as the
 * *mailbox's* local time, which silently moves a 09:00 New York keynote to
 * 09:00 wherever the attendee happens to live — the one failure this whole
 * module exists to prevent.
 */
export function outlookCalendarUrl(session: CalendarSession, opts: CalendarOptions = {}): string {
  const r = resolve(session, opts);

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: session.title,
    startdt: isoSeconds(r.start),
    enddt: isoSeconds(r.end),
    body: r.description,
    location: r.location,
    allday: 'false',
  });

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * A session title as a download filename, `.ics` included.
 *
 * Folded to ASCII and capped, because `Content-Disposition`'s plain `filename=`
 * parameter is a quoted string with no encoding of its own — a non-ASCII byte
 * in it is interpreted differently by every browser that reads it.
 */
export function icsFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

  return `${slug || 'session'}.ics`;
}

/** Where the `.ics` for a session lives, so no caller has to spell the path. */
export function sessionCalendarPath(sessionId: string): string {
  return `/agenda/${encodeURIComponent(sessionId)}/calendar.ics`;
}
