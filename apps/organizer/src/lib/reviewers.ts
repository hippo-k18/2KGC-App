import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  publicSiteOrigin,
  type CallDoc,
  type ReviewDoc,
  type ReviewerDoc,
  type ReviewerStatus,
  type SubmissionDoc,
} from '@kgc/shared';
import { mintReviewerToken } from '@kgc/scripts/src/lib/reviewer-token';
import { emailEnabled, sendReviewerInvitation } from '@kgc/scripts/src/lib/email';
import { withdrawReviewer } from '@kgc/scripts/src/lib/reviews';
import { normaliseEmail, reviewerId } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Reviewers, and what they have been given to read.
 *
 * ── A reviewer is not a user ────────────────────────────────────────────────
 *
 * `reviewers/{id}` is its own collection and deliberately not `users`
 * (`CFA-PLAN.md` §2). A reviewer need not hold a ticket, and most external
 * academics on a programme committee never buy one — so making them a user would
 * mean either minting the `registered` claim for somebody who is not registered,
 * which destroys the claim's only meaning, or a second kind of user document
 * that half the app's queries would then have to know about.
 *
 * They reach their queue through a capability link, the same scheme the
 * submitter uses (`reviewer-token.ts`). If reviewers ever do need a real
 * session they become a `roles: ['reviewer']` claim, which `Role` already
 * carries and `scripts/src/set-claims.ts` already mints.
 *
 * ── What is here ───────────────────────────────────────────────────────────
 *
 * The committee list, the invitation mail and its link, assignment by hand and
 * by track, and exclusions. The reviewer's own page is `/review/{token}` on the
 * website; what it reads and writes is `@kgc/scripts/src/lib/reviews.ts`, which
 * this module shares one transaction with (`withdrawReviewer`). The
 * `reviews/{reviewerId}` document is written at assignment, carrying
 * `status: 'assigned'` and no scores, which is what makes reviewer progress a
 * query rather than a subtraction.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ReviewerRow {
  id: string;
  name: string;
  email: string;
  affiliation?: string;
  trackIds: string[];
  status: ReviewerStatus;
  maxAssignments: number;
  assignedCount: number;
  invitedAtMs?: number;
  /** When the invitation email last went out. Absent if it never has. */
  lastInvitationAtMs?: number;
}

const ms = (t: unknown): number | undefined => {
  try {
    return (t as Timestamp).toMillis();
  } catch {
    return undefined;
  }
};

/**
 * Every reviewer for this event, by name.
 *
 * Sorted in memory. `where(eventId) + orderBy(name)` needs a composite index and
 * the two `reviewers` indexes that exist both pin `status` as well, because the
 * assignment matcher only ever asks for the accepted ones. A programme committee
 * is tens of people, so the sort is free and the index is not worth adding —
 * and a query needing an index it does not have passes in the emulator and fails
 * in production, which AGENTS.md records shipping twice.
 */
export async function listReviewers(): Promise<ReviewerRow[]> {
  try {
    const snap = await db().collection(COLLECTIONS.reviewers).where('eventId', '==', EVENT_ID).get();
    return snap.docs
      .map((d) => {
        const r = d.data() as ReviewerDoc;
        return {
          id: d.id,
          name: r.name ?? '',
          email: r.email ?? '',
          affiliation: r.affiliation,
          trackIds: r.trackIds ?? [],
          status: r.status,
          maxAssignments: r.maxAssignments ?? 0,
          assignedCount: r.assignedCount ?? 0,
          invitedAtMs: r.invitedAt ? ms(r.invitedAt) : undefined,
          lastInvitationAtMs: r.lastInvitationAt ? ms(r.lastInvitationAt) : undefined,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    recordError('reviewers.list', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

export type ReviewerResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Invite somebody onto the committee.
 *
 * Idempotent by construction: the id is derived from the address, so pressing
 * invite twice updates one document. What it does **not** do is reset a
 * reviewer who has already accepted or declined back to `invited` — a decision
 * somebody made is not undone by an organizer re-typing their address.
 *
 * ⚠️ **Nothing is emailed here.** The invitation link is minted and shown on the
 * screen for the organizer to send, because a committee invitation is usually
 * one paragraph of a longer personal message and a templated blast is the wrong
 * shape for it. The screen says so rather than implying a mail went out.
 */
export async function inviteReviewer(input: {
  name: string;
  email: string;
  affiliation?: string;
  trackIds: string[];
  maxAssignments: number;
  actor: string;
}): Promise<ReviewerResult> {
  const name = input.name.trim();
  const email = normaliseEmail(input.email);

  if (name.length < 2) return { ok: false, error: 'Give the reviewer a name.' };
  if (!email.includes('@')) return { ok: false, error: `“${input.email}” is not an email address.` };
  if (!Number.isInteger(input.maxAssignments) || input.maxAssignments < 1) {
    return { ok: false, error: 'A reviewer has to be willing to take at least one submission.' };
  }

  try {
    const id = reviewerId(email);
    const ref = db().collection(COLLECTIONS.reviewers).doc(id);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as ReviewerDoc) : undefined;

    await ref.set(
      {
        eventId: EVENT_ID,
        name,
        email,
        affiliation: input.affiliation?.trim() || FieldValue.delete(),
        trackIds: input.trackIds,
        maxAssignments: input.maxAssignments,
        /*
         * ⚠️ `FieldValue.delete()` rather than `|| undefined`. Under
         * `ignoreUndefinedProperties` an `undefined` on a merge write stores no
         * key at all, so a cleared affiliation would silently keep the old one
         * while the screen reported "Saved" — AGENTS.md gotcha 9.
         */
        ...(existing
          ? {}
          : {
              status: 'invited' as ReviewerStatus,
              assignedCount: 0,
              /*
               * The stored hash is what makes a single link revocable. The
               * plaintext token never reaches Firestore, so a database read is
               * not a working link into every unpublished submission in the call
               * — which matters more here than for a submitter, because this
               * link opens somebody else's work.
               */
              inviteTokenHash: await tokenHash(id),
              invitedAt: FieldValue.serverTimestamp(),
              createdAt: FieldValue.serverTimestamp(),
            }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: existing ? 'reviewer.update' : 'reviewer.invite',
      targetPath: `${COLLECTIONS.reviewers}/${id}`,
      targetId: id,
      before: existing ? { name: existing.name, trackIds: existing.trackIds } : {},
      after: { name, email, trackIds: input.trackIds, maxAssignments: input.maxAssignments },
    });

    return {
      ok: true,
      message: existing
        ? `Updated ${name}. Their invitation status is unchanged. An answer they already gave is not reset by an edit here.`
        : `Added ${name}. Nothing has been emailed yet. Assign their submissions, then send the invitation from the list above.`,
    };
  } catch (err) {
    recordError('reviewers.invite', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add the reviewer.' };
  }
}

/** Take somebody off the committee without losing the record that they were on it. */
export async function setReviewerStatus(input: {
  id: string;
  status: ReviewerStatus;
  actor: string;
}): Promise<ReviewerResult> {
  try {
    const ref = db().collection(COLLECTIONS.reviewers).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That reviewer does not exist.' };
    const before = snap.data() as ReviewerDoc;

    await ref.update({
      status: input.status,
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendAudit({
      actor: input.actor,
      action: 'reviewer.update',
      targetPath: `${COLLECTIONS.reviewers}/${input.id}`,
      targetId: input.id,
      before: { status: before.status },
      after: { status: input.status },
    });

    return {
      ok: true,
      message:
        input.status === 'removed'
          ? `${before.name} is off the committee. Assignments already made stay on the submissions. A review somebody wrote is not deleted by removing them.`
          : `${before.name} is now ${input.status}.`,
    };
  } catch (err) {
    recordError('reviewers.setStatus', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the reviewer.' };
  }
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignOutcome {
  assigned: number;
  /** Pairs skipped because the reviewer already had that submission. */
  alreadyAssigned: number;
  /** Reviewers passed over because they were at their stated ceiling. */
  atCapacity: string[];
}

/**
 * Give one reviewer one submission.
 *
 * ── The double assignment is a failed `create`, not a lost race ────────────
 *
 * `submissions/{id}/reviews/{reviewerId}` is keyed by the reviewer, so the same
 * pair can only ever produce one document and a second attempt fails with
 * `already-exists`. That is the mechanism `checkIns`, `scanEvents` and the
 * consent register all use — the failure *is* the protection, and there is no
 * read-then-write window to lose.
 *
 * ── `maxAssignments` is respected here, and it was not enforced anywhere ────
 *
 * `ReviewerDoc.maxAssignments` carried a ⚠️ saying nothing enforced it because
 * no assignment action existed. One exists now, and this is it: a reviewer at
 * their ceiling is skipped and named, rather than silently loaded up. Note the
 * ceiling is a *stated willingness*, so it is reported as "passed over" and not
 * as an error.
 */
export async function assignReviewer(input: {
  submissionId: string;
  reviewerId: string;
  by: NonNullable<ReviewDoc['assignedBy']>;
  actor: string;
}): Promise<ReviewerResult> {
  try {
    const outcome = await assignOne(input.submissionId, input.reviewerId, input.by);
    if (!outcome.ok) return outcome;

    await appendAudit({
      actor: input.actor,
      action: 'reviewer.assign',
      targetPath: `${COLLECTIONS.submissions}/${input.submissionId}`,
      targetId: input.reviewerId,
      before: {},
      after: { assignedBy: input.by },
    });

    return outcome;
  } catch (err) {
    recordError('reviewers.assign', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not assign the reviewer.' };
  }
}

/**
 * Assign every accepted reviewer whose tracks overlap a submission's track.
 *
 * ── Matched on track ids, never on free text ───────────────────────────────
 *
 * `ReviewerDoc.trackIds` is `tracks/{id}` ids for exactly this reason: a matcher
 * on free text returns nothing for the reviewer who typed "Knowledge Graphs"
 * where the call says "Knowledge Graph Engineering", and a reviewer with no
 * matches looks identical to a reviewer with no expertise.
 *
 * A submission with no track is skipped rather than given to everybody. So is a
 * submission that already has its full complement — `reviewsPerSubmission` on
 * the call is the target, and piling a fourth reviewer onto a paper that has
 * three takes that reviewer away from one that has none.
 */
export async function assignByTrack(input: {
  callId: string;
  reviewsPerSubmission: number;
  actor: string;
}): Promise<{ ok: true; message: string; outcome: AssignOutcome } | { ok: false; error: string }> {
  try {
    const [reviewers, subs] = await Promise.all([
      listReviewers(),
      db()
        .collection(COLLECTIONS.submissions)
        .where('eventId', '==', EVENT_ID)
        .where('callId', '==', input.callId)
        .get(),
    ]);

    const available = reviewers.filter((r) => r.status === 'accepted' || r.status === 'invited');
    if (available.length === 0) {
      return {
        ok: false,
        error: 'There are no reviewers to assign. Invite somebody first.',
      };
    }

    const outcome: AssignOutcome = { assigned: 0, alreadyAssigned: 0, atCapacity: [] };
    // Kept in memory across the run so a reviewer's ceiling is respected over
    // the whole batch rather than per submission — otherwise a committee member
    // willing to take five ends up with fifty, one submission at a time.
    const load = new Map(available.map((r) => [r.id, r.assignedCount]));

    for (const doc of subs.docs) {
      const sub = doc.data() as SubmissionDoc;
      if (sub.status === 'draft' || sub.status === 'withdrawn') continue;
      if (!sub.trackId) continue;

      let have = sub.reviewsAssigned ?? 0;
      if (have >= input.reviewsPerSubmission) continue;

      const candidates = available
        .filter((r) => r.trackIds.includes(sub.trackId as string))
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));

      for (const reviewer of candidates) {
        if (have >= input.reviewsPerSubmission) break;

        if ((load.get(reviewer.id) ?? 0) >= reviewer.maxAssignments) {
          if (!outcome.atCapacity.includes(reviewer.name)) outcome.atCapacity.push(reviewer.name);
          continue;
        }

        const result = await assignOne(doc.id, reviewer.id, 'topic');
        if (!result.ok) continue;
        if (result.message === ALREADY) {
          outcome.alreadyAssigned++;
          continue;
        }

        outcome.assigned++;
        have++;
        load.set(reviewer.id, (load.get(reviewer.id) ?? 0) + 1);
      }
    }

    await appendAudit({
      actor: input.actor,
      action: 'reviewer.assign',
      targetPath: `${COLLECTIONS.calls}/${input.callId}`,
      targetId: input.callId,
      before: {},
      after: {
        assignedBy: 'topic',
        assigned: outcome.assigned,
        alreadyAssigned: outcome.alreadyAssigned,
        atCapacity: outcome.atCapacity.length,
      },
    });

    return {
      ok: true,
      outcome,
      message:
        outcome.assigned === 0
          ? 'Nothing to assign. Every submission with a track either has its full complement already, or there is no reviewer covering that track.'
          : `Made ${outcome.assigned} assignment${outcome.assigned === 1 ? '' : 's'}.` +
            (outcome.atCapacity.length
              ? ` Passed over ${outcome.atCapacity.join(', ')}, already at the load they said they would take.`
              : ''),
    };
  } catch (err) {
    recordError('reviewers.assignByTrack', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not assign by track.' };
  }
}

/** The message `assignOne` returns when the pair already exists. */
const ALREADY = 'That reviewer already has this submission.';
/** And when the pair is a conflict of interest. An error, unlike the above. */
const EXCLUDED =
  'That reviewer has a conflict of interest with this submission, so it cannot be assigned to them.';

/**
 * The single assignment, in one transaction across three documents: the review,
 * the submission's `reviewsAssigned`, and the reviewer's `assignedCount`.
 *
 * The counters are kept by the writer rather than by a Cloud Function trigger,
 * and unlike `replyCount` and the rest they do **not** wait on the IAM grant
 * that blocks `functions/`. Those exist because a *client* writes the thing
 * being counted and something has to react; nothing here is client-written, so
 * the writer can simply keep the count. `SubmissionDoc.reviewsAssigned` says so.
 */
async function assignOne(
  submissionId: string,
  reviewerId: string,
  by: NonNullable<ReviewDoc['assignedBy']>,
): Promise<ReviewerResult> {
  const subRef = db().collection(COLLECTIONS.submissions).doc(submissionId);
  const reviewRef = subRef.collection(SUBCOLLECTIONS.reviews).doc(reviewerId);
  const reviewerRef = db().collection(COLLECTIONS.reviewers).doc(reviewerId);

  try {
    await db().runTransaction(async (tx) => {
      const [subSnap, reviewSnap, reviewerSnap] = await Promise.all([
        tx.get(subRef),
        tx.get(reviewRef),
        tx.get(reviewerRef),
      ]);

      if (!subSnap.exists) throw new Error('That submission does not exist.');
      if (!reviewerSnap.exists) throw new Error('That reviewer does not exist.');
      if (reviewSnap.exists) {
        // A declined review is a conflict of interest, declared or imposed. It
        // stays on the path precisely so this `create` cannot happen.
        const held = reviewSnap.data() as ReviewDoc;
        throw new Error(held.status === 'declined' || held.conflict ? EXCLUDED : ALREADY);
      }

      const sub = subSnap.data() as SubmissionDoc;

      const review: ReviewDoc = {
        eventId: EVENT_ID,
        submissionId,
        callId: sub.callId,
        reviewerId,
        status: 'assigned',
        conflict: false,
        assignedBy: by,
        assignedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      tx.create(reviewRef, review);

      tx.update(subRef, {
        reviewsAssigned: FieldValue.increment(1),
        /*
         * The status moves to `under-review` on the first assignment, and only
         * from `submitted`. A submission that has already been decided must not
         * be dragged back into review by somebody adding a late reviewer.
         */
        ...(sub.status === 'submitted' ? { status: 'under-review' } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.update(reviewerRef, {
        assignedCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { ok: true, message: 'Assigned.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not assign.';
    if (message === ALREADY) return { ok: true, message: ALREADY };
    if (message === EXCLUDED) return { ok: false, error: EXCLUDED };
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Sha256 of the first link minted for a reviewer, written once at invitation.
 *
 * ⚠️ It does not gate anything. Every invitation mail carries a newly minted
 * link, so no stored hash can match them all; a single reviewer's links are
 * killed through `status: 'removed'`, which `loadReviewer` checks on every
 * request. The field stays because `ReviewerDoc` requires it.
 */
async function tokenHash(reviewerId: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(mintReviewerToken(reviewerId)).digest('hex');
}

/**
 * Whether a reviewer document can be written at all.
 *
 * `mintReviewerToken` throws when neither `WEB_REVIEWER_SECRET` nor
 * `WEB_ORDER_SECRET` is configured, and `inviteTokenHash` is a required field —
 * so on a deployment with no secret the invite fails, and it should fail with
 * the sentence naming the variable rather than with a stack trace behind a
 * generic "could not save".
 */
export function reviewerInvitesAvailable(): boolean {
  try {
    mintReviewerToken('probe');
    return true;
  } catch (err) {
    recordError('reviewers.token', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// The reviewer's link, and the invitation that carries it
// ---------------------------------------------------------------------------

/**
 * A working link to one reviewer's page on the website, minted now.
 *
 * `publicSiteOrigin()` for the reason `callUrl` gives. Shown on the reviewers
 * screen as well as mailed, so an organizer can paste it into a message of
 * their own.
 */
export const reviewerLink = (reviewerId: string) =>
  `${publicSiteOrigin()}/review/${mintReviewerToken(reviewerId)}`;

/** Whether an invitation pressed now would leave this server as an email. */
export const invitationEmailAvailable = (): boolean => emailEnabled();

/**
 * Email one reviewer their link. The same button is the reminder.
 *
 * The send goes through `email.ts`, so it is logged in `emailLog` whether it
 * was sent, refused by the provider, or skipped because email is off, and the
 * message returned here says which rather than always saying "sent".
 */
export async function sendInvitation(input: {
  reviewerId: string;
  callId: string;
  note?: string;
  actor: string;
}): Promise<ReviewerResult> {
  try {
    const ref = db().collection(COLLECTIONS.reviewers).doc(input.reviewerId);
    const [snap, callSnap] = await Promise.all([
      ref.get(),
      db().collection(COLLECTIONS.calls).doc(input.callId).get(),
    ]);
    if (!snap.exists) return { ok: false, error: 'That reviewer does not exist.' };
    if (!callSnap.exists) return { ok: false, error: 'That call does not exist.' };

    const reviewer = snap.data() as ReviewerDoc;
    const call = callSnap.data() as CallDoc;
    if (reviewer.status === 'removed' || reviewer.status === 'declined') {
      return { ok: false, error: `${reviewer.name} is not on the committee, so their link would not open.` };
    }

    await sendReviewerInvitation(db(), {
      to: reviewer.email,
      name: reviewer.name,
      callTitle: call.title,
      link: reviewerLink(input.reviewerId),
      assigned: reviewer.assignedCount ?? 0,
      note: input.note?.trim() || undefined,
      actor: input.actor,
    });

    // Stamped only when a mail actually left: "invited before" on the screen
    // must not be true of somebody who was never written to.
    if (emailEnabled()) {
      await ref.update({
        lastInvitationAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await appendAudit({
      actor: input.actor,
      action: 'reviewer.sendInvitation',
      targetPath: `${COLLECTIONS.reviewers}/${input.reviewerId}`,
      targetId: input.reviewerId,
      before: {},
      after: { callId: input.callId, emailed: emailEnabled() },
    });

    return {
      ok: true,
      message: emailEnabled()
        ? `Invitation sent to ${reviewer.email}.`
        : `Email is not switched on yet, so nothing was sent to ${reviewer.email}. Copy their link and send it yourself.`,
    };
  } catch (err) {
    recordError('reviewers.sendInvitation', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not send the invitation.' };
  }
}

// ---------------------------------------------------------------------------
// Conflicts of interest
// ---------------------------------------------------------------------------

/**
 * What `@kgc/scripts/src/lib/reviews.ts` needs from the app that owns the store:
 * a `FieldValue.delete()` built by *this* copy of `firebase-admin`, because a
 * sentinel from another copy fails the whole write (AGENTS.md gotcha 8).
 * Exported so the emulator suite hands the same thing in.
 */
export const reviewStoreOps = () => ({ deleteField: FieldValue.delete() });

/**
 * Keep one reviewer away from one submission.
 *
 * The write is `withdrawReviewer`, the same transaction a reviewer's own
 * declaration runs, so the two cannot count differently. It works before any
 * assignment exists, which is the useful case: excluding a supervisor from
 * their student's paper *before* pressing "Assign by track".
 */
export async function excludeReviewer(input: {
  submissionId: string;
  reviewerId: string;
  note?: string;
  actor: string;
}): Promise<ReviewerResult> {
  try {
    const result = await withdrawReviewer(
      db(),
      reviewStoreOps(),
      {
        submissionId: input.submissionId,
        reviewerId: input.reviewerId,
        note: input.note,
        excludedBy: input.actor,
      },
    );
    if (!result.ok) return result;
    if (result.already) return { ok: true, message: 'They were already off this submission.' };

    await appendAudit({
      actor: input.actor,
      action: 'reviewer.exclude',
      targetPath: `${COLLECTIONS.submissions}/${input.submissionId}`,
      targetId: input.reviewerId,
      before: {},
      after: { excluded: true, note: input.note?.trim() || null },
    });

    return {
      ok: true,
      message:
        'Excluded. They can no longer open this submission, their scores on it no longer count, and assignment will skip them.',
    };
  } catch (err) {
    recordError('reviewers.exclude', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not exclude the reviewer.' };
  }
}

/**
 * Lift an exclusion an organizer made.
 *
 * Deletes the placeholder review so the pair can be assigned again. ⚠️ Only an
 * organizer's exclusion that holds no scores: a conflict the reviewer declared
 * is theirs, and a review that was scored before the exclusion is a record.
 */
export async function liftExclusion(input: {
  submissionId: string;
  reviewerId: string;
  actor: string;
}): Promise<ReviewerResult> {
  try {
    const ref = db()
      .collection(COLLECTIONS.submissions)
      .doc(input.submissionId)
      .collection(SUBCOLLECTIONS.reviews)
      .doc(input.reviewerId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: true, message: 'There was no exclusion to lift.' };

    const review = snap.data() as ReviewDoc;
    if (!review.excludedBy) {
      return { ok: false, error: 'The reviewer declared this conflict themselves, so it stays.' };
    }
    if (review.scores && Object.keys(review.scores).length > 0) {
      return { ok: false, error: 'They had already scored this submission, so the record stays.' };
    }

    await ref.delete();
    await appendAudit({
      actor: input.actor,
      action: 'reviewer.exclude',
      targetPath: `${COLLECTIONS.submissions}/${input.submissionId}`,
      targetId: input.reviewerId,
      before: { excluded: true },
      after: { excluded: false },
    });
    return { ok: true, message: 'Exclusion lifted. They can be assigned this submission again.' };
  } catch (err) {
    recordError('reviewers.liftExclusion', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not lift the exclusion.' };
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ReviewerProgress {
  assigned: number;
  submitted: number;
  conflicts: number;
}

export interface ConflictRow {
  submissionId: string;
  reviewerId: string;
  note?: string;
  /** Absent when the reviewer declared it. */
  excludedBy?: string;
  /** An organizer's exclusion with no scores on it can be lifted. */
  liftable: boolean;
}

/**
 * Every review across a set of submissions, folded into per-reviewer progress
 * and the list of conflicts.
 *
 * One subcollection read per submission rather than a collection-group query,
 * because the only `reviews` index leads with `reviewerId` and a group query
 * without it needs an index that does not exist: it would pass in the emulator
 * and fail live. A call is hundreds of submissions, read in parallel.
 */
export async function reviewProgress(submissionIds: string[]): Promise<{
  byReviewer: Map<string, ReviewerProgress>;
  conflicts: ConflictRow[];
}> {
  const byReviewer = new Map<string, ReviewerProgress>();
  const conflicts: ConflictRow[] = [];

  try {
    const snaps = await Promise.all(
      submissionIds.map((id) =>
        db().collection(COLLECTIONS.submissions).doc(id).collection(SUBCOLLECTIONS.reviews).get(),
      ),
    );
    snaps.forEach((snap, i) => {
      for (const doc of snap.docs) {
        const r = doc.data() as ReviewDoc;
        const p = byReviewer.get(doc.id) ?? { assigned: 0, submitted: 0, conflicts: 0 };
        if (r.status === 'declined' || r.conflict === true) {
          p.conflicts++;
          conflicts.push({
            submissionId: submissionIds[i],
            reviewerId: doc.id,
            note: r.conflictNote,
            excludedBy: r.excludedBy,
            liftable: Boolean(r.excludedBy) && Object.keys(r.scores ?? {}).length === 0,
          });
        } else {
          p.assigned++;
          if (r.status === 'submitted') p.submitted++;
        }
        byReviewer.set(doc.id, p);
      }
    });
  } catch (err) {
    recordError('reviewers.progress', err);
  }

  return { byReviewer, conflicts };
}
