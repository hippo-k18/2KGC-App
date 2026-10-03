import type { Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type BlindReviewMode,
  type CallDoc,
  type ReviewDoc,
  type ReviewStatus,
  type ReviewerDoc,
  type RubricCriterionDef,
  type SessionFormat,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
} from '@kgc/shared';
import {
  authorVisibleToReviewer,
  checkReview,
  orderedRubric,
  otherReviewsVisible,
  reviewRefusal,
  tallyReviews,
  type RawReview,
} from './review-core.js';

/**
 * A reviewer's reads and writes, and the one write the dashboard shares with
 * them.
 *
 * ── Why this is in `@kgc/scripts` ───────────────────────────────────────────
 *
 * The reviewer scores on the website and the organizer excludes a reviewer on
 * the dashboard, and both end in the same transaction: a review leaves the
 * tally, and the submission's three numbers are recounted. Two copies of that
 * would be two ways to count, discovered when the ranking and the reviewer's
 * page disagree. It takes the store as a parameter, as `email.ts` and
 * `comp-passes.ts` do, because the two apps cannot import each other.
 *
 * ⚠️ **Never construct a Firestore sentinel in this file** (AGENTS.md gotcha 8).
 * Dates are native `Date`s. The one place a field has to be removed —
 * `scoreAverage`, when the last counted review goes — takes the caller's own
 * `FieldValue.delete()` as `deleteField`, built in the app that owns the store.
 *
 * ── This module is the boundary ─────────────────────────────────────────────
 *
 * The CFA collections have no `match` block in `firestore.rules`, so nothing
 * underneath catches what these functions let through (`reviewer-token.ts`).
 * Three rules are enforced here and nowhere else: a reviewer reaches only
 * submissions they hold a review document for; under double-blind the identity
 * document is never read; and other reviewers' scores are not returned until
 * the caller's own review is submitted.
 */

const ms = (t: unknown): number | undefined => {
  if (t instanceof Date) return t.getTime();
  try {
    return (t as { toMillis(): number }).toMillis();
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface ReviewerIdentity {
  id: string;
  name: string;
}

export interface QueueItem {
  submissionId: string;
  callId: string;
  callTitle: string;
  title: string;
  trackId?: string;
  reviewStatus: ReviewStatus;
  conflict: boolean;
  /** Scores have been saved but the review is not submitted. */
  started: boolean;
  overall?: number;
  /** Null when a review can still be written; otherwise why not. */
  closed: string | null;
}

/**
 * The reviewer behind a verified token, or null.
 *
 * `removed` and `declined` reviewers get nothing: taking somebody off the
 * committee has to end their access to unpublished work, and this is the check
 * that does it, since the token itself cannot be recalled. `tokensValidFrom`
 * kills links minted before a date, which is how one link is revoked without
 * rotating the secret for the whole committee.
 */
export async function loadReviewer(
  store: Firestore,
  reviewerId: string,
  issuedAtMs: number,
): Promise<ReviewerIdentity | null> {
  const snap = await store.collection(COLLECTIONS.reviewers).doc(reviewerId).get();
  if (!snap.exists) return null;
  const r = snap.data() as ReviewerDoc & { tokensValidFrom?: unknown };
  if (r.eventId !== EVENT_ID) return null;
  if (r.status === 'removed' || r.status === 'declined') return null;
  const validFrom = ms(r.tokensValidFrom);
  if (validFrom !== undefined && issuedAtMs < validFrom) return null;
  return { id: snap.id, name: r.name ?? '' };
}

/**
 * Everything assigned to one reviewer, oldest assignment first.
 *
 * A collection-group query over `reviews`, served by the
 * `(eventId, reviewerId, status, assignedAt)` index that has been in
 * `firestore.indexes.json` since the model was written. ⚠️ The `status` filter
 * is there because the index has that field, not because anything is being
 * filtered out: without it the query needs a different index, passes in the
 * emulator and fails live.
 */
export async function loadQueue(store: Firestore, reviewerId: string): Promise<QueueItem[]> {
  const statuses: ReviewStatus[] = ['assigned', 'submitted', 'declined'];
  const snap = await store
    .collectionGroup(SUBCOLLECTIONS.reviews)
    .where('eventId', '==', EVENT_ID)
    .where('reviewerId', '==', reviewerId)
    .where('status', 'in', statuses)
    .orderBy('assignedAt', 'asc')
    .get();

  const reviews = snap.docs.map((d) => d.data() as ReviewDoc);
  if (reviews.length === 0) return [];

  const subRefs = reviews.map((r) => store.collection(COLLECTIONS.submissions).doc(r.submissionId));
  const callIds = [...new Set(reviews.map((r) => r.callId))];
  const [subSnaps, callSnaps] = await Promise.all([
    store.getAll(...subRefs),
    store.getAll(...callIds.map((id) => store.collection(COLLECTIONS.calls).doc(id))),
  ]);

  const callTitle = new Map(callSnaps.map((c) => [c.id, (c.data() as CallDoc | undefined)?.title ?? '']));

  const items: QueueItem[] = [];
  reviews.forEach((r, i) => {
    const sub = subSnaps[i].data() as SubmissionDoc | undefined;
    if (!sub) return;
    // An organizer's exclusion is not shown to the reviewer at all: the title of
    // a submission they were kept away from is not theirs to read.
    if (r.excludedBy) return;
    items.push({
      submissionId: r.submissionId,
      callId: r.callId,
      callTitle: callTitle.get(r.callId) ?? '',
      title: sub.title ?? '',
      trackId: sub.trackId,
      reviewStatus: r.status,
      conflict: r.conflict === true,
      started: r.status === 'assigned' && Object.keys(r.scores ?? {}).length > 0,
      overall: r.overall,
      closed: reviewRefusal(sub.status, { status: r.status, conflict: r.conflict === true }),
    });
  });
  return items;
}

// ---------------------------------------------------------------------------
// One assignment
// ---------------------------------------------------------------------------

export interface OtherReview {
  /** "Reviewer 2". Never a name: the committee is blind to itself here. */
  label: string;
  overall?: number;
  scores: Record<string, number>;
  commentsToCommittee?: string;
}

export interface Assignment {
  submissionId: string;
  callId: string;
  callTitle: string;
  blindReview: BlindReviewMode;
  rubric: RubricCriterionDef[];
  title: string;
  abstract: string;
  trackId?: string;
  sessionType?: SessionFormat;
  /** Questions and answers, already paired. Description blocks are left out. */
  answers: { prompt: string; value: string | string[] | boolean | undefined }[];
  /** Absent under double-blind, because the document was never read. */
  author?: { name: string; affiliation?: string; coAuthors: string[] };
  own: {
    status: ReviewStatus;
    conflict: boolean;
    scores: Record<string, number>;
    criterionComments: Record<string, string>;
    confidence?: number;
    commentsToCommittee?: string;
    commentsToAuthors?: string;
    overall?: number;
    submittedAtMs?: number;
  };
  closed: string | null;
  /** Empty until the caller's own review is submitted. */
  others: OtherReview[];
  /** How many other reviewers hold this, shown even while their scores are not. */
  otherCount: number;
}

/**
 * One submission as one reviewer may see it, or null if they do not hold it.
 *
 * The review document is read first and everything else depends on it. A
 * submission id is in the URL, so anybody with a valid token can type another
 * one; the answer is the same 404 whether that submission exists or not.
 */
export async function loadAssignment(
  store: Firestore,
  reviewerId: string,
  submissionId: string,
): Promise<Assignment | null> {
  // An id with a slash in it is a path, and `.doc()` would follow it.
  if (!submissionId || submissionId.includes('/')) return null;

  const subRef = store.collection(COLLECTIONS.submissions).doc(submissionId);
  const ownSnap = await subRef.collection(SUBCOLLECTIONS.reviews).doc(reviewerId).get();
  if (!ownSnap.exists) return null;
  const own = ownSnap.data() as ReviewDoc;
  // An organizer's exclusion answers like a submission that was never theirs,
  // which is also how `loadQueue` treats it.
  if (own.excludedBy) return null;

  const subSnap = await subRef.get();
  if (!subSnap.exists) return null;
  const sub = subSnap.data() as SubmissionDoc;
  if (sub.eventId !== EVENT_ID) return null;

  const callSnap = await store.collection(COLLECTIONS.calls).doc(sub.callId).get();
  if (!callSnap.exists) return null;
  const call = callSnap.data() as CallDoc;
  const blindReview = call.blindReview ?? 'single-blind';

  const ownState = { status: own.status, conflict: own.conflict === true };
  const gone = ownState.status === 'declined' || ownState.conflict;

  let author: Assignment['author'];
  if (authorVisibleToReviewer(blindReview) && !gone) {
    const idSnap = await subRef.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).get();
    const identity = idSnap.data() as SubmissionIdentityDoc | undefined;
    if (identity) {
      author = {
        name: identity.name,
        affiliation: identity.affiliation,
        coAuthors: (identity.coAuthors ?? []).map((c) =>
          c.affiliation ? `${c.name} (${c.affiliation})` : c.name,
        ),
      };
    }
  }

  const others: OtherReview[] = [];
  let otherCount = 0;
  if (!gone) {
    const all = await subRef.collection(SUBCOLLECTIONS.reviews).get();
    const rest = all.docs
      .filter((d) => d.id !== reviewerId)
      .map((d) => d.data() as ReviewDoc)
      .filter((r) => r.status !== 'declined' && r.conflict !== true);
    otherCount = rest.length;
    if (otherReviewsVisible(ownState)) {
      rest
        .filter((r) => r.status === 'submitted')
        .forEach((r, i) =>
          others.push({
            label: `Reviewer ${i + 2}`,
            overall: r.overall,
            scores: r.scores ?? {},
            commentsToCommittee: r.commentsToCommittee,
          }),
        );
    }
  }

  // The form as it stands now. An answer to a question since withdrawn is the
  // organizer's to read, under its old wording, on the dashboard.
  const answers = (call.form ?? [])
    .filter((f) => f.kind !== 'description')
    .map((f) => ({ prompt: f.prompt, value: sub.answers?.[f.id] }));

  return {
    submissionId,
    callId: sub.callId,
    callTitle: call.title ?? '',
    blindReview,
    rubric: orderedRubric(call.rubric ?? []),
    title: gone ? '' : (sub.title ?? ''),
    abstract: gone ? '' : (sub.abstract ?? ''),
    trackId: sub.trackId,
    sessionType: sub.sessionType,
    answers: gone ? [] : answers,
    author,
    own: {
      ...ownState,
      scores: own.scores ?? {},
      criterionComments: own.criterionComments ?? {},
      confidence: own.confidence,
      commentsToCommittee: own.commentsToCommittee,
      commentsToAuthors: own.commentsToAuthors,
      overall: own.overall,
      submittedAtMs: own.submittedAt ? ms(own.submittedAt) : undefined,
    },
    closed: reviewRefusal(sub.status, ownState),
    others,
    otherCount,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type ReviewWrite =
  | { ok: true; status: ReviewStatus }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Built by the caller, in the app that owns the store. See the file header. */
export interface StoreOps {
  deleteField: unknown;
}

/**
 * Recount a submission's three numbers inside a transaction, given the reviews
 * as they will stand after it commits.
 */
function tallyUpdate(reviews: ReviewDoc[], ops: StoreOps, now: Date): Record<string, unknown> {
  const tally = tallyReviews(
    reviews.map((r) => ({ status: r.status, conflict: r.conflict === true, overall: r.overall })),
  );
  return {
    reviewsAssigned: tally.reviewsAssigned,
    reviewsSubmitted: tally.reviewsSubmitted,
    scoreAverage: tally.scoreAverage ?? ops.deleteField,
    updatedAt: now,
  };
}

/**
 * Save one reviewer's scores, as a draft or as the finished review.
 *
 * One transaction over the review and the submission, so the mean the ranking
 * sorts on cannot be seen without the review that moved it. The criteria are
 * read from the call inside the same transaction and never taken from the
 * request: a posted rubric would let a reviewer score against a scale of their
 * own choosing.
 */
export async function saveReview(
  store: Firestore,
  ops: StoreOps,
  input: { reviewerId: string; submissionId: string; raw: RawReview; finish: boolean },
): Promise<ReviewWrite> {
  if (!input.submissionId || input.submissionId.includes('/')) {
    return { ok: false, error: 'That submission is not on your list.' };
  }

  const subRef = store.collection(COLLECTIONS.submissions).doc(input.submissionId);
  const reviewsRef = subRef.collection(SUBCOLLECTIONS.reviews);

  return store.runTransaction(async (tx): Promise<ReviewWrite> => {
    const [subSnap, reviewsSnap] = await Promise.all([tx.get(subRef), tx.get(reviewsRef)]);
    const ownSnap = reviewsSnap.docs.find((d) => d.id === input.reviewerId);
    if (!subSnap.exists || !ownSnap) return { ok: false, error: 'That submission is not on your list.' };

    const sub = subSnap.data() as SubmissionDoc;
    const own = ownSnap.data() as ReviewDoc;

    const refusal = reviewRefusal(sub.status, { status: own.status, conflict: own.conflict === true });
    if (refusal) return { ok: false, error: refusal };

    const callSnap = await tx.get(store.collection(COLLECTIONS.calls).doc(sub.callId));
    const rubric = orderedRubric((callSnap.data() as CallDoc | undefined)?.rubric ?? []);
    if (rubric.length === 0) {
      return { ok: false, error: 'The organizers have not set the scoring criteria yet.' };
    }

    // A submitted review stays submitted: editing it must never drop it out of
    // the mean while the reviewer is half way through a change.
    const finish = input.finish || own.status === 'submitted';
    const checked = checkReview(rubric, input.raw, finish);
    if (!checked.ok) return checked;

    const now = new Date();
    const next: ReviewDoc = {
      ...own,
      status: finish ? 'submitted' : 'assigned',
      scores: checked.review.scores,
      criterionComments: checked.review.criterionComments,
      updatedAt: now as unknown as ReviewDoc['updatedAt'],
    };

    /*
     * Every key is named on every write (gotcha 9): an emptied comment has to
     * be removed, not skipped, or the old remark survives a "Saved".
     */
    tx.update(ownSnap.ref, {
      status: next.status,
      scores: checked.review.scores,
      criterionComments: checked.review.criterionComments,
      overall: finish && checked.review.overall !== undefined ? checked.review.overall : ops.deleteField,
      confidence: checked.review.confidence ?? ops.deleteField,
      commentsToCommittee: checked.review.commentsToCommittee || ops.deleteField,
      commentsToAuthors: checked.review.commentsToAuthors || ops.deleteField,
      // Stamped the first time only, for the reason `SubmissionDoc.submittedAt` gives.
      ...(finish && !own.submittedAt ? { submittedAt: now } : {}),
      updatedAt: now,
    });
    next.overall = finish ? checked.review.overall : undefined;

    const after = reviewsSnap.docs.map((d) => (d.id === input.reviewerId ? next : (d.data() as ReviewDoc)));
    tx.update(subRef, tallyUpdate(after, ops, now));

    return { ok: true, status: next.status };
  });
}

/**
 * Take one reviewer off one submission: a conflict they declared, or an
 * exclusion an organizer made.
 *
 * The review document stays, `declined` with `conflict: true`, and that is the
 * mechanism. Assignment is a `create` on that path, so the matcher cannot hand
 * the pair back; the tally skips it, so scores entered before the conflict stop
 * counting; and `loadAssignment` stops returning the abstract. With no document
 * yet — an organizer excluding somebody before anything is assigned — one is
 * created in that state, which blocks the assignment before it happens.
 *
 * Returns `already` rather than an error when it was done before, so pressing
 * twice is harmless.
 */
export async function withdrawReviewer(
  store: Firestore,
  ops: StoreOps,
  input: {
    reviewerId: string;
    submissionId: string;
    note?: string;
    /** The organizer's address. Absent when the reviewer declared it themselves. */
    excludedBy?: string;
  },
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  if (!input.submissionId || input.submissionId.includes('/')) {
    return { ok: false, error: 'That submission does not exist.' };
  }

  const subRef = store.collection(COLLECTIONS.submissions).doc(input.submissionId);
  const reviewsRef = subRef.collection(SUBCOLLECTIONS.reviews);
  const reviewerRef = store.collection(COLLECTIONS.reviewers).doc(input.reviewerId);
  const note = input.note?.trim().slice(0, 500);

  return store.runTransaction(async (tx) => {
    const [subSnap, reviewsSnap, reviewerSnap] = await Promise.all([
      tx.get(subRef),
      tx.get(reviewsRef),
      tx.get(reviewerRef),
    ]);
    if (!subSnap.exists) return { ok: false as const, error: 'That submission does not exist.' };
    if (!reviewerSnap.exists) return { ok: false as const, error: 'That reviewer does not exist.' };

    const sub = subSnap.data() as SubmissionDoc;
    const ownSnap = reviewsSnap.docs.find((d) => d.id === input.reviewerId);
    const own = ownSnap?.data() as ReviewDoc | undefined;

    // A reviewer can only step away from something they were given.
    if (!own && !input.excludedBy) return { ok: false as const, error: 'That submission is not on your list.' };
    if (own && (own.status === 'declined' || own.conflict === true)) return { ok: true as const, already: true };

    const now = new Date();
    const stamp = now as unknown as ReviewDoc['updatedAt'];
    const next: ReviewDoc = {
      ...(own ?? {
        eventId: EVENT_ID,
        submissionId: input.submissionId,
        callId: sub.callId,
        reviewerId: input.reviewerId,
        assignedAt: stamp,
      }),
      status: 'declined',
      conflict: true,
      updatedAt: stamp,
    };

    const fields = {
      status: next.status,
      conflict: true,
      conflictNote: note || ops.deleteField,
      ...(input.excludedBy ? { excludedBy: input.excludedBy } : {}),
      updatedAt: now,
    };
    if (ownSnap) tx.update(ownSnap.ref, fields);
    else tx.set(reviewsRef.doc(input.reviewerId), { ...next, ...fields });

    const after = [
      ...reviewsSnap.docs.filter((d) => d.id !== input.reviewerId).map((d) => d.data() as ReviewDoc),
      next,
    ];
    tx.update(subRef, tallyUpdate(after, ops, now));

    // Only an assignment that was actually held frees a place in their load.
    if (own) {
      const load = (reviewerSnap.data() as ReviewerDoc).assignedCount ?? 0;
      tx.update(reviewerRef, { assignedCount: Math.max(0, load - 1), updatedAt: now });
    }

    return { ok: true as const, already: false };
  });
}

/**
 * The first time a reviewer opens their link, an `invited` reviewer becomes
 * `accepted`. Turning up is the acceptance; there is no separate form for it.
 */
export async function markReviewerActive(store: Firestore, reviewerId: string): Promise<void> {
  const ref = store.collection(COLLECTIONS.reviewers).doc(reviewerId);
  await store.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || (snap.data() as ReviewerDoc).status !== 'invited') return;
    const now = new Date();
    tx.update(ref, { status: 'accepted', respondedAt: now, updatedAt: now });
  });
}
