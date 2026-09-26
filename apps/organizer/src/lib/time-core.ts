import { TIME_ZONE } from '@kgc/shared';

/**
 * Reading a stored instant back as a date and a clock, in the event's own zone.
 *
 * ── The bug these exist to stop ─────────────────────────────────────────────
 *
 * `iso.slice(0, 10)` takes the **UTC** date off an ISO string. A badge scanned
 * at 21:20 in New York is stored as 01:20 the next day in UTC, so the slice
 * prints tomorrow's date — directly under a panel that formatted the same
 * instant properly and prints today's. Two panels on one screen disagreeing
 * about when something happened is worse than either being wrong alone, because
 * the organizer cannot tell which one to believe.
 *
 * It is the same failure `scripts/src/lib/time.ts` was written to prevent on the
 * authoring side, in the other direction: there a wall clock is turned into an
 * instant, here an instant is turned back into what a person in New York reads
 * off it. Both have to name the zone. Neither may use the machine's.
 *
 * ── Why this is a `-core` file ──────────────────────────────────────────────
 *
 * `lib/time.ts` is `server-only` and imports `firebase-admin`, and the check-in
 * desk table is a client component that has to print the same date as the
 * arrivals panel above it. So the arithmetic lives here, with no imports a
 * browser bundle cannot carry, and `lib/time.ts` re-exports it — one
 * implementation, and a server screen still writes one import.
 */

/** `YYYY-MM-DD` as a person in `timeZone` reads it off a stored instant. */
export function dayOfInstant(
  iso: string | null | undefined,
  timeZone: string = TIME_ZONE,
): string {
  const at = parse(iso);
  if (!at) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** `HH:mm` as a person in `timeZone` reads it off a stored instant. */
export function clockOfInstant(
  iso: string | null | undefined,
  timeZone: string = TIME_ZONE,
): string {
  const at = parse(iso);
  if (!at) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/**
 * `YYYY-MM-DD HH:mm`, both halves on the venue's clock.
 *
 * The two functions above existed and the screens that wanted a date *and* a
 * time still reached for `iso.slice(0, 16).replace('T', ' ')`, which is the
 * exact bug in the header: it prints the UTC instant in a shape that looks
 * local. Seven tables did it, and two of them sat beside a panel formatting the
 * same arrival properly, so one screen showed a 22:39 arrival and the next
 * showed 02:39 the following day. Having a correct helper is not enough if the
 * wrong thing is shorter to type, so this is the short thing.
 */
export function stampOfInstant(
  iso: string | null | undefined,
  timeZone: string = TIME_ZONE,
): string {
  const day = dayOfInstant(iso, timeZone);
  return day ? `${day} ${clockOfInstant(iso, timeZone)}` : '';
}

/**
 * The same stamp from epoch milliseconds.
 *
 * Several screens hold a time as a number rather than an ISO string, and each
 * of them reached for `new Date(ms).toLocaleDateString()` — which formats on
 * the *server's* zone, so a row read in New York and the same row read by a
 * machine in Frankfurt disagree about which day a link was sent. One character
 * shorter than the wrong thing, for the reason the docblock above gives.
 */
export function stampOfMillis(
  ms: number | null | undefined,
  timeZone: string = TIME_ZONE,
): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return stampOfInstant(new Date(ms).toISOString(), timeZone);
}

/**
 * An unreadable value comes back as an empty string rather than "Invalid Date".
 *
 * Every caller is a footnote under a panel — "Last changed by Ada on …" — and a
 * missing date there is a smaller lie than a date that is not one.
 */
function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}
