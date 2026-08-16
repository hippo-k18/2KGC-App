import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type CheckInDoc,
  type CheckInListDoc,
  type CheckInStationDoc,
  type RegistrationDoc,
  type ScanEventDoc,
} from '@kgc/shared';
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

/** The id the door list is seeded at, so two concurrent requests cannot create two. */
export const DEFAULT_LIST_ID = 'event-door';

export type ScanOutcome = ScanEventDoc['result'];

export interface CheckInListRow {
  id: string;
  name: string;
  kind: CheckInListDoc['kind'];
  sessionId?: string;
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
      return { id: d.id, name: l.name, kind: l.kind, sessionId: l.sessionId };
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
 * The raw scan log, newest first.
 *
 * Ordered by `scannedAt` with no `where` beside it, for the composite-index
 * reason above — the same trade `recentAudit()` in `data.ts` makes, and for the
 * same reason: there is exactly one event. The list filter happens in memory,
 * so it over-fetches slightly and that is the cheap side of the mistake.
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
