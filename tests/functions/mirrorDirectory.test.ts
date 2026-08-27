/**
 * Integration test for `mirrorDirectory` (functions/SPEC.md #6), run
 * against the real Firestore + Functions emulators. See onReplyWrite.test.ts
 * for why this is an integration test rather than a unit test calling the
 * trigger directly.
 *
 * Mutates a seeded attendee's real `users/{uid}` document directly (Admin
 * SDK, bypassing rules — same as the console) rather than a throwaway
 * fixture, since the trigger's whole job is reacting to profile writes.
 * `demo_001` isn't referenced by any other test file, so this is safe under
 * `--no-file-parallelism`; the original document is restored in `afterAll`.
 * Run with: npm run test:functions
 */
import { COLLECTIONS } from '@kgc/shared';
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const UID = 'demo_001';

let db: Firestore;
let userRef: DocumentReference;
let directoryRef: DocumentReference;
let originalUserData: DocumentData;

async function directoryEntry(): Promise<DocumentData | null> {
  const snap = await directoryRef.get();
  return snap.exists ? (snap.data() ?? null) : null;
}

beforeAll(async () => {
  db = connectToEmulator();
  userRef = db.collection(COLLECTIONS.users).doc(UID);
  directoryRef = db.collection(COLLECTIONS.directory).doc(UID);

  const snap = await userRef.get();
  if (!snap.exists) {
    throw new Error(`${UID} not found — run npm run seed against the emulator first.`);
  }
  originalUserData = snap.data() as DocumentData;
}, 20_000);

afterAll(async () => {
  await userRef.set(originalUserData);
});

describe('mirrorDirectory', () => {
  it('deletes the directory entry when an attendee opts out', async () => {
    await userRef.update({ visibleInDirectory: false });

    await expect
      .poll(async () => (await directoryEntry()) === null, { timeout: 15_000, interval: 300 })
      .toBe(true);
  }, 20_000);

  it('recreates the entry, truncates an oversized name, and drops a non-Storage photoURL', async () => {
    const longName = 'A'.repeat(200);

    await userRef.update({
      visibleInDirectory: true,
      name: longName,
      photoURL: 'https://evil.example/beacon.png',
    });

    await expect
      .poll(async () => (await directoryEntry()) !== null, { timeout: 15_000, interval: 300 })
      .toBe(true);

    const entry = await directoryEntry();
    expect(entry?.name).toBe(longName.slice(0, 120));
    expect(entry?.photoURL).toBeUndefined();
  }, 20_000);

  it('mirrors a genuine Firebase Storage photoURL', async () => {
    const storageUrl =
      'https://firebasestorage.googleapis.com/v0/b/kgc-conference-app-and-website.appspot.com/o/avatars%2Fdemo_001%2Favatar.jpg?alt=media';

    await userRef.update({ photoURL: storageUrl });

    await expect
      .poll(async () => (await directoryEntry())?.photoURL, { timeout: 15_000, interval: 300 })
      .toBe(storageUrl);
  }, 20_000);
});
