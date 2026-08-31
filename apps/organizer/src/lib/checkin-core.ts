import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type CheckInListDoc } from '@kgc/shared';

/**
 * The scoping rules behind per-session attendance, with no Firestore handle of
 * its own.
 *
 * ── Deliberately NOT `server-only` ──────────────────────────────────────────
 *
 * `checkin.ts` and `attendance.ts` both carry it, and both are unreachable from
 * a test process because `server-only` throws outside a React Server Component.
 * What is in this file is the part most worth testing and the part least
 * dependent on Next: the derived ids, the idempotent create whose
 * `already-exists` is success, and the two joins that turn three collections
 * into the numbers four screens print. `tests/attendance` drives them against
 * the emulator with the root copy of `firebase-admin`.
 *
 * ⚠️ Which is why `ensureScopedList` takes its store **and its sentinels** as
 * arguments rather than reaching for them. `FieldValue.serverTimestamp()` is a
 * class instance validated with `instanceof`, and this repo resolves four
 * separate copies of `firebase-admin`; one built here and handed to a store
 * built elsewhere fails the whole write with "Couldn't serialize object of type
 * l". That is AGENTS.md gotcha 8, it took the purchase flow down in August
 * 2026, and `denormalise.ts` carries the same seam for the same reason.
 */

export interface WriteSentinels {
  serverTimestamp: () => unknown;
}

/**
 * A scoped list's id is derived from what it scopes, never generated.
 *
 * Two organizers pressing Start on the same session at the same moment must
 * produce one list. With a derived id the second `create()` fails with
 * `already-exists` and that failure *is* the deduplication — the same mechanism
 * `checkIns/{registrationId}` uses for a double scan, and the same one
 * `DOOR_CHECK_IN_LIST_ID` uses for the front door. A generated id would leave
 * the room with two half-populated attendance records and no way to tell which
 * one the scanner was writing into.
 */
export function sessionListId(sessionId: string): string {
  return `session-${sessionId}`;
}

export function dayListId(day: string): string {
  return `day-${day}`;
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * People arrive late, and a door that stops counting on the hour under-reports
 * the room. Advisory only — nothing refuses a scan outside the window, because
 * a scanner that rejects a badge in front of a queue because a session
 * over-ran is a worse failure than a slightly generous count.
 */
export const SCOPE_GRACE_MINUTES = 15;

/** Firestore's `ALREADY_EXISTS`, gRPC status 6. Success, in every use here. */
export function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: number | string; message?: string };
  return e?.code === 6 || String(e?.message ?? '').includes('ALREADY_EXISTS');
}

export interface ScopedListFields {
  name: string;
  kind: CheckInListDoc['kind'];
  sessionId?: string;
  opensAt?: unknown;
  closesAt?: unknown;
}

/**
 * Create a scoped check-in list at a derived id.
 *
 * Returns `true` when this call made it and `false` when it already existed.
 * The distinction is only used to word a confirmation — "started" reads
 * differently from "resumed" to somebody who is not sure whether a colleague
 * already opened the door — but it is also what the test asserts on, because it
 * is the observable difference between idempotent and not.
 */
export async function ensureScopedList(
  store: Firestore,
  id: string,
  fields: ScopedListFields,
  sentinels: WriteSentinels,
): Promise<boolean> {
  const now = sentinels.serverTimestamp();
  try {
    await store
      .collection(COLLECTIONS.checkInLists)
      .doc(id)
      .create({
        eventId: EVENT_ID,
        name: fields.name,
        kind: fields.kind,
        // Named key by key rather than spread from a partial: `create()` does
        // not merge, but the same object shape is reused on other paths that
        // do, and a half-specified map under `merge` keeps whatever was there.
        ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
        ...(fields.opensAt ? { opensAt: fields.opensAt } : {}),
        ...(fields.closesAt ? { closesAt: fields.closesAt } : {}),
        createdAt: now,
        updatedAt: now,
      });
    return true;
  } catch (err) {
    if (isAlreadyExists(err)) return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The joins
// ---------------------------------------------------------------------------

/**
 * Scheduled minutes from the two local wall clocks.
 *
 * Both ends are `YYYY-MM-DDTHH:mm` in the same `timeZone`, so subtracting them
 * as if they were UTC gives the right answer for every session that does not
 * straddle a clock change — and one that does is a two-hour talk starting at
 * 01:00, which no conference schedules. Doing it this way avoids pulling in a
 * timezone library for a subtraction.
 */
export function scheduledMinutes(s: { startsAtLocal: string; endsAtLocal: string }): number {
  // ⚠️ The shape is checked before parsing, because `Date.parse` is *not* a
  // validator. V8 falls back to a lenient parser for anything it does not
  // recognise as ISO-8601, and `Date.parse('not a time:00Z')` returns a finite
  // number rather than NaN — which turned a malformed `startsAtLocal` into a
  // 14,380,440-minute session and would have put 239,674 hours on somebody's
  // certificate. A `Number.isFinite` guard alone does not catch it.
  if (!LOCAL_CLOCK.test(s.startsAtLocal) || !LOCAL_CLOCK.test(s.endsAtLocal)) return 0;
  const start = Date.parse(`${s.startsAtLocal}:00Z`);
  const end = Date.parse(`${s.endsAtLocal}:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

/** `YYYY-MM-DDTHH:mm` — exactly what `SessionDoc` documents its wall clocks as. */
const LOCAL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export interface SessionLike {
  id: string;
  title: string;
  day: string;
  startsAtLocal: string;
  endsAtLocal: string;
}

export interface ListLike {
  id: string;
  kind: CheckInListDoc['kind'];
  sessionId?: string;
}

/** The session lists that exist, keyed by the session they belong to. */
export function sessionListsBySession<T extends ListLike>(lists: T[]): Map<string, T> {
  return new Map(
    lists.filter((l) => l.kind === 'session' && l.sessionId).map((l) => [l.sessionId!, l]),
  );
}

export interface SessionAttendanceJoin<S extends SessionLike> {
  session: S;
  listId: string;
  /** A door was opened for this session at some point. */
  tracked: boolean;
  countedIn: number;
  minutes: number;
}

/**
 * Sessions joined to their door lists.
 *
 * `tracked` exists so that "nobody came" and "nobody was counting" never render
 * as the same number. They are the same integer and opposite facts, and a
 * programme committee cutting a track on the strength of a zero it never
 * measured is the mistake this flag is here to prevent.
 */
export function joinSessionAttendance<S extends SessionLike, L extends ListLike>(
  sessions: S[],
  lists: L[],
  counts: Map<string, number>,
): SessionAttendanceJoin<S>[] {
  const bySession = sessionListsBySession(lists);
  return sessions.map((session) => {
    const list = bySession.get(session.id);
    return {
      session,
      listId: list?.id ?? sessionListId(session.id),
      tracked: Boolean(list),
      countedIn: list ? (counts.get(list.id) ?? 0) : 0,
      minutes: scheduledMinutes(session),
    };
  });
}

export interface AttendedSession {
  sessionId: string;
  title: string;
  day: string;
  startsAtLocal: string;
  minutes: number;
  checkedInAt: string | null;
}

export interface AttendeeHoursJoin {
  registrationId: string;
  sessions: AttendedSession[];
  minutes: number;
}

/**
 * Check-ins across every session door, folded into hours per registration.
 *
 * ⚠️ **Scheduled hours, not hours sat through.** A scan credits the full length
 * of the session whether the person stayed for all of it or left after ten
 * minutes: there are no exits in this system, because
 * `checkIns/{registrationId}` makes a second arrival an `already-exists` by
 * design and Checkout is unbuilt. Every screen presenting this number has to
 * say so — a CPE certificate naming hours somebody did not sit is the kind of
 * claim that gets an accreditation withdrawn, and the gap is in the model
 * rather than in this arithmetic.
 */
export function joinAttendeeHours<S extends SessionLike, L extends ListLike>(
  sessions: S[],
  lists: L[],
  checkInsByListId: Map<string, { registrationId: string; checkedInAt: string | null }[]>,
): AttendeeHoursJoin[] {
  const bySessionId = new Map(sessions.map((s) => [s.id, s]));
  const present = [...sessionListsBySession(lists).entries()].filter(([sessionId]) =>
    bySessionId.has(sessionId),
  );

  const acc = new Map<string, AttendedSession[]>();
  for (const [sessionId, list] of present) {
    const session = bySessionId.get(sessionId)!;
    const minutes = scheduledMinutes(session);
    for (const entry of checkInsByListId.get(list.id) ?? []) {
      const existing = acc.get(entry.registrationId) ?? [];
      existing.push({
        sessionId,
        title: session.title,
        day: session.day,
        startsAtLocal: session.startsAtLocal,
        minutes,
        checkedInAt: entry.checkedInAt,
      });
      acc.set(entry.registrationId, existing);
    }
  }

  return [...acc.entries()].map(([registrationId, attended]) => ({
    registrationId,
    sessions: attended.sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal)),
    minutes: attended.reduce((n, s) => n + s.minutes, 0),
  }));
}
