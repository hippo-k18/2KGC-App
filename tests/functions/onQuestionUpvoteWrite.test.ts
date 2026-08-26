/**
 * Integration test for `onQuestionUpvoteWrite` (functions/SPEC.md #3), run
 * against the real Firestore + Functions emulators. See onReplyWrite.test.ts
 * for why this is an integration test rather than a unit test calling the
 * trigger directly.
 *
 * No upvotes are seeded (see seed-demo.ts) — only questions, at
 * `upvoteCount: 0` — so this test writes its own fixture under a seeded
 * question. The question's id (`seed-q-0-0`) is fixed by seed-demo.ts, but
 * its parent session id is a content hash the seed derives internally, so
 * this locates the question by a collection-group scan rather than
 * recomputing that hash. Run with: npm run test:functions
 */
import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator, waitUntilStable } from './lib/emulator.js';

const QUESTION_ID = 'seed-q-0-0';
const UID = 'demo_000';

let db: Firestore;
let questionRef: DocumentReference;

async function upvoteCount(): Promise<number> {
  const snap = await questionRef.get();
  return snap.data()?.upvoteCount;
}

beforeAll(async () => {
  db = connectToEmulator();

  const snap = await db.collectionGroup(SUBCOLLECTIONS.questions).get();
  const doc = snap.docs.find((d) => d.id === QUESTION_ID);
  if (!doc) {
    throw new Error(`${QUESTION_ID} not found — run npm run seed against the emulator first.`);
  }
  questionRef = doc.ref;

  await waitUntilStable(upvoteCount);
}, 20_000);

afterAll(async () => {
  await questionRef.collection(SUBCOLLECTIONS.upvotes).doc(UID).delete();
});

describe('onQuestionUpvoteWrite', () => {
  it('increments upvoteCount when an upvote is created', async () => {
    const before = await upvoteCount();

    await questionRef
      .collection(SUBCOLLECTIONS.upvotes)
      .doc(UID)
      .create({ uid: UID, createdAt: new Date() });

    await expect.poll(() => upvoteCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);
  }, 20_000);

  it('decrements upvoteCount when the upvote is deleted', async () => {
    const before = await upvoteCount();

    await questionRef.collection(SUBCOLLECTIONS.upvotes).doc(UID).delete();

    await expect.poll(() => upvoteCount(), { timeout: 15_000, interval: 300 }).toBe(before - 1);
  }, 20_000);
});
