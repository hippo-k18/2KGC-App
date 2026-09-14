import { EVENT, EVENT_ID } from "./event.js";
import { publicSiteOrigin } from "./public-site.js";

/**
 * "Add to my calendar", for one published session: an `.ics` file and the two
 * hosted add-event links that cover everybody who does not download files.
 *
 * ── Why this is in `@kgc/shared` and not in the website ─────────────────────
 *
 * It was written in `apps/web/src/lib/calendar.ts` and moved here the day the
 * attendee app needed the same three destinations. The app is a workspace
 * member and `apps/web` depends on this package by a `file:` path, so this is
 * the only place both can reach — the same argument `AGENTS.md` makes for
 * `ensureRegistration` living in `@kgc/scripts`. Two copies of a wall clock to
 * UTC conversion are two chances to put a talk in an attendee's calendar an
 * hour out, and the divergence is silent: nothing renders wrong, nothing
 * throws, and the person finds out by arriving late.
 *
 * ── Deliberately pure ───────────────────────────────────────────────────────
 *
 * No React, no Firebase SDK, no `server-only`, no Node globals — the rule this
 * whole package follows, and the same split `AGENTS.md` names between
 * `conflicts-core.ts` and `conflicts.ts`. Everything below is arithmetic and
 * string escaping, and the impure half that reads Firestore stays where it was:
 * `apps/web/src/app/agenda/[id]/calendar.ics/route.ts`.
 *
 * ⚠️ It also uses no Web API that one of the three runtimes might not have.
 * React Native installs `URL` and `URLSearchParams` from `expo`'s WinterCG
 * runtime at app start, which is *after* a module like this one is evaluated —
 * so nothing here may touch them at module scope, and the UID host below is
 * therefore picked apart with a regex rather than with `new URL()`. The same
 * reasoning rules out `TextEncoder` for the line folding: it is measuring UTF-8
 * lengths, which a code point can answer by itself.
 *
 * ── The time question, which is the whole job ───────────────────────────────
 *
 * `startsAtLocal` / `endsAtLocal` are `YYYY-MM-DDTHH:mm` in the *venue's* wall
 * clock (`EVENT.timeZone`), with no offset on them. There are two honest ways to
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
 * `@kgc/scripts`'s `lib/time.ts` is the third candidate for the conversion and
 * is the wrong one to reach for here: it returns a `firebase-admin` `Timestamp`,
 * and gotcha 8 is that class instances built in `@kgc/scripts` do not cross into
 * another install's copy of the SDK. A package the app bundles has no business
 * pulling the Admin SDK in at all.
 */

/**
 * The offset, in minutes east of UTC, that `timeZone` was at `instant`.
 *
 * ⚠️ Read off the *formatted date* rather than from `timeZoneName: 'longOffset'`.
 * That option is the shorter spelling and it is what this function used while it
 * lived in the website, where the only runtime was Node with full ICU. Hermes
 * implements a subset of ECMA-402, `longOffset` is a 2021 addition to it, and
 * the failure mode of an unrecognised option is not an exception — the name
 * comes back in some other format, the regex misses, and the old code returned
 * **zero**, which silently files every session at its New York wall clock in
 * UTC: four hours out, on every phone, with nothing anywhere reporting a fault.
 *
 * Formatting the instant in the zone and subtracting uses only the fields the
 * app already proves Hermes handles (`useNowNext` does exactly this to decide
 * what is on now), it has no unparseable branch to guess past, and it was
 * checked against the `longOffset` version over 385,440 wall clocks across
 * eleven zones — including the half-hour and 45-minute offsets and both
 * hemispheres' transitions — with no disagreement.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Some ICU builds render midnight under `hour12: false` as hour 24 on the
  // same date. Left alone, `Date.UTC` would roll that to the following day and
  // report the offset a full day out.
  const hour = field("hour");
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour === 24 ? 0 : hour,
    field("minute"),
    field("second"),
  );

  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * `2027-05-05T09:00` in `America/New_York` → `2027-05-05T09:00:00-04:00`.
 *
 * ── Why the offset has to be resolved at all ────────────────────────────────
 *
 * `SessionDoc.startsAtLocal` is a wall clock with no offset on it, which is the
 * right way round for authoring (`AGENTS.md`: an organizer says "Tuesday at
 * 09:00 in New York") and useless to a consumer. Both consumers take ISO 8601,
 * and a bare `2027-05-05T09:00` is read as the *reader's* local time — so a
 * crawler in Dublin records a 09:00 keynote as happening at 04:00 New York time,
 * and an attendee in Dublin gets the same entry in their phone.
 *
 * ── Two passes, and the hour they are for ───────────────────────────────────
 *
 * Finding the offset needs an instant, and the instant is what the offset is
 * needed to compute. The first pass reads the wall clock as if it were UTC,
 * which lands within a day of the truth — close enough to pick the right side
 * of a DST transition for every hour except the ones adjacent to it. The second
 * pass re-reads the offset at the corrected instant, which fixes those. On the
 * one nonexistent hour each spring the answer is the offset on the far side of
 * the gap, which is what every other implementation does with a wall clock that
 * never happened.
 *
 * Returns `''` for anything that is not a bare wall clock, and both callers
 * treat that as "this session has no usable time" rather than guessing one.
 */
export function localWallClockToIso(wallClock: string, timeZone: string): string {
  /*
   * ⚠️ The shape is checked before `Date.parse` sees it, and a `Number.isNaN`
   * guard is not a substitute. `Date.parse` is specified to accept
   * implementation-defined formats and V8 takes that seriously: measured,
   * `Date.parse('not-a-date:00Z')` returns **946684800000** — midnight on
   * 1 January 2000 — rather than `NaN`. Trusting it would emit a startDate for
   * a session whose wall clock is malformed, and structured data is exactly the
   * place a wrong date is never noticed, because no human reads it.
   */
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallClock)) return "";

  const asIfUtc = Date.parse(`${wallClock}:00Z`);
  if (Number.isNaN(asIfUtc)) return "";

  const first = zoneOffsetMinutes(new Date(asIfUtc), timeZone);
  const offset = zoneOffsetMinutes(new Date(asIfUtc - first * 60_000), timeZone);

  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const abs = Math.abs(offset);
  return `${wallClock}:00${offset < 0 ? "-" : "+"}${pad(abs / 60)}:${pad(abs % 60)}`;
}

/**
 * What a calendar entry needs to know about a session.
 *
 * Structurally a subset of the website's `AgendaSession`, so `listAgenda()`'s
 * records pass straight in, and a subset of `SessionDoc` once the app maps
 * `primaryTrackName` onto `trackName`. Declared rather than derived from either,
 * because `AgendaSession` lives behind `server-only` and `SessionDoc` carries a
 * Firestore `Timestamp` this module must never touch.
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
 * the same session is offered — the website and the app both. `publicSiteOrigin()`
 * is per-deployment — a Netlify preview is a different host — and minting the id
 * from it would hand the same talk two identities and put it in the attendee's
 * calendar twice.
 */
const UID_HOST = EVENT.website.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "");

const PRODID = `-//Knowledge Graph Conference//${EVENT.name}//EN`;

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
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** How many bytes one code point occupies in UTF-8. */
function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
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
  let current = "";
  let bytes = 0;

  for (const ch of line) {
    const size = utf8Size(ch.codePointAt(0) ?? 0);
    if (bytes + size > 75) {
      pieces.push(current);
      current = "";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  pieces.push(current);

  return pieces.join("\r\n ");
}

/** `2027-05-05T13:00:00.000Z` → `20270505T130000Z`. */
function icsStamp(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
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
        "the zone is supplied separately and must not be baked into the string",
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
  const timeZone = opts.timeZone ?? EVENT.timeZone;
  const origin = (opts.origin ?? publicSiteOrigin()).replace(/\/$/, "");

  const start = instantOf(session.startsAtLocal, timeZone, "start");
  const end = instantOf(session.endsAtLocal, timeZone, "end");
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
  if (session.description?.trim()) lines.push(session.description.trim(), "");

  const speakers = (session.speakerNames ?? []).filter((n) => n.trim());
  if (speakers.length) {
    lines.push(`${speakers.length > 1 ? "Speakers" : "Speaker"}: ${speakers.join(", ")}`);
  }
  if (session.trackName) lines.push(`Track: ${session.trackName}`);
  if (session.roomName) lines.push(`Room: ${session.roomName}`);

  /*
   * The time is restated in the body as well as carried by DTSTART. A UTC
   * DTSTART renders in the reader's own zone, which is the correct behaviour
   * and also the moment somebody in London wonders whether the agenda page lied
   * to them. One line naming the venue's clock costs nothing and answers it.
   */
  lines.push(
    `${session.startsAtLocal.slice(11)}–${session.endsAtLocal.slice(11)} ${timeZone} (venue time)`,
  );

  const url = `${origin}/agenda?day=${day}#${day}`;
  lines.push("", `Full programme: ${url}`);

  return {
    start,
    end,
    origin,
    eventId: opts.eventId ?? EVENT_ID,
    location: session.roomName ? `${session.roomName}, ${EVENT.venue}` : EVENT.venue,
    url,
    description: lines.join("\n"),
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
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
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
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
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
    action: "TEMPLATE",
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
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: session.title,
    startdt: isoSeconds(r.start),
    enddt: isoSeconds(r.end),
    body: r.description,
    location: r.location,
    allday: "false",
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
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");

  return `${slug || "session"}.ics`;
}

/** Where the `.ics` for a session lives, so no caller has to spell the path. */
export function sessionCalendarPath(sessionId: string): string {
  return `/agenda/${encodeURIComponent(sessionId)}/calendar.ics`;
}
