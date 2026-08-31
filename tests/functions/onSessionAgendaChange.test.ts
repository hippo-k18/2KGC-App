/**
 * Integration test for `onSessionAgendaChange` (functions/SPEC.md #8), run
 * against the real Firestore + Functions emulators. See onReplyWrite.test.ts
 * for why this is an integration test rather than a unit test calling the
 * trigger directly.
 *
 * A throwaway `sessions/{id}` and `users/{uid}` fixture, not a seeded one —
 * the collection-group query this trigger runs needs a known, isolated
 * `savedSessions` entry to assert against, and mutating a seeded session's
 * `roomId`/`day` would leave the emulator's seed data in a different shape
 * than `npm run seed` produced.
 *
 * Run with: npm run test:functions
 */
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, TIME_ZONE } from '@kgc/shared';
import { Timestamp, type CollectionReference, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const UID = 'test-agenda-change-user';
const SESSION_ID = 'test-agenda-change-session';
/** The debounce and the breaker each need a session with its own history. */
const DEBOUNCE_SESSION_ID = 'test-agenda-change-debounce-session';
const BUDGET_SESSION_ID = 'test-agenda-change-budget-session';

/**
 * Both live in `rateLimits` under prefixed ids — see the constants at the top
 * of functions/src/triggers/on-session-agenda-change.ts. Spelled out here
 * rather than imported, so a rename of either one fails this file loudly
 * instead of quietly testing a document nothing reads.
 */
const FANOUT_BUDGET_ID = 'agendaNotice_fanout';
const noticeStateId = (sessionId: string) => `agendaNotice_${sessionId}`;
const FANOUT_MAX_SESSIONS = 20;

let db: Firestore;
let usersRef: CollectionReference;
let sessionsRef: CollectionReference;
let notificationsRef: CollectionReference;

function baseSession() {
  const now = new Date();
  return {
    eventId: EVENT_ID,
    title: 'Test Agenda Change Session',
    timeZone: TIME_ZONE,
    startsAtLocal: '2027-04-13T09:00',
    endsAtLocal: '2027-04-13T09:45',
    startsAt: now,
    endsAt: now,
    day: '2027-04-13',
    roomId: 'room-a',
    trackIds: [],
    format: 'talk',
    speakerIds: [],
    tags: [],
    status: 'published',
    createdAt: now,
    updatedAt: now,
  };
}

// Scoped to type == 'agenda-change': this fixture is a real `users/{uid}` doc
// with `eventId` set, so it is also eligible for `onAnnouncementCreate`'s
// fan-out from any seeded announcement whose trigger is still draining in the
// background when this file's `beforeAll` runs — unrelated 'announcement'
// notifications landing in the same subcollection are not a fluke to work
// around, just noise this test has no business reading.
async function notificationCount(): Promise<number> {
  return (await notificationsRef.where('type', '==', 'agenda-change').get()).size;
}

async function latestNotification() {
  const snap = await notificationsRef
    .where('type', '==', 'agenda-change')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return snap.docs[0]?.data();
}

const ALL_SESSION_IDS = [SESSION_ID, DEBOUNCE_SESSION_ID, BUDGET_SESSION_ID];

async function cleanupFixtures() {
  const notifs = await notificationsRef.get();
  await Promise.all(notifs.docs.map((d) => d.ref.delete()));
  for (const id of ALL_SESSION_IDS) {
    await usersRef.doc(UID).collection(SUBCOLLECTIONS.savedSessions).doc(id).delete();
    await sessionsRef.doc(id).delete();
    await db.collection(COLLECTIONS.rateLimits).doc(noticeStateId(id)).delete();
  }
  await usersRef.doc(UID).delete();
  // The breaker's counter is event-wide, so a test that spends it would
  // silence every later agenda change in the emulator, in this file and any
  // other. Cleared at both ends rather than only after.
  await db.collection(COLLECTIONS.rateLimits).doc(FANOUT_BUDGET_ID).delete();
}

beforeAll(async () => {
  db = connectToEmulator();
  usersRef = db.collection(COLLECTIONS.users);
  sessionsRef = db.collection(COLLECTIONS.sessions);
  notificationsRef = usersRef.doc(UID).collection(SUBCOLLECTIONS.notifications);

  await cleanupFixtures();

  await usersRef.doc(UID).set({
    eventId: EVENT_ID,
    email: 'agenda-change@example.test',
    name: 'Test Agenda Change',
    interests: [],
    onboarded: true,
    visibleInDirectory: false,
    messagingEnabled: true,
    // `sessionReminders: false` gates the FCM push only — the in-app
    // notification document this file counts is still written
    // unconditionally, per SPEC.md's Phase 0 decision 5. Leaving
    // `announcements` off keeps this fixture out of `onAnnouncementCreate`'s
    // fan-out too — see the note on notificationCount.
    notificationPrefs: { announcements: false, messages: false, sessionReminders: false },
    roles: ['attendee'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  for (const id of ALL_SESSION_IDS) {
    await usersRef.doc(UID).collection(SUBCOLLECTIONS.savedSessions).doc(id).set({
      sessionId: id,
      savedAt: new Date(),
      remind: false,
    });
    await sessionsRef.doc(id).create(baseSession());
  }
}, 20_000);

afterAll(async () => {
  await cleanupFixtures();
});

describe('onSessionAgendaChange', () => {
  it('notifies an attendee who saved the session when a published session changes rooms', async () => {
    const before = await notificationCount();

    await sessionsRef.doc(SESSION_ID).update({ roomId: 'room-b', updatedAt: new Date() });

    await expect.poll(() => notificationCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);

    const notification = await latestNotification();
    expect(notification?.type).toBe('agenda-change');
    expect(notification?.href).toBe(`/agenda/${SESSION_ID}`);
    expect(notification?.body).toContain('room');
    expect(notification?.read).toBe(false);
  }, 20_000);

  it('does not notify on a cosmetic-only change', async () => {
    const before = await notificationCount();

    await sessionsRef.doc(SESSION_ID).update({ description: 'A new description', updatedAt: new Date() });

    // No poll toward a new value here on purpose — we are asserting nothing
    // was written, so give the (would-be) trigger time to fire and then
    // check it did nothing.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await notificationCount()).toBe(before);
  }, 20_000);

  it('notifies with a cancellation message when a published session is cancelled', async () => {
    const before = await notificationCount();

    await sessionsRef.doc(SESSION_ID).update({ status: 'cancelled', updatedAt: new Date() });

    await expect.poll(() => notificationCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);

    const notification = await latestNotification();
    expect(notification?.body).toContain('cancelled');
  }, 20_000);
});

/**
 * The debounce added in task 0.4. Leading edge: the first material change of a
 * burst notifies at once, and a later one inside the window is dropped only if
 * it says nothing new. Coalescing on elapsed time alone would silently swallow
 * a second real fact, which is worse than one extra notification.
 */
describe('onSessionAgendaChange debounce', () => {
  it('does not notify twice for the same fact changing again inside the window', async () => {
    const before = await notificationCount();

    await sessionsRef.doc(DEBOUNCE_SESSION_ID).update({ roomId: 'room-b', updatedAt: new Date() });
    await expect.poll(() => notificationCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);

    // A second room move, seconds later. This is the shape a re-import makes
    // when it rewrites the same session twice in one pass.
    await sessionsRef.doc(DEBOUNCE_SESSION_ID).update({ roomId: 'room-c', updatedAt: new Date() });

    // Asserting nothing was written, so wait the trigger out rather than
    // polling toward a value.
    await new Promise((r) => setTimeout(r, 4_000));
    expect(await notificationCount()).toBe(before + 1);

    const state = await db.collection(COLLECTIONS.rateLimits).doc(noticeStateId(DEBOUNCE_SESSION_ID)).get();
    expect(state.data()?.changed).toEqual(['room']);
  }, 30_000);

  it('still notifies when a different fact changes inside the same window', async () => {
    const before = await notificationCount();

    await sessionsRef.doc(DEBOUNCE_SESSION_ID).update({
      startsAtLocal: '2027-04-13T14:00',
      endsAtLocal: '2027-04-13T14:45',
      updatedAt: new Date(),
    });

    await expect.poll(() => notificationCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);
    expect((await latestNotification())?.body).toContain('time');

    const state = await db.collection(COLLECTIONS.rateLimits).doc(noticeStateId(DEBOUNCE_SESSION_ID)).get();
    expect(new Set(state.data()?.changed)).toEqual(new Set(['room', 'time']));
  }, 30_000);
});

/**
 * The circuit breaker. This is the one that stands between a bulk agenda
 * re-import and ~100,000 push notifications — see the FANOUT_MAX_SESSIONS
 * docblock in the trigger.
 *
 * Last in the file, and the budget document is cleared in `cleanupFixtures`,
 * because a spent breaker silences every agenda change after it.
 */
describe('onSessionAgendaChange fan-out budget', () => {
  it('suppresses the fan-out once the event-wide budget for the window is spent', async () => {
    // Set at the cap rather than reached by changing 20 real sessions: the
    // behaviour under test is the refusal, and building the fixture through
    // the trigger would make this the slowest test in the suite to assert the
    // same thing.
    await db.collection(COLLECTIONS.rateLimits).doc(FANOUT_BUDGET_ID).set({
      kind: 'agenda-fanout',
      count: FANOUT_MAX_SESSIONS,
      windowStart: Timestamp.now(),
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
    });

    const before = await notificationCount();
    await sessionsRef.doc(BUDGET_SESSION_ID).update({ roomId: 'room-z', updatedAt: new Date() });

    await new Promise((r) => setTimeout(r, 4_000));
    expect(await notificationCount()).toBe(before);

    const budget = await db.collection(COLLECTIONS.rateLimits).doc(FANOUT_BUDGET_ID).get();
    expect(budget.data()?.suppressed).toBe(1);
    // The window is not extended by its own refusals, or a runaway would hold
    // the breaker open indefinitely by continuing to fail.
    expect(budget.data()?.count).toBe(FANOUT_MAX_SESSIONS);
  }, 30_000);
});
