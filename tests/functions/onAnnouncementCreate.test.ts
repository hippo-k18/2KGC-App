/**
 * Integration test for `onAnnouncementCreate` (functions/SPEC.md #7), run
 * against the real Firestore + Functions emulators. See onReplyWrite.test.ts
 * for why this is an integration test rather than a unit test calling the
 * trigger directly.
 *
 * Two throwaway `users/{uid}` fixtures, not seeded ones: every seeded
 * attendee has `notificationPrefs.announcements: true` uniformly (see
 * seed-demo.ts), so there is no seeded example of an attendee who opted
 * out to prove the filter actually filters.
 *
 * This trigger writes the in-app `notifications` record only — it does not
 * send FCM (functions/SPEC.md decision 11: `apps/organizer/src/lib/push.ts`'s
 * `announcementPush()` already sends, from the same dashboard action that
 * creates the `announcements/{id}` document this trigger reacts to, so a
 * second sender here would double-deliver). The `push: true` case below
 * exists to prove that field no longer changes what this trigger writes —
 * it is read by the dashboard action, not by this trigger.
 *
 * Run with: npm run test:functions
 */
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const UID_IN = 'test-announce-user-in';
const UID_OUT = 'test-announce-user-out';
const ANNOUNCEMENT_NO_PUSH = 'test-announcement-no-push';
const ANNOUNCEMENT_PUSH = 'test-announcement-push';

let db: Firestore;
let usersRef: CollectionReference;
let announcementsRef: CollectionReference;

function testUser(announcementsEnabled: boolean) {
  const now = new Date();
  return {
    eventId: EVENT_ID,
    email: `${announcementsEnabled ? UID_IN : UID_OUT}@example.test`,
    name: announcementsEnabled ? 'Test Opted In' : 'Test Opted Out',
    interests: [],
    onboarded: true,
    visibleInDirectory: false,
    messagingEnabled: true,
    notificationPrefs: { announcements: announcementsEnabled, messages: true, sessionReminders: true },
    roles: ['attendee'],
    createdAt: now,
    updatedAt: now,
  };
}

async function cleanupFixtures() {
  for (const announcementId of [ANNOUNCEMENT_NO_PUSH, ANNOUNCEMENT_PUSH]) {
    await announcementsRef.doc(announcementId).delete();
    for (const uid of [UID_IN, UID_OUT]) {
      await usersRef.doc(uid).collection(SUBCOLLECTIONS.notifications).doc(announcementId).delete();
    }
  }
}

beforeAll(async () => {
  db = connectToEmulator();
  usersRef = db.collection(COLLECTIONS.users);
  announcementsRef = db.collection(COLLECTIONS.announcements);

  await cleanupFixtures();
  await usersRef.doc(UID_IN).set(testUser(true));
  await usersRef.doc(UID_OUT).set(testUser(false));
}, 20_000);

afterAll(async () => {
  await cleanupFixtures();
  await usersRef.doc(UID_IN).delete();
  await usersRef.doc(UID_OUT).delete();
});

describe('onAnnouncementCreate', () => {
  it('notifies only attendees with notificationPrefs.announcements enabled', async () => {
    await announcementsRef.doc(ANNOUNCEMENT_NO_PUSH).create({
      eventId: EVENT_ID,
      title: 'Test announcement',
      body: 'Body text',
      authorId: 'demo_000',
      push: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const inNotification = usersRef.doc(UID_IN).collection(SUBCOLLECTIONS.notifications).doc(ANNOUNCEMENT_NO_PUSH);

    await expect
      .poll(async () => (await inNotification.get()).exists, { timeout: 15_000, interval: 300 })
      .toBe(true);

    const inSnap = await inNotification.get();
    expect(inSnap.data()?.type).toBe('announcement');
    expect(inSnap.data()?.title).toBe('Test announcement');
    expect(inSnap.data()?.body).toBe('Body text');
    expect(inSnap.data()?.read).toBe(false);

    const outSnap = await usersRef
      .doc(UID_OUT)
      .collection(SUBCOLLECTIONS.notifications)
      .doc(ANNOUNCEMENT_NO_PUSH)
      .get();
    expect(outSnap.exists).toBe(false);
  }, 20_000);

  it('writes the same in-app notification whether announcement.push is true or false', async () => {
    await announcementsRef.doc(ANNOUNCEMENT_PUSH).create({
      eventId: EVENT_ID,
      title: 'Push test',
      body: 'Body',
      authorId: 'demo_000',
      push: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const inNotification = usersRef.doc(UID_IN).collection(SUBCOLLECTIONS.notifications).doc(ANNOUNCEMENT_PUSH);

    await expect
      .poll(async () => (await inNotification.get()).exists, { timeout: 15_000, interval: 300 })
      .toBe(true);

    const inSnap = await inNotification.get();
    expect(inSnap.data()?.type).toBe('announcement');
  }, 20_000);
});
