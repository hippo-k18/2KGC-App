/**
 * Integration test for `onPollVoteWrite` + `tallyPoll` (functions/SPEC.md
 * #4), run against the real Firestore + Functions (and Cloud Tasks)
 * emulators. See onReplyWrite.test.ts for why this is an integration test
 * rather than a unit test calling either function directly.
 *
 * `tallyPoll` runs on a 5s debounce, not immediately — every assertion here
 * waits for that, so this file is the slowest in the suite by design. Run
 * with: npm run test:functions
 */
import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const POLL_ID = 'seed-poll-0';
const VOTER_A = 'demo_010';
const VOTER_B = 'demo_011';

let db: Firestore;
let pollRef: DocumentReference;
let optionIds: string[];

interface PollState {
  tallies: Record<string, number>;
  totalVotes: number;
  talliesUpdatedAt?: unknown;
}

async function pollState(): Promise<PollState> {
  const snap = await pollRef.get();
  return snap.data() as PollState;
}

beforeAll(async () => {
  db = connectToEmulator();

  const snap = await db.collectionGroup(SUBCOLLECTIONS.polls).get();
  const doc = snap.docs.find((d) => d.id === POLL_ID);
  if (!doc) {
    throw new Error(`${POLL_ID} not found — run npm run seed against the emulator first.`);
  }
  pollRef = doc.ref;

  const options = (doc.data().options ?? []) as { id: string; label: string }[];
  optionIds = options.map((o) => o.id);
  if (optionIds.length < 2) {
    throw new Error(`${POLL_ID} needs at least two options for this test.`);
  }

  // Defensive cleanup: a crashed prior run could have left these fixture
  // ballots behind, and `create()` below fails if they already exist.
  await Promise.all(
    [VOTER_A, VOTER_B].map((uid) => pollRef.collection(SUBCOLLECTIONS.votes).doc(uid).delete()),
  );
}, 20_000);

afterAll(async () => {
  await Promise.all(
    [VOTER_A, VOTER_B].map((uid) => pollRef.collection(SUBCOLLECTIONS.votes).doc(uid).delete()),
  );
});

describe('onPollVoteWrite + tallyPoll', () => {
  it('tallies a single-option vote after the debounce window', async () => {
    await pollRef
      .collection(SUBCOLLECTIONS.votes)
      .doc(VOTER_A)
      .create({ uid: VOTER_A, optionIds: [optionIds[0]], createdAt: new Date() });

    await expect
      .poll(async () => (await pollState()).totalVotes, { timeout: 20_000, interval: 500 })
      .toBe(1);

    const state = await pollState();
    expect(state.tallies[optionIds[0]]).toBe(1);
    expect(state.talliesUpdatedAt).toBeTruthy();
  }, 30_000);

  it('counts a multi-select ballot as one voter spread across several options', async () => {
    await pollRef
      .collection(SUBCOLLECTIONS.votes)
      .doc(VOTER_B)
      .create({ uid: VOTER_B, optionIds: [optionIds[0], optionIds[1]], createdAt: new Date() });

    await expect
      .poll(async () => (await pollState()).totalVotes, { timeout: 20_000, interval: 500 })
      .toBe(2);

    const state = await pollState();
    expect(state.tallies[optionIds[0]]).toBe(2);
    expect(state.tallies[optionIds[1]]).toBe(1);
  }, 30_000);
});
