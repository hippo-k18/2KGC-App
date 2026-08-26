/**
 * Integration test for `onReplyWrite` (functions/SPEC.md #1), run against the
 * real Firestore + Functions emulators — not a rules test, and not a unit
 * test with the trigger called directly. The point is to prove the deployed
 * shape works: a client-shaped write into `replies/` moves
 * `communityPosts/{postId}.replyCount` on its own, asynchronously, the way it
 * will in production.
 *
 * Requires both emulators running under the same project id the function is
 * loaded into (`kgc-database`, from `.firebaserc`) and seeded data already
 * present. Run with: npm run test:functions
 */
import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator, waitUntilStable } from './lib/emulator.js';

const POST_ID = 'seed-post-0';
const REPLY_ID = 'test-on-reply-write';

let db: Firestore;

async function replyCount(): Promise<number> {
  const snap = await db.collection(COLLECTIONS.communityPosts).doc(POST_ID).get();
  return snap.data()?.replyCount;
}

beforeAll(async () => {
  db = connectToEmulator();

  const post = await db.collection(COLLECTIONS.communityPosts).doc(POST_ID).get();
  if (!post.exists) {
    throw new Error(`${POST_ID} not found — run npm run seed against the emulator first.`);
  }
  // Every seeded reply fires this same trigger; wait for that burst to drain
  // before establishing a baseline.
  await waitUntilStable(replyCount);
}, 20_000);

afterAll(async () => {
  await db
    .collection(COLLECTIONS.communityPosts)
    .doc(POST_ID)
    .collection(SUBCOLLECTIONS.replies)
    .doc(REPLY_ID)
    .delete();
});

describe('onReplyWrite', () => {
  it('increments replyCount when a reply is created', async () => {
    const before = await replyCount();

    await db
      .collection(COLLECTIONS.communityPosts)
      .doc(POST_ID)
      .collection(SUBCOLLECTIONS.replies)
      .doc(REPLY_ID)
      .create({
        authorId: 'demo_000',
        body: 'onReplyWrite integration test reply',
        status: 'visible',
        createdAt: new Date(),
      });

    await expect.poll(() => replyCount(), { timeout: 15_000, interval: 300 }).toBe(before + 1);
  }, 20_000);

  it('does not move replyCount when only status changes (moderation)', async () => {
    const before = await replyCount();

    await db
      .collection(COLLECTIONS.communityPosts)
      .doc(POST_ID)
      .collection(SUBCOLLECTIONS.replies)
      .doc(REPLY_ID)
      .update({ status: 'hidden' });

    // No poll toward a new value here on purpose — we are asserting the
    // count stays put, so give the (would-be) trigger time to fire and then
    // check it did nothing.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await replyCount()).toBe(before);
  }, 20_000);

  it('decrements replyCount when the reply is deleted', async () => {
    const before = await replyCount();

    await db
      .collection(COLLECTIONS.communityPosts)
      .doc(POST_ID)
      .collection(SUBCOLLECTIONS.replies)
      .doc(REPLY_ID)
      .delete();

    await expect.poll(() => replyCount(), { timeout: 15_000, interval: 300 }).toBe(before - 1);
  }, 20_000);
});
