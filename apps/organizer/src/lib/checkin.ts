import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DOOR_CHECK_IN_LIST_ID,
  EVENT_ID,
  SUBCOLLECTIONS,
  type CheckInDoc,
  type CheckInListDoc,
  type CheckInStationDoc,
  type RegistrationDoc,
  type ScanEventDoc,
  type SessionDoc,
} from '@kgc/shared';
import {
  DAY_PATTERN,
  dayListId,
  ensureScopedList,
  SCOPE_GRACE_MINUTES,
  sessionListId,
} from './checkin-core';
import { db } from './firestore';

/**
 * Reads and shared vocabulary for Attendees → Attendee Check-in.
 *
 * Everything here runs on the server with the Admin SDK. The rows it returns
 * are plain objects — no `Timestamp`, no class instances — because the scanner
 * is a client component and anything crossing that boundary has to serialise.
 *
 * Two rules govern every query below and neither is negotiable:
 *
 *  1. **Never look up a registration by uid.** Only `qrSecret` and `claimCode`
 *     are scannable. A uid in a badge QR would let anyone who photographs a
 *     badge across a room learn an identity, which is exactly why
 *     `RegistrationDoc.qrSecret` exists and says so in its comment.
 *
 *  2. **No query that needs a composite index.** `where('eventId', '==', …)`
 *     alone is served by Firestore's automatic single-field index; the moment
 *     an `orderBy` on a second field joins it, it needs an entry in
 *     `firestore.indexes.json` that this repo does not declare and that the
 *     console is not allowed to add. The emulator does not enforce indexes, so
 *     such a query passes locally and fails with `failed-precondition` in
 *     production. AGENTS.md records that bug shipping twice. Fifty-three
 *     registrations filter in memory in microseconds.
 */

/**
 * The id the door list is seeded at, so two concurrent requests cannot create two.
 *
 * Re-exported from `@kgc/shared` rather than spelled here: the attendee app's
 * badge reads its own check-in status from this same list, and a second copy of
 * the literal would drift into a badge that reports "not checked in" for
 * somebody the desk has already waved through.
 */
export const DEFAULT_LIST_ID = DOOR_CHECK_IN_LIST_ID;

export type ScanOutcome = ScanEventDoc['result'];

export interface CheckInListRow {
  id: string;
  name: string;
  kind: CheckInListDoc['kind'];
  sessionId?: string;
  /** ISO. Present on scoped lists; the window this list is the right one during. */
  opensAt?: string;
  closesAt?: string;
}

export interface RegistrationRow {
  id: string;
  name: string;
  email: string;
  ticketType?: string;
  status: RegistrationDoc['status'];
  claimed: boolean;
}

export interface CheckInRow {
  registrationId: string;
  name: string;
  email: string;
  ticketType?: string;
  checkedInAt: string | null;
  stationId: string;
  stationLabel: string;
}

export interface ScanEventRow {
  id: string;
  deviceId: string;
  clientScanId: string;
  /** Truncated — the whole point of `qrSecret` is that it is not shoulder-readable. */
  code: string;
  listId: string;
  result: ScanOutcome;
  scannedAt: string | null;
}

function iso(t: unknown): string | null {
  const v = t as { toDate?: () => Date } | undefined;
  return v?.toDate ? v.toDate().toISOString() : null;
}

/** Show enough of a secret to match it against a screen, never enough to reuse it. */
export function maskCode(code: string): string {
  if (code.length <= 8) return code;
  return `${code.slice(0, 4)}…${code.slice(-4)}`;
}

/**
 * Every check-in list for the event, door list first.
 *
 * Seeds `checkInLists/event-door` when the collection is empty, because the
 * screen is useless without a list and asking an organizer to create one before
 * they can scan anything is a step that only ever happens at 08:55 on day one.
 * The id is fixed rather than generated so that two browser tabs racing this
 * produce one list, not two: the second `create()` fails with `already-exists`
 * and is swallowed.
 */
export async function listCheckInLists(): Promise<CheckInListRow[]> {
  const col = db().collection(COLLECTIONS.checkInLists);
  let snap = await col.where('eventId', '==', EVENT_ID).get();

  if (snap.empty) {
    const now = FieldValue.serverTimestamp();
    try {
      await col.doc(DEFAULT_LIST_ID).create({
        eventId: EVENT_ID,
        name: 'KGC 2027 — Main Door',
        kind: 'event',
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Another request seeded it first. That is the desired outcome.
    }
    snap = await col.where('eventId', '==', EVENT_ID).get();
  }

  return snap.docs
    .map((d) => {
      const l = d.data() as CheckInListDoc;
      return {
        id: d.id,
        name: l.name,
        kind: l.kind,
        sessionId: l.sessionId,
        opensAt: iso(l.opensAt) ?? undefined,
        closesAt: iso(l.closesAt) ?? undefined,
      };
    })
    .sort(
      (a, b) =>
        // The seeded door first, then any other event-scope list, then the
        // rest by name. The page pins the same order for its default
        // selection, and both exist so that adding "Day 2 door" cannot quietly
        // move the main entrance out from under the person standing at it.
        Number(b.id === DEFAULT_LIST_ID) - Number(a.id === DEFAULT_LIST_ID) ||
        Number(b.kind === 'event') - Number(a.kind === 'event') ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Every registration for the event.
 *
 * One query, no index, and the caller uses it for three things at once: the
 * denominator of the live count, the in-memory code match, and the name shown
 * beside each check-in. At 53 documents that is cheaper than three queries.
 */
export async function listRegistrations(): Promise<
  { row: RegistrationRow; qrSecret: string; claimCode?: string }[]
> {
  const snap = await db()
    .collection(COLLECTIONS.registrations)
    .where('eventId', '==', EVENT_ID)
    .get();

  return snap.docs.map((d) => {
    const r = d.data() as RegistrationDoc;
    return {
      row: {
        id: d.id,
        name: r.name ?? r.email,
        email: r.email,
        ticketType: r.ticketType,
        status: r.status,
        claimed: Boolean(r.claimedByUid),
      },
      qrSecret: r.qrSecret,
      claimCode: r.claimCode,
    };
  });
}

/**
 * The one lookup the scanner is allowed to do.
 *
 * `qrSecret` is compared exactly — it is a 32-character random string and a
 * case-insensitive compare would weaken it for no benefit. `claimCode` is
 * compared case-insensitively because it is six characters read off a badge by
 * a human under pressure and typed into a keyboard that may have caps lock on.
 */
export function matchCode(
  registrations: { row: RegistrationRow; qrSecret: string; claimCode?: string }[],
  code: string,
): { row: RegistrationRow; matchedOn: 'qrSecret' | 'claimCode' } | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const bySecret = registrations.find((r) => r.qrSecret === trimmed);
  if (bySecret) return { row: bySecret.row, matchedOn: 'qrSecret' };

  const upper = trimmed.toUpperCase();
  const byClaim = registrations.find((r) => r.claimCode && r.claimCode.toUpperCase() === upper);
  if (byClaim) return { row: byClaim.row, matchedOn: 'claimCode' };

  return null;
}

export async function listStations(): Promise<Map<string, string>> {
  const snap = await db()
    .collection(COLLECTIONS.checkInStations)
    .where('eventId', '==', EVENT_ID)
    .get();
  return new Map(snap.docs.map((d) => [d.id, (d.data() as CheckInStationDoc).label]));
}

/**
 * The most recent check-ins on a list.
 *
 * A single `orderBy` inside one parent's subcollection is served by the
 * automatic index — there is no `where` alongside it to force a composite.
 */
export async function recentCheckIns(
  listId: string,
  registrations: RegistrationRow[],
  stations: Map<string, string>,
  limit = 20,
): Promise<{ rows: CheckInRow[]; total: number }> {
  const col = db()
    .collection(COLLECTIONS.checkInLists)
    .doc(listId)
    .collection(SUBCOLLECTIONS.checkIns);

  const [countSnap, snap] = await Promise.all([
    col.count().get(),
    col.orderBy('checkedInAt', 'desc').limit(limit).get(),
  ]);

  const byId = new Map(registrations.map((r) => [r.id, r]));

  return {
    total: countSnap.data().count,
    rows: snap.docs.map((d) => {
      const c = d.data() as CheckInDoc;
      const reg = byId.get(c.registrationId);
      return {
        registrationId: c.registrationId,
        name: reg?.name ?? '(registration since deleted)',
        email: reg?.email ?? '—',
        ticketType: reg?.ticketType,
        checkedInAt: iso(c.checkedInAt),
        stationId: c.stationId,
        stationLabel: stations.get(c.stationId) ?? c.stationId,
      };
    }),
  };
}

/**
 * Every check-in on a list, oldest first — the export, not the live strip.
 *
 * `recentCheckIns` caps at twenty and sorts newest-first because it feeds a
 * "who just came through" panel behind the desk. This is the other question:
 * the whole list, in the order people arrived, for the CSV somebody reconciles
 * against a caterer's headcount. Oldest-first because that is what a register
 * reads like.
 *
 * No `limit`, and that is safe at this scale for the same reason the rest of
 * this module sorts in memory: a check-in subcollection tops out at one document
 * per registration, low thousands at the outside, and it is read on demand from
 * a download rather than on every page render.
 */
export async function allCheckIns(
  listId: string,
  registrations: RegistrationRow[],
  stations: Map<string, string>,
): Promise<CheckInRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.checkInLists)
    .doc(listId)
    .collection(SUBCOLLECTIONS.checkIns)
    .orderBy('checkedInAt', 'asc')
    .get();

  const byId = new Map(registrations.map((r) => [r.id, r]));

  return snap.docs.map((d) => {
    const c = d.data() as CheckInDoc;
    const reg = byId.get(c.registrationId);
    return {
      registrationId: c.registrationId,
      name: reg?.name ?? '(registration since deleted)',
      email: reg?.email ?? '—',
      ticketType: reg?.ticketType,
      checkedInAt: iso(c.checkedInAt),
      stationId: c.stationId,
      stationLabel: stations.get(c.stationId) ?? c.stationId,
    };
  });
}

/**
 * The raw scan log, newest first.
 *
 * Ordered by `scannedAt` with no `where` beside it, for the composite-index
 * reason above — the same trade `recentAudit()` in `data.ts` makes, and for the
 * same reason: there is exactly one event. The list filter happens in memory,
 * so it over-fetches slightly and that is the cheap side of the mistake.
 *
 * THIS `orderBy` DEPENDS ON A SINGLE-FIELD INDEX ON `scanEvents.scannedAt`,
 * and it did not have one.
 *
 * `firestore.indexes.json` carried a `fieldOverrides` entry setting
 * `scanEvents.scannedAt` to `"indexes": []`, which turns single-field indexing
 * off for that field. An `orderBy` on a field with no index fails in production
 * with `failed-precondition` — and the Firestore emulator does not enforce index
 * configuration at all, so this query passed every local run and would have
 * failed the first time the war room was opened live. AGENTS.md records two
 * screens already shipped broken exactly this way.
 *
 * The override was re-enabled (DESCENDING only, which is the one direction this
 * query needs). The reasoning, recorded here because JSON cannot hold a comment:
 * disabling the index protects write throughput, and a monotonically increasing
 * timestamp genuinely is Firestore's textbook index hotspot, capped near 500
 * writes/sec on sequential index values. But the door scanner at a ~1,000-person
 * conference peaks at a handful of scans per second — three orders of magnitude
 * below that ceiling — so the override was paying a real, load-bearing query to
 * avoid a limit this event cannot reach. If KGC ever runs at a scale where scan
 * throughput is the constraint, the fix is a sharded or bucketed ordering key,
 * not an unindexed `orderBy` that cannot run.
 */
export async function recentScanEvents(listId: string, limit = 20): Promise<ScanEventRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.scanEvents)
    .orderBy('scannedAt', 'desc')
    .limit(limit * 4)
    .get();

  return snap.docs
    .map((d) => {
      const e = d.data() as ScanEventDoc;
      return {
        id: d.id,
        deviceId: e.deviceId,
        clientScanId: e.clientScanId,
        code: maskCode(e.qrSecret ?? ''),
        listId: e.listId,
        result: e.result,
        scannedAt: iso(e.scannedAt),
      };
    })
    .filter((e) => e.listId === listId)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Scoped lists — a day, or a session
// ---------------------------------------------------------------------------

/**
 * Day and session scope, which the engine has always supported.
 *
 * A scope is another `checkInLists` document and nothing else: the scanner, the
 * desk table, the undo and the export all take a `listId` and none of them care
 * what it means. So the whole of "per-session attendance" is deciding the id,
 * creating the document once, and pointing the existing machinery at it.
 *
 * ── The ids are derived, not generated ──────────────────────────────────────
 *
 * `session-{sessionId}` and `day-{YYYY-MM-DD}`, for the same reason
 * `DOOR_CHECK_IN_LIST_ID` is a constant: two organizers pressing Start on the
 * same session at the same moment must produce one list, not two, and the
 * second `create()` failing with `already-exists` is what guarantees it. A
 * generated id would give the room two half-populated attendance records and no
 * way to tell which one the door was scanning into. It also means a caller can
 * ask "does this session have attendance yet" by path rather than by query.
 *
 * ── `opensAt` / `closesAt` are the clock, and they are advisory ─────────────
 *
 * They are stamped from the session's own UTC instants with a grace window,
 * because people arrive late and a door that stops counting on the hour
 * under-reports the room. Nothing *enforces* them — a scan outside the window
 * still writes — and that is deliberate: the alternative is a scanner that
 * refuses a badge in front of a queue because a session over-ran, which is a
 * worse failure than a slightly generous count. They exist so the UI can
 * default to the session that is actually happening.
 */
export { dayListId, sessionListId, SCOPE_GRACE_MINUTES } from './checkin-core';

export interface EnsureListResult {
  id: string;
  name: string;
  created: boolean;
}

/** The sentinels this module's own copy of `firebase-admin` builds. See gotcha 8. */
const SENTINELS = { serverTimestamp: () => FieldValue.serverTimestamp() };

/**
 * The check-in list for one session, created on first use.
 *
 * The name is the session title with its start time, because that is what the
 * person holding the scanner is looking at on a printed run sheet — two runs of
 * the same workshop are distinguishable by nothing else.
 */
export async function ensureSessionList(sessionId: string): Promise<EnsureListResult> {
  const sessionSnap = await db().collection(COLLECTIONS.sessions).doc(sessionId).get();
  if (!sessionSnap.exists) throw new Error('That session no longer exists.');
  const session = sessionSnap.data() as SessionDoc;

  const id = sessionListId(sessionId);
  const name = `${session.title} — ${session.startsAtLocal.slice(11, 16)}`;
  const grace = SCOPE_GRACE_MINUTES * 60 * 1000;

  return {
    id,
    name,
    created: await ensureScopedList(
      db(),
      id,
      {
        name,
        kind: 'session',
        sessionId,
        opensAt: shift(session.startsAt, -grace),
        closesAt: shift(session.endsAt, grace),
      },
      SENTINELS,
    ),
  };
}

/**
 * The check-in list for one day of the programme.
 *
 * Unlike a session list this carries no window: a day list is open all day by
 * definition, and inventing 08:00–18:00 would be a guess this system has no
 * basis for. `day` is the session model's own denormalised `YYYY-MM-DD` in the
 * event's timezone, so a 21:00 reception counts on the day it feels like rather
 * than the UTC day it falls in.
 */
export async function ensureDayList(day: string): Promise<EnsureListResult> {
  if (!DAY_PATTERN.test(day)) throw new Error('That is not a programme day.');
  const id = dayListId(day);
  const name = `Day — ${day}`;
  return {
    id,
    name,
    created: await ensureScopedList(db(), id, { name, kind: 'event' }, SENTINELS),
  };
}

function shift(t: unknown, ms: number): Timestamp | undefined {
  const v = t as { toDate?: () => Date } | undefined;
  if (!v?.toDate) return undefined;
  return Timestamp.fromDate(new Date(v.toDate().getTime() + ms));
}

/**
 * How many people were counted into each of these lists.
 *
 * One `count()` aggregate per list rather than reading the documents: the
 * caller wants a number per row on a table of seventy sessions, and an
 * aggregate is billed at a fraction of a document read. It is still one round
 * trip per list, which is why the caller passes only the lists that exist —
 * a session nobody has opened a door for has no list and therefore no query.
 */
export async function countCheckIns(listIds: string[]): Promise<Map<string, number>> {
  const counts = await Promise.all(
    listIds.map(async (id) => {
      const snap = await db()
        .collection(COLLECTIONS.checkInLists)
        .doc(id)
        .collection(SUBCOLLECTIONS.checkIns)
        .count()
        .get();
      return [id, snap.data().count] as const;
    }),
  );
  return new Map(counts);
}

/**
 * Every registration id counted into each list.
 *
 * The document-level read that `countCheckIns` avoids, for the two callers that
 * genuinely need the membership rather than the size: the per-attendee hours a
 * certificate would name, and the session-attendance export. Kept separate so
 * that the screens which only want counts do not pay for it.
 */
export async function checkInsByList(
  listIds: string[],
): Promise<Map<string, { registrationId: string; checkedInAt: string | null }[]>> {
  const entries = await Promise.all(
    listIds.map(async (id) => {
      const snap = await db()
        .collection(COLLECTIONS.checkInLists)
        .doc(id)
        .collection(SUBCOLLECTIONS.checkIns)
        .orderBy('checkedInAt', 'asc')
        .get();
      return [
        id,
        snap.docs.map((d) => {
          const c = d.data() as CheckInDoc;
          return { registrationId: c.registrationId, checkedInAt: iso(c.checkedInAt) };
        }),
      ] as const;
    }),
  );
  return new Map(entries);
}

/**
 * `checkInStations/{deviceId}` — keyed by the device, so a station that reloads
 * the page is the same station and a duplicate scan can name where it happened.
 */
export async function touchStation(deviceId: string, label: string): Promise<void> {
  const ref = db().collection(COLLECTIONS.checkInStations).doc(deviceId);
  const now = FieldValue.serverTimestamp();
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ label, lastSeenAt: now, updatedAt: now });
  } else {
    await ref.set({
      eventId: EVENT_ID,
      label,
      deviceId,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}
