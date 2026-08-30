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
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const UID = 'test-agenda-change-user';
const SESSION_ID = 'test-agenda-change-session';

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

async function cleanupFixtures() {
  const notifs = await notificationsRef.get();
  await Promise.all(notifs.docs.map((d) => d.ref.delete()));
  await usersRef.doc(UID).collection(SUBCOLLECTIONS.savedSessions).doc(SESSION_ID).delete();
  await usersRef.doc(UID).delete();
  await sessionsRef.doc(SESSION_ID).delete();
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
    // Off: `onSessionAgendaChange` notifies unconditionally regardless of
    // this, and leaving `announcements` off keeps this fixture out of
    // `onAnnouncementCreate`'s fan-out too — see the note on notificationCount.
    notificationPrefs: { announcements: false, messages: false, sessionReminders: false },
    roles: ['attendee'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await usersRef.doc(UID).collection(SUBCOLLECTIONS.savedSessions).doc(SESSION_ID).set({
    sessionId: SESSION_ID,
    savedAt: new Date(),
    remind: false,
  });
  await sessionsRef.doc(SESSION_ID).create(baseSession());
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
