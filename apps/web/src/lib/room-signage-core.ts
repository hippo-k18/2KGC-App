/**
 * What a screen outside one room should say, given the programme for that room.
 *
 * Pure, and separate from the Firestore read beside it in `room-signage.ts`,
 * for the reason AGENTS.md gives for every other `*-core` file here: a module
 * that imports `server-only` cannot be loaded by Vitest, and the arithmetic
 * that decides which talk is "now" is the part worth pinning down.
 *
 * ── Wall clock, compared as text ───────────────────────────────────────────
 *
 * `startsAtLocal` and `endsAtLocal` are `YYYY-MM-DDTHH:mm` in the venue's own
 * zone, fixed width, so a lexicographic compare is a chronological one. The
 * caller passes `now` in the same shape, derived from the event's timezone and
 * not from whatever clock the server happens to keep. That matters more here
 * than anywhere else in this app: the one reader of this page is standing in
 * the corridor outside the room, and a panel that is an hour out is worse than
 * a blank one, because it is believed.
 */

export interface SignageSession {
  id: string;
  title: string;
  /** `YYYY-MM-DDTHH:mm`, venue time. */
  startsAtLocal: string;
  /** `YYYY-MM-DDTHH:mm`, venue time. Empty when the programme never set one. */
  endsAtLocal: string;
  day: string;
  speakerNames: string[];
  trackName?: string;
}

export interface SignageView {
  /** Running right now, or null between talks. */
  current: SignageSession | null;
  /** The next one to start in this room, on any day. */
  next: SignageSession | null;
  /** What follows `next` on the same day, for the strip along the bottom. */
  later: SignageSession[];
  /**
   * True when the room's programme is over.
   *
   * Distinct from "nothing on now": an empty gap between two talks and a room
   * that is finished for the conference are the same blank space on a screen
   * and opposite facts to somebody deciding whether to wait in the corridor.
   */
  finished: boolean;
}

/** How many of the following sessions the strip along the bottom names. */
const LATER_LIMIT = 4;

/**
 * A session with no end time never becomes the current one.
 *
 * The alternative — treating a missing end as "still running" — puts a talk on
 * the screen that may have finished two hours ago and leaves it there until the
 * next one starts. `endsAtLocal` is written by the importer from the same
 * authoring fields as `startsAtLocal`, so a missing one is a data fault, and
 * the safe reading of a data fault on a sign is to say less rather than more.
 */
function endOf(s: SignageSession): string {
  return s.endsAtLocal || s.startsAtLocal;
}

export function signageView(sessions: SignageSession[], now: string): SignageView {
  const ordered = [...sessions].sort(
    (a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal) || a.title.localeCompare(b.title),
  );

  /*
   * Where two sessions in one room overlap — which is a scheduling mistake
   * rather than a plan, and Conflict Check reports it — the earlier start wins.
   * A plenary that has run over is still the thing happening in the room; the
   * talk that was double-booked on top of it is not in there yet.
   */
  const current = ordered.find((s) => s.startsAtLocal <= now && now < endOf(s)) ?? null;

  const upcoming = ordered.filter((s) => s.startsAtLocal > now);
  const next = upcoming[0] ?? null;
  const later = next ? upcoming.filter((s) => s.day === next.day).slice(1, 1 + LATER_LIMIT) : [];

  return { current, next, later, finished: current === null && next === null };
}

/** `2027-05-05T14:00` → `14:00`. Empty in, empty out. */
export function clockOf(local: string): string {
  return local.slice(11, 16);
}

/**
 * How long until a session starts, in whole minutes, or null when it has.
 *
 * Minutes rather than a clock time because the question in the corridor is
 * "have I got time for a coffee", and because a countdown is the one thing on
 * the screen that proves it is still being updated.
 */
export function minutesUntil(startsAtLocal: string, now: string): number | null {
  if (startsAtLocal <= now) return null;
  const a = Date.parse(`${now}:00Z`);
  const b = Date.parse(`${startsAtLocal}:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60_000);
}

/**
 * "in 25 minutes", "in 3 hours", "on Wed 5 May".
 *
 * Anything past the end of the day the sign is standing in becomes a date: "in
 * 4,320 minutes" is arithmetic nobody reads, and the case is real, because this
 * page is up months before the conference as well as during it.
 */
export function untilLabel(startsAtLocal: string, now: string, dayName: string): string {
  const mins = minutesUntil(startsAtLocal, now);
  if (mins === null) return 'now';
  if (startsAtLocal.slice(0, 10) !== now.slice(0, 10)) return dayName;
  if (mins < 1) return 'about to start';
  if (mins < 60) return `in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(mins / 60);
  return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
