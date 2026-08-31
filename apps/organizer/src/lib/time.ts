import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';
import { TIME_ZONE } from '@kgc/shared';
import {
  deriveTimes as deriveTimesInScripts,
  fromWallClock as fromWallClockInScripts,
  isWallClock,
  toWallClockInZone,
} from '@kgc/scripts/src/lib/time';

/**
 * Time derivation for the console.
 *
 * The rule (DECISIONS.md, "Cross-cutting rules"): local wall clock is the
 * authoring truth, and `startsAt` / `endsAt` / `day` are **derived from it
 * server-side**, in `America/New_York`. An organizer edits "Tuesday 09:00"; the
 * three derived fields are recomputed here and never accepted from a form.
 *
 * The derivation itself is `scripts/src/lib/time.ts` — the same function the
 * seed and the Whova importer use, pinned by `scripts/src/lib/time.test.ts`.
 * There must be exactly one implementation: a console that derived `day`
 * slightly differently from the importer would put a 21:00 reception on
 * Tuesday's tab in one code path and Monday's in the other, and that is
 * invisible until someone walks to an empty room.
 *
 * The one thing this wrapper does add is re-wrapping the `Timestamp`. The
 * scripts workspace resolves `firebase-admin` from the repo root while the
 * console resolves its own copy, so the class identities differ; going through
 * `toDate()` and `Timestamp.fromDate()` means the console always writes a
 * `Timestamp` from the same module instance as the client that commits it.
 */
export interface DerivedTimes {
  startsAt: Timestamp;
  endsAt: Timestamp;
  startsAtLocal: string;
  endsAtLocal: string;
  timeZone: string;
  day: string;
}

export function deriveTimes(
  startsAtLocal: string,
  endsAtLocal: string,
  timeZone: string = TIME_ZONE,
): DerivedTimes {
  const derived = deriveTimesInScripts(startsAtLocal, endsAtLocal, timeZone);
  return {
    startsAt: Timestamp.fromDate(derived.startsAt.toDate()),
    endsAt: Timestamp.fromDate(derived.endsAt.toDate()),
    startsAtLocal: derived.startsAtLocal,
    endsAtLocal: derived.endsAtLocal,
    timeZone: derived.timeZone,
    day: derived.day,
  };
}

export { isWallClock, toWallClockInZone };

/**
 * One wall clock → the instant it names, for the single-ended cases.
 *
 * A ticket's sales window is two independent moments, either of which may be
 * absent, so `deriveTimes` — which insists on a start *and* an end and refuses
 * the second if it is not after the first — is the wrong tool. The
 * `Timestamp` is re-wrapped for the same reason as above: the scripts workspace
 * and this app resolve different copies of `firebase-admin`.
 */
export function fromWallClock(local: string, timeZone: string = TIME_ZONE): Timestamp {
  return Timestamp.fromDate(fromWallClockInScripts(local, timeZone).toDate());
}

/** `YYYY-MM-DD` for "today" in the event's zone — not the server's. */
export function todayInEventZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `HH:mm` off the stored wall clock. Display only; never parsed back. */
export function clockOf(wall: string): string {
  return wall.slice(11, 16);
}
