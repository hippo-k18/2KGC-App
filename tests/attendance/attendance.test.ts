/**
 * Tests for per-session check-in scope, against the **Firestore emulator**.
 *
 * The joins are pure and tested in `tests/programme/attendance-core.test.ts`.
 * What is left here is everything that is a property of Firestore rather than
 * of our arithmetic, and it is the half most likely to be silently wrong:
 *
 *   - a `create()` at a derived id whose `already-exists` is *success*, which
 *     is the whole deduplication mechanism for two organizers pressing Start on
 *     the same session at the same moment;
 *   - that the losing call leaves the winner's document untouched, since the
 *     alternative — a `set({ merge: true })` — would silently restamp it;
 *   - that a `count()` aggregate over a subcollection returns what the
 *     documents say;
 *   - and that the same registration checked into the door *and* into a room is
 *     two documents rather than a collision, which is the property that makes
 *     per-session attendance possible at all.
 *
 * ⚠️ `sentinels` is passed in on every call, exactly as `tests/denormalise`
 * does. `checkin-core` is handed the store this suite builds from the **root**
 * copy of `firebase-admin`, and Firestore validates `FieldValue` sentinels with
 * `instanceof`, so one built by a different copy fails the entire write with
 * "Couldn't serialize object of type l". That is AGENTS.md gotcha 8.
 *
 * Run with: npm run test:attendance
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DOOR_CHECK_IN_LIST_ID, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';

import {
  dayListId,
  ensureScopedList,
  joinAttendeeHours,
  joinSessionAttendance,
  sessionListId,
  type ListLike,
  type SessionLike,
} from '../../apps/organizer/src/lib/checkin-core';

/**
 * Refuse to run against anything real. This suite creates check-in lists and
 * check-in documents; pointed at the live project by a stray environment
 * variable it would write attendance for a conference that has not happened.
 */
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

let db: Firestore;

/** The root copy's sentinels, matching the store built below. See the docblock. */
const sentinels = { serverTimestamp: () => FieldValue.serverTimestamp() };

const DAY = '2027-05-05';

const SESSIONS: SessionLike[] = [
  {
    id: 'keynote',
    title: 'Opening keynote',
    day: DAY,
    startsAtLocal: `${DAY}T09:00`,
    endsAtLocal: `${DAY}T10:30`,
  },
  {
    id: 'workshop',
    title: 'Shapes workshop',
    day: DAY,
    startsAtLocal: `${DAY}T14:00`,
    endsAtLocal: `${DAY}T15:00`,
  },
];

beforeAll(() => {
  if (!EMULATOR) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:attendance',
    );
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
});

function store(): Firestore {
  return db;
}

/** Every list and everything under it, so one test cannot see another's doors. */
beforeEach(async () => {
  const snap = await store().collection(COLLECTIONS.checkInLists).get();
  for (const doc of snap.docs) {
    const subs = await doc.ref.collection(SUBCOLLECTIONS.checkIns).get();
    await Promise.all(subs.docs.map((s) => s.ref.delete()));
    await doc.ref.delete();
  }
});

async function checkIn(listId: string, registrationId: string) {
  await store()
    .collection(COLLECTIONS.checkInLists)
    .doc(listId)
    .collection(SUBCOLLECTIONS.checkIns)
    .doc(registrationId)
    .create({
      registrationId,
      checkedInAt: FieldValue.serverTimestamp(),
      stationId: 'test-station',
      operatorUid: 'test@example.com',
    });
}

async function countOn(listId: string): Promise<number> {
  const snap = await store()
    .collection(COLLECTIONS.checkInLists)
    .doc(listId)
    .collection(SUBCOLLECTIONS.checkIns)
    .count()
    .get();
  return snap.data().count;
}

async function readLists(): Promise<ListLike[]> {
  const snap = await store().collection(COLLECTIONS.checkInLists).where('eventId', '==', EVENT_ID).get();
  return snap.docs.map((d) => {
    const l = d.data() as { kind: ListLike['kind']; sessionId?: string };
    return { id: d.id, kind: l.kind, sessionId: l.sessionId };
  });
}

async function openSessionDoor(session: SessionLike) {
  const grace = 15 * 60 * 1000;
  const start = Date.parse(`${session.startsAtLocal}:00Z`);
  const end = Date.parse(`${session.endsAtLocal}:00Z`);
  return ensureScopedList(
    store(),
    sessionListId(session.id),
    {
      name: `${session.title} — ${session.startsAtLocal.slice(11, 16)}`,
      kind: 'session',
      sessionId: session.id,
      opensAt: Timestamp.fromDate(new Date(start - grace)),
      closesAt: Timestamp.fromDate(new Date(end + grace)),
    },
    sentinels,
  );
}

describe('opening a session door', () => {
  it('creates the list at the derived id', async () => {
    expect(await openSessionDoor(SESSIONS[0])).toBe(true);

    const doc = await store()
      .collection(COLLECTIONS.checkInLists)
      .doc('session-keynote')
      .get();

    expect(doc.exists).toBe(true);
    expect(doc.data()).toMatchObject({
      eventId: EVENT_ID,
      kind: 'session',
      sessionId: 'keynote',
      name: 'Opening keynote — 09:00',
    });
  });

  it('stamps the window from the session, with a grace either side', async () => {
    await openSessionDoor(SESSIONS[0]);
    const data = (await store().collection(COLLECTIONS.checkInLists).doc('session-keynote').get()).data()!;

    expect((data.opensAt as Timestamp).toDate().toISOString()).toBe('2027-05-05T08:45:00.000Z');
    expect((data.closesAt as Timestamp).toDate().toISOString()).toBe('2027-05-05T10:45:00.000Z');
  });

  it('is idempotent — a second Start resumes rather than opening a second door', async () => {
    expect(await openSessionDoor(SESSIONS[0])).toBe(true);
    expect(await openSessionDoor(SESSIONS[0])).toBe(false);

    const snap = await store().collection(COLLECTIONS.checkInLists).get();
    expect(snap.size).toBe(1);
  });

  it('leaves the first document untouched when the second call loses', async () => {
    await openSessionDoor(SESSIONS[0]);
    const first = (await store().collection(COLLECTIONS.checkInLists).doc('session-keynote').get()).data()!;

    // A renamed session, pressed again. The losing `create()` must not restamp
    // the door — the check-ins already under it were counted into the original.
    await ensureScopedList(
      store(),
      sessionListId('keynote'),
      { name: 'A COMPLETELY DIFFERENT NAME', kind: 'session', sessionId: 'keynote' },
      sentinels,
    );

    const after = (await store().collection(COLLECTIONS.checkInLists).doc('session-keynote').get()).data()!;
    expect(after.name).toBe(first.name);
    expect((after.createdAt as Timestamp).toMillis()).toBe((first.createdAt as Timestamp).toMillis());
  });

  it('produces exactly one door when two organizers press Start at the same moment', async () => {
    const results = await Promise.all([
      openSessionDoor(SESSIONS[0]),
      openSessionDoor(SESSIONS[0]),
      openSessionDoor(SESSIONS[0]),
    ]);

    // One winner, and the failure of the other two is the deduplication.
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store().collection(COLLECTIONS.checkInLists).get()).size).toBe(1);
  });
});

describe('opening a day door', () => {
  it('creates an event-scope list with no window, because a day has none to infer', async () => {
    expect(
      await ensureScopedList(
        store(),
        dayListId(DAY),
        { name: `Day — ${DAY}`, kind: 'event' },
        sentinels,
      ),
    ).toBe(true);

    const data = (await store().collection(COLLECTIONS.checkInLists).doc(`day-${DAY}`).get()).data()!;
    expect(data.kind).toBe('event');
    expect(data.opensAt).toBeUndefined();
    expect(data.sessionId).toBeUndefined();
  });
});

describe('counting people into rooms', () => {
  it('keeps a room count separate from the door count for the same person', async () => {
    await ensureScopedList(
      store(),
      DOOR_CHECK_IN_LIST_ID,
      { name: 'Main door', kind: 'event' },
      sentinels,
    );
    await openSessionDoor(SESSIONS[0]);

    await checkIn(DOOR_CHECK_IN_LIST_ID, 'reg_ada');
    await checkIn(sessionListId('keynote'), 'reg_ada');

    // The same registration id in two lists is two documents, not a collision.
    // Without this, per-session attendance is not expressible at all.
    expect(await countOn(DOOR_CHECK_IN_LIST_ID)).toBe(1);
    expect(await countOn(sessionListId('keynote'))).toBe(1);
  });

  it('still refuses a second scan of the same badge into the same room', async () => {
    await openSessionDoor(SESSIONS[0]);
    await checkIn(sessionListId('keynote'), 'reg_ada');

    await expect(checkIn(sessionListId('keynote'), 'reg_ada')).rejects.toThrow();
    expect(await countOn(sessionListId('keynote'))).toBe(1);
  });

  it('reports counted-in per session and untracked for a room nobody opened', async () => {
    await openSessionDoor(SESSIONS[0]);
    await checkIn(sessionListId('keynote'), 'reg_ada');
    await checkIn(sessionListId('keynote'), 'reg_grace');

    const lists = await readLists();
    const counts = new Map([[sessionListId('keynote'), await countOn(sessionListId('keynote'))]]);
    const rows = joinSessionAttendance(SESSIONS, lists, counts);

    expect(rows.find((r) => r.session.id === 'keynote')).toMatchObject({
      tracked: true,
      countedIn: 2,
      minutes: 90,
    });
    expect(rows.find((r) => r.session.id === 'workshop')).toMatchObject({ tracked: false });
  });

  it('adds a person’s rooms into hours a certificate could quote', async () => {
    await openSessionDoor(SESSIONS[0]);
    await openSessionDoor(SESSIONS[1]);
    await checkIn(sessionListId('keynote'), 'reg_ada');
    await checkIn(sessionListId('workshop'), 'reg_ada');
    await checkIn(sessionListId('workshop'), 'reg_grace');

    const lists = await readLists();
    const byList = new Map<string, { registrationId: string; checkedInAt: string | null }[]>();
    for (const list of lists) {
      const snap = await store()
        .collection(COLLECTIONS.checkInLists)
        .doc(list.id)
        .collection(SUBCOLLECTIONS.checkIns)
        .orderBy('checkedInAt', 'asc')
        .get();
      byList.set(
        list.id,
        snap.docs.map((d) => ({
          registrationId: d.data().registrationId as string,
          checkedInAt: (d.data().checkedInAt as Timestamp).toDate().toISOString(),
        })),
      );
    }

    const rows = joinAttendeeHours(SESSIONS, lists, byList);
    expect(rows.find((r) => r.registrationId === 'reg_ada')!.minutes).toBe(150);
    expect(rows.find((r) => r.registrationId === 'reg_grace')!.minutes).toBe(60);
  });
});
