import 'server-only';

import {
  formatHours,
  joinAttendeeHours,
  joinSessionAttendance,
  scheduledMinutes,
  sessionListsBySession,
  type AttendedSession,
} from './checkin-core';
import {
  checkInsByList,
  countCheckIns,
  listCheckInLists,
  listRegistrations,
  type CheckInListRow,
  type RegistrationRow,
} from './checkin';
import { listSessions, type SessionRow } from './data';

/**
 * Per-session attendance: the reporting half of the check-in engine.
 *
 * `checkin.ts` is the desk — one scan, one list, one write. This is the
 * question asked afterwards, and by four different screens: how full was that
 * room, who was in it, how many hours did this person sit through, and which
 * sessions is nobody counting at all. The joins themselves live in
 * `checkin-core.ts`, which carries no `server-only` and is therefore reachable
 * from `tests/attendance`; this module is the Firestore reads around them.
 *
 * ── What the numbers here mean, exactly ─────────────────────────────────────
 *
 * **Counted in, not registered.** A number on these screens is people who were
 * scanned at a door. It is not a booking, a bookmark or a reservation — none of
 * those exist in this system, and `attendees/session-cap` says so at the top of
 * the screen. So "42 counted in against a cap of 40" is a real over-capacity
 * event that happened, not a booking error that could have been prevented.
 *
 * **Absent is not zero.** A session whose list was never created is `tracked:
 * false`, and every screen below distinguishes it from a session whose door was
 * open and nobody came. Printing "0 attended" for a room nobody was counting is
 * the precise shape of the mistake this repo keeps finding — a number that
 * looks like a measurement and is actually an absence of one.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * One `where('eventId', '==', …)` for the sessions, one for the lists, then a
 * single aggregate per *existing* session list. Sessions nobody has counted
 * cost nothing. No composite index is declared or needed, which matters because
 * the emulator does not enforce index configuration and a missing one only
 * surfaces in production as `failed-precondition`.
 */

export { formatHours, scheduledMinutes, sessionListsBySession };
export type { AttendedSession };

export interface SessionAttendanceRow {
  session: SessionRow;
  listId: string;
  /** A door was opened for this session at some point. */
  tracked: boolean;
  countedIn: number;
  /** Scheduled length in minutes — what an hours claim would be based on. */
  minutes: number;
}

export interface SessionAttendanceReport {
  rows: SessionAttendanceRow[];
  /** Sessions with a door list. The denominator for "are we measuring this?". */
  tracked: number;
  /** Live sessions in the programme — cancelled ones are not counted or shown. */
  live: number;
  totalCountedIn: number;
}

export async function sessionAttendance(): Promise<SessionAttendanceReport> {
  const [sessions, lists] = await Promise.all([listSessions(), listCheckInLists()]);
  const live = sessions.filter((s) => s.status !== 'cancelled');

  const counts = await countCheckIns(
    [...sessionListsBySession<CheckInListRow>(lists).values()].map((l) => l.id),
  );
  const rows = joinSessionAttendance(live, lists, counts);

  return {
    rows,
    tracked: rows.filter((r) => r.tracked).length,
    live: live.length,
    totalCountedIn: rows.reduce((n, r) => n + r.countedIn, 0),
  };
}

export interface AttendeeAttendanceRow {
  registration: RegistrationRow;
  sessions: AttendedSession[];
  /** Sum of the scheduled lengths of the sessions they were counted into. */
  minutes: number;
}

export interface AttendeeAttendanceReport {
  rows: AttendeeAttendanceRow[];
  /** Sessions with a door list, so a reader can judge how complete the hours are. */
  tracked: number;
  live: number;
}

/**
 * Hours per attendee, from session check-ins.
 *
 * ⚠️ These are *scheduled* hours — see `joinAttendeeHours`. Only sessions with
 * a list are read, and only attendees with at least one session check-in
 * appear.
 */
export async function attendeeAttendance(): Promise<AttendeeAttendanceReport> {
  const [sessions, lists, registrations] = await Promise.all([
    listSessions(),
    listCheckInLists(),
    listRegistrations(),
  ]);

  const live = sessions.filter((s) => s.status !== 'cancelled');
  const liveIds = new Set(live.map((s) => s.id));
  const present = [...sessionListsBySession<CheckInListRow>(lists).entries()].filter(([id]) =>
    liveIds.has(id),
  );

  const byList = await checkInsByList(present.map(([, l]) => l.id));
  const joined = joinAttendeeHours(live, lists, byList);
  const byRegistration = new Map(registrations.map((r) => [r.row.id, r.row]));

  const rows: AttendeeAttendanceRow[] = joined
    .map((j) => ({
      registration: byRegistration.get(j.registrationId) ?? {
        id: j.registrationId,
        // A check-in outlives the registration it was written for: the document
        // is keyed by registration id and nothing cascades. Named rather than
        // dropped, because a certificate run that silently loses a row is worse
        // than one that shows an unresolvable id.
        name: '(registration since deleted)',
        email: '—',
        status: 'cancelled' as const,
        claimed: false,
      },
      sessions: j.sessions,
      minutes: j.minutes,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.registration.name.localeCompare(b.registration.name));

  return { rows, tracked: present.length, live: live.length };
}
