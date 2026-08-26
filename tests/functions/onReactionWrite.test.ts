/**
 * Integration test for `onReactionWrite` (functions/SPEC.md #2), run against
 * the real Firestore + Functions emulators. See onReplyWrite.test.ts for why
 * this is an integration test rather than a unit test calling the trigger
 * directly.
 *
 * No reactions are seeded (see seed-demo.ts), so this test writes its own
 * fixture straight into the seeded `seed-post-0`. Run with: npm run test:functions
 */
import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator, waitUntilStable } from './lib/emulator.js';

const POST_ID = 'seed-post-0';
const UID = 'demo_000';

let db: Firestore;

async function reactionCount(): Promise<number> {
  const snap = await db.collection(COLLECTIONS.communityPosts).doc(POST_ID).get();
  return snap.data()?.reactionCount;
}

beforeAll(async () => {
  db = connectToEmulator();

  const post = await db.collection(COLLECTIONS.communityPosts).doc(POST_ID).get();
  if (!post.exists) {
    throw new Error(`${POST_ID} not found — run npm run seed against the emulator first.`);
  }
  // No reactions are seeded, but `seed-post-0` is shared with
  // onReplyWrite.test.ts's fixture — settle before reading a baseline.
  await waitUntilStable(reactionCount);
}, 20_000);

afterAll(async () => {
  await db
    .collection(COLLECTIONS.communityPosts)
    .doc(POST_ID)
    .collection(SUBCOLLECTIONS.reactions)
    .doc(UID)
    .delete();
});

describe('onReactionWrite', () => {
  it('increments reactionCount when a reaction is created', async () => {
    const before = await reactionCount();

    await db
      .collection(COLLECTIONS.communityPosts)
      .doc(POST_ID)
      .collection(SUBCOLLECTIONS.reactions)
      .doc(UID)
      .create({ uid: UID, emoji: '👍', createdAt: new Date() });

    await expect.poll(() => reactionCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);
  }, 20_000);

  it('does not move reactionCount when the same user changes their emoji', async () => {
    const before = await reactionCount();

    await db
      .collection(COLLECTIONS.communityPosts)
      .doc(POST_ID)
      .collection(SUBCOLLECTIONS.reactions)
      .doc(UID)
      .update({ emoji: '🎉' });

    // No poll toward a new value on purpose — asserting the count stays put,
    // so give the (would-be) trigger time to fire and then check it did
    // nothing.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await reactionCount()).toBe(before);
  }, 20_000);

  it('decrements reactionCount when the reaction is deleted', async () => {
    const before = await reactionCount();

    await db
      .collection(COLLECTIONS.communityPosts)
      .doc(POST_ID)
      .collection(SUBCOLLECTIONS.reactions)
      .doc(UID)
      .delete();

    await expect.poll(() => reactionCount(), { timeout: 15_000, interval: 300 }).toBe(before - 1);
  }, 20_000);
});
