/**
 * Reviewer scoring, against a real Firestore emulator: the reviewer's reads and
 * writes in `@kgc/scripts/src/lib/reviews.ts`, and the dashboard's side of the
 * same round — criteria, exclusions, the waiting list and bulk decisions.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 *
 * `reviews.ts` is the only boundary these collections have. There is no
 * `match` block under it (`CFA-PLAN.md` §2), so the three things a reviewer's
 * page must not leak — somebody else's assignment, a blinded author, and the
 * other reviewers' scores before their own — are properties of these functions
 * and of nothing else. `review-core.test.ts` pins the arithmetic; this pins that
 * the transaction really keeps the submission's numbers in step with it.
 *
 * Run with: npm run test:cfa
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type ReviewDoc,
  type ReviewerDoc,
  type SubmissionDoc,
} from '@kgc/shared';
import {
  loadAssignment,
  loadQueue,
  loadReviewer,
  markReviewerActive,
  saveReview,
  withdrawReviewer,
} from '@kgc/scripts/src/lib/reviews';
import { mintReviewerToken, readReviewerToken } from '@kgc/scripts/src/lib/reviewer-token';
import type { RawReview } from '@kgc/scripts/src/lib/review-core';
import { db } from '@/lib/firestore';
import { saveCall } from '@/lib/calls';
import {
  assignByTrack,
  assignReviewer,
  excludeReviewer,
  inviteReviewer,
  liftExclusion,
  listReviewers,
  reviewStoreOps,
  sendInvitation,
  setReviewerStatus,
} from '@/lib/reviewers';
import { applyDefaultRubric, deleteCriterion, saveCriterion } from '@/lib/rubric';
import { decideMany, decideSubmission, getSubmission } from '@/lib/submissions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:cfa',
    );
  }
});

const ACTOR = 'organizer@kgc.test';
const CALL_ID = 'kgc-2027-call-for-abstracts';
// Built by the organizer app's own copy of `firebase-admin` — see `reviewStoreOps`.
const ops = reviewStoreOps();

async function wipe() {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [COLLECTIONS.calls, COLLECTIONS.reviewers, COLLECTIONS.auditLog, COLLECTIONS.emailLog]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(wipe);

async function createCall(blindReview: 'open' | 'single-blind' | 'double-blind' = 'single-blind') {
  const result = await saveCall({
    title: 'KGC 2027 Call for Abstracts',
    instructions: 'Tell us what the work is and why it matters.',
    status: 'published',
    opensAtLocal: '2027-01-01T09:00',
    closesAtLocal: '2027-03-31T23:59',
    sessionTypes: ['talk'],
    trackIds: ['graph-ml'],
    blindReview,
    reviewsPerSubmission: 2,
    reminderDaysBefore: [],
    notifyEmails: [],
    actor: ACTOR,
  });
  if (!result.ok) throw new Error(result.error);
  const rubric = await applyDefaultRubric({ callId: CALL_ID, actor: ACTOR });
  if (!rubric.ok) throw new Error(rubric.error);
}

async function seedSubmission(id: string, title = 'Provenance in enterprise knowledge graphs') {
  const ref = db().collection(COLLECTIONS.submissions).doc(id);
  await ref.set({
    eventId: EVENT_ID,
    callId: CALL_ID,
    title,
    abstract: 'Three years of running a provenance layer.',
    trackId: 'graph-ml',
    sessionType: 'talk',
    answers: {},
    formVersion: 1,
    status: 'submitted',
    submitterTokenHash: 'not-checked-here',
    submittedAt: new Date(),
    reviewsAssigned: 0,
    reviewsSubmitted: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await ref.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).set({
    eventId: EVENT_ID,
    submissionId: id,
    callId: CALL_ID,
    name: 'Ada Okonkwo',
    email: 'ada@acme.test',
    affiliation: 'Acme Graphs',
    coAuthors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function reviewer(name: string, email: string): Promise<string> {
  const result = await inviteReviewer({ name, email, trackIds: ['graph-ml'], maxAssignments: 5, actor: ACTOR });
  if (!result.ok) throw new Error(result.error);
  return (await listReviewers()).find((r) => r.email === email)!.id;
}

const scores = (relevance: string, originality: string, clarity: string, over: Partial<RawReview> = {}): RawReview => ({
  scores: { relevance, originality, clarity },
  comments: {},
  confidence: '',
  commentsToCommittee: '',
  commentsToAuthors: '',
  ...over,
});

const sub = async (id: string) =>
  (await db().collection(COLLECTIONS.submissions).doc(id).get()).data() as SubmissionDoc;
const review = async (id: string, reviewerId: string) =>
  (
    await db().collection(COLLECTIONS.submissions).doc(id).collection(SUBCOLLECTIONS.reviews).doc(reviewerId).get()
  ).data() as ReviewDoc | undefined;

describe('the scoring criteria', () => {
  it('starts a call from the default three and refuses to overwrite them', async () => {
    await createCall();
    const again = await applyDefaultRubric({ callId: CALL_ID, actor: ACTOR });
    expect(again.ok).toBe(false);
  });

  it('keeps the id when a criterion is renamed, so its scores are not orphaned', async () => {
    await createCall();
    const result = await saveCriterion({ callId: CALL_ID, id: 'relevance', label: 'Fit for KGC', min: 1, max: 5, actor: ACTOR });
    expect(result.ok).toBe(true);
    const call = (await db().collection(COLLECTIONS.calls).doc(CALL_ID).get()).data()!;
    expect(call.rubric.map((c: { id: string }) => c.id)).toEqual(['relevance', 'originality', 'clarity']);
    expect(call.rubric[0].label).toBe('Fit for KGC');
  });

  it('fixes scales and refuses removal once a review has been scored', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('5', '5', '5'), finish: true });

    expect((await saveCriterion({ callId: CALL_ID, id: 'clarity', label: 'Clarity', min: 1, max: 10, actor: ACTOR })).ok).toBe(false);
    expect((await deleteCriterion({ callId: CALL_ID, id: 'clarity', actor: ACTOR })).ok).toBe(false);
    expect((await saveCriterion({ callId: CALL_ID, id: 'clarity', label: 'Clear writing', min: 1, max: 5, actor: ACTOR })).ok).toBe(true);
  });
});

describe('a reviewer scoring', () => {
  it('keeps the submission’s mean and counts in step with every review written', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    const r2 = await reviewer('Una Second', 'una@lab.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await assignReviewer({ submissionId: id, reviewerId: r2, by: 'manual', actor: ACTOR });

    // A draft is saved and counts for nothing.
    const draft = await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('5', '', ''), finish: false });
    expect(draft).toEqual({ ok: true, status: 'assigned' });
    expect(await sub(id)).toMatchObject({ reviewsAssigned: 2, reviewsSubmitted: 0 });
    expect((await sub(id)).scoreAverage).toBeUndefined();

    // 5,5,5 on 1–5 is 10; 3,3,3 is 5. Mean 7.5.
    await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('5', '5', '5', { comments: { clarity: 'Very clear.' } }), finish: true });
    await saveReview(db(), ops, { reviewerId: r2, submissionId: id, raw: scores('3', '3', '3'), finish: true });
    expect(await sub(id)).toMatchObject({ reviewsAssigned: 2, reviewsSubmitted: 2, scoreAverage: 7.5 });
    expect(await review(id, r1)).toMatchObject({ status: 'submitted', overall: 10, criterionComments: { clarity: 'Very clear.' } });

    // Editing a submitted review moves the mean and cannot un-submit it.
    const edit = await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('1', '1', '1'), finish: false });
    expect(edit).toEqual({ ok: true, status: 'submitted' });
    expect((await sub(id)).scoreAverage).toBe(2.5);
    // …and the remark that was emptied is gone, not kept (gotcha 9).
    expect((await review(id, r1))?.criterionComments).toEqual({});
  });

  it('refuses a submission the reviewer was not given, exactly as if it did not exist', async () => {
    await createCall();
    const mine = await seedSubmission('sub_a');
    const theirs = await seedSubmission('sub_b', 'Somebody else’s paper');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    await assignReviewer({ submissionId: mine, reviewerId: r1, by: 'manual', actor: ACTOR });

    expect(await loadAssignment(db(), r1, theirs)).toBeNull();
    expect(await loadAssignment(db(), r1, 'sub_nope')).toBeNull();
    expect(await loadAssignment(db(), r1, `${mine}/identity/author`)).toBeNull();

    const write = await saveReview(db(), ops, { reviewerId: r1, submissionId: theirs, raw: scores('5', '5', '5'), finish: true });
    expect(write.ok).toBe(false);
    expect(await review(theirs, r1)).toBeUndefined();
    expect((await loadQueue(db(), r1)).map((i) => i.submissionId)).toEqual([mine]);
  });

  it('shows the author under single-blind and never reads them under double-blind', async () => {
    await createCall('single-blind');
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });

    const seen = await loadAssignment(db(), r1, id);
    expect(seen?.author).toEqual({ name: 'Ada Okonkwo', affiliation: 'Acme Graphs', coAuthors: [] });

    await db().collection(COLLECTIONS.calls).doc(CALL_ID).update({ blindReview: 'double-blind' });
    const blind = await loadAssignment(db(), r1, id);
    expect(blind?.author).toBeUndefined();
    // Not merely absent from one field: the address appears nowhere in the payload.
    expect(JSON.stringify(blind)).not.toContain('Okonkwo');
    expect(JSON.stringify(blind)).not.toContain('acme');
  });

  it('holds back the other reviewers’ scores until the caller’s own are in', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    const r2 = await reviewer('Una Second', 'una@lab.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await assignReviewer({ submissionId: id, reviewerId: r2, by: 'manual', actor: ACTOR });
    await saveReview(db(), ops, { reviewerId: r2, submissionId: id, raw: scores('4', '4', '4', { commentsToCommittee: 'Solid.' }), finish: true });

    const before = await loadAssignment(db(), r1, id);
    expect(before?.others).toEqual([]);
    expect(before?.otherCount).toBe(1);
    expect(JSON.stringify(before)).not.toContain('Solid.');

    await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('2', '2', '2'), finish: true });
    const after = await loadAssignment(db(), r1, id);
    expect(after?.others).toHaveLength(1);
    expect(after?.others[0]).toMatchObject({ label: 'Reviewer 2', overall: 7.5, commentsToCommittee: 'Solid.' });
    // A label, never the colleague's name or id.
    expect(JSON.stringify(after?.others)).not.toContain(r2);
  });

  it('closes reviewing once the committee has decided', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await decideSubmission({ id, accept: false, waitlist: true, notify: false, actor: ACTOR });

    const write = await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('5', '5', '5'), finish: true });
    expect(write.ok).toBe(false);
  });
});

describe('conflicts of interest', () => {
  it('lets a reviewer step away: the scores stop counting and the abstract stops loading', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    const r2 = await reviewer('Una Second', 'una@lab.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await assignReviewer({ submissionId: id, reviewerId: r2, by: 'manual', actor: ACTOR });
    await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('5', '5', '5'), finish: true });
    await saveReview(db(), ops, { reviewerId: r2, submissionId: id, raw: scores('1', '1', '1'), finish: true });
    expect((await sub(id)).scoreAverage).toBe(5);

    const result = await withdrawReviewer(db(), ops, { reviewerId: r1, submissionId: id, note: 'Same lab.' });
    expect(result).toEqual({ ok: true, already: false });

    expect(await sub(id)).toMatchObject({ reviewsAssigned: 1, reviewsSubmitted: 1, scoreAverage: 0 });
    expect(await review(id, r1)).toMatchObject({ status: 'declined', conflict: true, conflictNote: 'Same lab.' });
    const load = (await listReviewers()).find((r) => r.id === r1)!;
    expect(load.assignedCount).toBe(0);

    const seen = await loadAssignment(db(), r1, id);
    expect(seen?.abstract).toBe('');
    expect(seen?.author).toBeUndefined();
    expect(seen?.others).toEqual([]);

    // Pressing it twice changes nothing, in particular not the load.
    expect(await withdrawReviewer(db(), ops, { reviewerId: r1, submissionId: id })).toEqual({ ok: true, already: true });
    expect((await listReviewers()).find((r) => r.id === r1)!.assignedCount).toBe(0);
  });

  it('removes the mean entirely when the only counted review is conflicted out', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await saveReview(db(), ops, { reviewerId: r1, submissionId: id, raw: scores('5', '5', '5'), finish: true });
    await withdrawReviewer(db(), ops, { reviewerId: r1, submissionId: id });
    expect('scoreAverage' in (await sub(id))).toBe(false);
  });

  it('lets an organizer exclude before assignment, and the matcher then skips that pair', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    const r2 = await reviewer('Una Second', 'una@lab.test');

    const excluded = await excludeReviewer({ submissionId: id, reviewerId: r1, note: 'Supervisor.', actor: ACTOR });
    expect(excluded.ok).toBe(true);
    expect(await review(id, r1)).toMatchObject({ status: 'declined', conflict: true, excludedBy: ACTOR });

    const matched = await assignByTrack({ callId: CALL_ID, reviewsPerSubmission: 2, actor: ACTOR });
    expect(matched.ok && matched.outcome.assigned).toBe(1);
    expect((await review(id, r2))?.status).toBe('assigned');
    expect((await review(id, r1))?.status).toBe('declined');
    expect((await sub(id)).reviewsAssigned).toBe(1);

    // By hand is refused too, and says why.
    const forced = await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    expect(forced.ok).toBe(false);

    // The reviewer is not shown a submission they were kept away from.
    expect(await loadQueue(db(), r1)).toEqual([]);
    expect(await loadAssignment(db(), r1, id)).toBeNull();

    // Lifting it makes the pair assignable again.
    expect((await liftExclusion({ submissionId: id, reviewerId: r1, actor: ACTOR })).ok).toBe(true);
    expect((await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR })).ok).toBe(true);
    expect((await sub(id)).reviewsAssigned).toBe(2);
  });

  it('will not lift a conflict the reviewer declared themselves', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    await assignReviewer({ submissionId: id, reviewerId: r1, by: 'manual', actor: ACTOR });
    await withdrawReviewer(db(), ops, { reviewerId: r1, submissionId: id });
    expect((await liftExclusion({ submissionId: id, reviewerId: r1, actor: ACTOR })).ok).toBe(false);
  });
});

describe('the reviewer’s link', () => {
  it('stops opening when the reviewer is removed, and accepts on first use', async () => {
    await createCall();
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    const payload = readReviewerToken(mintReviewerToken(r1))!;

    expect(await loadReviewer(db(), r1, payload.iat)).toEqual({ id: r1, name: 'Rex Review' });
    await markReviewerActive(db(), r1);
    expect(((await db().collection(COLLECTIONS.reviewers).doc(r1).get()).data() as ReviewerDoc).status).toBe('accepted');

    await setReviewerStatus({ id: r1, status: 'removed', actor: ACTOR });
    expect(await loadReviewer(db(), r1, payload.iat)).toBeNull();
    // Opening the link must not quietly put a removed reviewer back.
    await markReviewerActive(db(), r1);
    expect(((await db().collection(COLLECTIONS.reviewers).doc(r1).get()).data() as ReviewerDoc).status).toBe('removed');
  });

  it('logs the invitation through the shared email path', async () => {
    await createCall();
    const r1 = await reviewer('Rex Review', 'rex@uni.test');
    const result = await sendInvitation({ reviewerId: r1, callId: CALL_ID, actor: ACTOR });
    expect(result.ok).toBe(true);

    const log = await db().collection(COLLECTIONS.emailLog).get();
    expect(log.docs.map((d) => [d.data().template, d.data().to])).toEqual([['reviewer-invitation', 'rex@uni.test']]);
  });
});

describe('decisions', () => {
  it('records a waiting-list decision as its own status, with a decision map like the others', async () => {
    await createCall();
    const id = await seedSubmission('sub_a');
    const result = await decideSubmission({ id, accept: false, waitlist: true, notify: false, actor: ACTOR });
    expect(result.ok).toBe(true);
    const row = await getSubmission(id);
    expect(row?.status).toBe('waitlisted');
    expect(row?.decision).toMatchObject({ by: ACTOR, round: 1 });
  });

  it('decides many at once, names what it skipped, and mails only when asked', async () => {
    await createCall();
    const a = await seedSubmission('sub_a');
    const b = await seedSubmission('sub_b', 'Second paper');
    const draft = await seedSubmission('sub_c', 'Unfinished');
    await db().collection(COLLECTIONS.submissions).doc(draft).update({ status: 'draft' });

    const result = await decideMany({ ids: [a, b, draft, a], accept: true, notify: false, actor: ACTOR });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain('2 submissions recorded as accepted');
      expect(result.message).toContain('1 left unchanged');
    }
    expect((await sub(a)).status).toBe('accepted');
    expect((await sub(b)).status).toBe('accepted');
    expect((await sub(draft)).status).toBe('draft');
    expect((await db().collection(COLLECTIONS.emailLog).get()).size).toBe(0);

    await decideMany({ ids: [a, b], accept: false, waitlist: true, notify: true, actor: ACTOR });
    expect((await sub(a)).status).toBe('waitlisted');
    expect((await sub(a)).decision?.round).toBe(2);
    expect((await db().collection(COLLECTIONS.emailLog).get()).size).toBe(2);
  });

  it('refuses an empty selection', async () => {
    expect((await decideMany({ ids: [], accept: true, notify: false, actor: ACTOR })).ok).toBe(false);
  });
});
