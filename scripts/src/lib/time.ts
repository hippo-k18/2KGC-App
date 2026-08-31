import { TIME_ZONE } from '@kgc/shared';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Local wall time is the authoring truth. The UTC instant and the `day` tab key
 * are *derived here*, server-side, and never on a device.
 *
 * The failure this prevents is quiet and specific: KGC's Monday reception starts
 * at 21:00 in New York, which is 01:00 UTC on Tuesday. A client that derives the
 * day key from the UTC instant, or in the device's own zone, files that session
 * under the wrong tab — and the bug is invisible to anyone testing in Eastern
 * time during business hours.
 */
export interface DerivedTimes {
  startsAt: Timestamp;
  endsAt: Timestamp;
  startsAtLocal: string;
  endsAtLocal: string;
  timeZone: string;
  day: string;
}

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Is this `YYYY-MM-DDTHH:mm`, and nothing else? */
export function isWallClock(value: string): boolean {
  return WALL_CLOCK.test(value);
}

/**
 * One wall clock → the instant it names in `timeZone`.
 *
 * `deriveTimes` is the two-ended version, and it is the right one for anything
 * with a start and an end. This is for the single-ended cases — a sales window
 * opens at one moment and closes at another, and neither is required to exist —
 * where insisting on a pair would force a caller to invent the other half.
 *
 * The reason it is here rather than at the call site is the same reason
 * `deriveTimes` is: `new Date('2027-04-01T09:00')` resolves in whatever zone the
 * process happens to run in. On a laptop in New York that is right by accident;
 * on Netlify's UTC build servers an early-bird deadline typed as 23:59 closes at
 * 19:59 Eastern, four hours of sales earlier than the organizer meant, and
 * nothing on any screen says so.
 */
export function fromWallClock(local: string, timeZone: string = TIME_ZONE): Timestamp {
  if (!WALL_CLOCK.test(local)) {
    throw new Error(
      `"${local}" is not YYYY-MM-DDTHH:mm wall clock. ` +
        'Do not pass an ISO instant with a Z or an offset — the zone is supplied separately.',
    );
  }
  return Timestamp.fromDate(fromZonedTime(local, timeZone));
}

/**
 * The inverse: an instant → the wall clock a person in `timeZone` reads off it.
 *
 * Needed wherever a stored `Timestamp` has to be put back into a
 * `datetime-local` box. Round-tripping through `toISOString().slice(0, 16)`
 * instead shows the organizer UTC, and saving that back shifts the value by the
 * offset every single time the form is opened and saved.
 */
export function toWallClockInZone(instant: Date, timeZone: string = TIME_ZONE): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm");
}

export function deriveTimes(
  startsAtLocal: string,
  endsAtLocal: string,
  timeZone: string = TIME_ZONE,
): DerivedTimes {
  for (const [label, value] of [['start', startsAtLocal], ['end', endsAtLocal]] as const) {
    if (!WALL_CLOCK.test(value)) {
      throw new Error(
        `${label} time "${value}" is not YYYY-MM-DDTHH:mm wall clock. ` +
          'Do not pass an ISO instant with a Z or an offset — the zone is supplied separately, ' +
          'and accepting both here is how a schedule silently shifts by four hours.',
      );
    }
  }

  const start = fromZonedTime(startsAtLocal, timeZone);
  const end = fromZonedTime(endsAtLocal, timeZone);

  if (end <= start) {
    throw new Error(`session ends at or before it starts: ${startsAtLocal} → ${endsAtLocal}`);
  }

  return {
    startsAt: Timestamp.fromDate(start),
    endsAt: Timestamp.fromDate(end),
    startsAtLocal,
    endsAtLocal,
    timeZone,
    // The day key is the local calendar date, straight off the wall clock —
    // deliberately not computed from the instant.
    day: startsAtLocal.slice(0, 10),
  };
}

/** Normalises the shapes Whova and spreadsheets actually emit into wall clock. */
export function toWallClock(date: string, time: string): string {
  const d = date.trim();
  const t = time.trim();

  // 2027-05-04 | 05/04/2027 | 5/4/2027
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    iso = d;
  } else {
    const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) throw new Error(`unrecognised date "${date}"`);
    iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // 09:00 | 9:00 AM | 09:00:00
  const tm = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!tm) throw new Error(`unrecognised time "${time}"`);
  let hour = Number(tm[1]);
  const meridiem = tm[3]?.toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return `${iso}T${String(hour).padStart(2, '0')}:${tm[2]}`;
}
