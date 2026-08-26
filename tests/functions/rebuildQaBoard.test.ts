/**
 * Integration test for `onQuestionWrite` + `rebuildQaBoard`
 * (functions/SPEC.md #5), run against the real Firestore + Functions (and
 * Cloud Tasks) emulators. See onReplyWrite.test.ts for why this is an
 * integration test rather than a unit test calling either function
 * directly, and tallyPoll.test.ts for why it waits out a real 5s debounce.
 *
 * Locates a seeded keynote by the same collection-group scan
 * onQuestionUpvoteWrite.test.ts uses, rather than recomputing the session id
 * hash. That session already has seeded 'approved'/'answered' questions
 * (see seed-demo.ts); this test's own fixtures use very high `upvoteCount`
 * values so they sort ahead of the seeded ones regardless, and assertions
 * only check for presence/order/absence of the ids this test controls, never
 * the board's full contents. Run with: npm run test:functions
 */
import { EVENT_ID, QA_BOARD_DOC, SUBCOLLECTIONS } from '@kgc/shared';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectToEmulator } from './lib/emulator.js';

const QUESTION_ID = 'seed-q-0-0';

const HI = 'test-qa-approved-hi';
const LO = 'test-qa-approved-lo';
const PENDING = 'test-qa-pending';
const HIDDEN = 'test-qa-hidden';
const FIXTURE_IDS = [HI, LO, PENDING, HIDDEN];

let db: Firestore;
let questionsRef: DocumentReference;
let boardRef: DocumentReference;

async function boardQuestionIds(): Promise<string[]> {
  const snap = await boardRef.get();
  const questions = (snap.data()?.questions ?? []) as { id: string }[];
  return questions.map((q) => q.id);
}

beforeAll(async () => {
  db = connectToEmulator();

  const snap = await db.collectionGroup(SUBCOLLECTIONS.questions).get();
  const doc = snap.docs.find((d) => d.id === QUESTION_ID);
  if (!doc) {
    throw new Error(`${QUESTION_ID} not found — run npm run seed against the emulator first.`);
  }
  const sessionRef = doc.ref.parent.parent;
  if (!sessionRef) throw new Error(`${QUESTION_ID} has no parent session.`);

  questionsRef = sessionRef.collection(SUBCOLLECTIONS.questions);
  boardRef = sessionRef.collection(SUBCOLLECTIONS.qaBoard).doc(QA_BOARD_DOC);

  // Defensive cleanup: a crashed prior run could have left these fixtures
  // behind, and `create()` below fails if they already exist.
  await Promise.all(FIXTURE_IDS.map((id) => questionsRef.doc(id).delete()));

  // The local Cloud Tasks emulator does not honor `scheduleDelaySeconds` —
  // it dispatches within about a second instead of genuinely waiting out the
  // debounce window like production Cloud Tasks does (see the longer note in
  // tallyPoll.test.ts). That matters here because `npm run seed` writes
  // several questions into this same session moments before this file runs,
  // which can land its own bucket's task, fire it fast, and leave that exact
  // bucket "recently executed" — meaning `functions/task-already-exists` for
  // this test's fixtures if they land in the same wall-clock bucket, with no
  // pending task left to ever pick them up. Waiting out a full bucket first
  // guarantees a fresh one.
  await new Promise((r) => setTimeout(r, 5_500));
}, 30_000);

afterAll(async () => {
  await Promise.all(FIXTURE_IDS.map((id) => questionsRef.doc(id).delete()));
});

describe('onQuestionWrite + rebuildQaBoard', () => {
  it('boards only approved questions, sorted by upvoteCount desc, and drops pending/hidden ones', async () => {
    const base = (upvoteCount: number, state: string) => ({
      eventId: EVENT_ID,
      authorId: 'demo_000',
      body: 'rebuildQaBoard integration test question',
      state,
      answered: false,
      upvoteCount,
      createdAt: new Date(),
    });

    await Promise.all([
      questionsRef.doc(HI).create(base(9_999, 'approved')),
      questionsRef.doc(LO).create(base(9_998, 'approved')),
      questionsRef.doc(PENDING).create(base(9_997, 'pending')),
      questionsRef.doc(HIDDEN).create(base(9_996, 'hidden')),
    ]);

    await expect
      .poll(async () => (await boardQuestionIds()).includes(HI), { timeout: 20_000, interval: 500 })
      .toBe(true);

    const ids = await boardQuestionIds();
    expect(ids).toContain(HI);
    expect(ids).toContain(LO);
    expect(ids).not.toContain(PENDING);
    expect(ids).not.toContain(HIDDEN);
    expect(ids.indexOf(HI)).toBeLessThan(ids.indexOf(LO));
  }, 30_000);
});
