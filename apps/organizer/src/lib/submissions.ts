import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  TIME_ZONE,
  publicSiteOrigin,
  type ReviewDoc,
  type SessionDoc,
  type SessionFormat,
  type SpeakerDoc,
  type SubmissionCoAuthor,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
  type SubmissionStatus,
} from '@kgc/shared';
import { mintSubmissionToken } from '@kgc/scripts/src/lib/submission-token';
import { sendSubmissionDecision } from '@kgc/scripts/src/lib/email';
import { sessionId as deriveSessionId, speakerId, stableGuid } from '@kgc/scripts/src/lib/ids';
/*
 * Imported from the session editor rather than re-derived, because these two
 * flags decide whether a phone shows a Q&A tab on the talk and a promoted
 * session that behaved differently from a hand-created one would be a bug
 * nobody could see from either screen. It is the only thing this module takes
 * from a route directory; the alternative was a second copy of two booleans
 * that have to agree with `seed-demo.ts` as well.
 */
import { qaDefaultsFor } from '@/app/(dash)/content/agenda-center/session-manager/session-core';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import { deriveTimes } from './time';
import { getCall } from './calls';

/**
 * Submissions, from the organizer's side: reading them, deciding on them, and
 * promoting the accepted ones onto the agenda.
 *
 * ── The author lives in a second document, and that is the blind review ─────
 *
 * `submissions/{id}` carries the abstract and nothing that identifies its
 * author; `submissions/{id}/identity/author` carries the name, affiliation,
 * address and co-authors. `CFA-PLAN.md` §1.1 is the argument and `SubmissionDoc`
 * repeats it: with the split, hiding an author from a reviewer is a decision
 * about which of two documents a screen loads, and without it the same feature
 * is a migration of every submission ever written.
 *
 * ⚠️ The way that breaks is somebody adding `authorName` to the submission "just
 * for the list screen". This module is that list screen, and it reads the
 * identity document — it already runs on the Admin SDK, so it costs one batched
 * `getAll` and no schema change.
 *
 * The organizer sees everything. `CallDoc.blindReview` governs what the
 * *reviewer* is shown, which is `reviewers.ts`'s problem, not this one.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One submission flattened for a screen: no Timestamps, no class instances. */
export interface SubmissionRow {
  id: string;
  callId: string;
  title: string;
  abstract: string;
  trackId?: string;
  sessionType?: SessionFormat;
  answers: Record<string, string | string[] | boolean>;
  formVersion: number;
  status: SubmissionStatus;
  submittedAtMs?: number;
  updatedAtMs: number;
  decision?: { by: string; atMs: number; round: number };
  reviewsAssigned: number;
  reviewsSubmitted: number;
  scoreAverage?: number;
  sessionId?: string;
  /** From `submissions/{id}/identity/author`. Absent if that document is missing. */
  author?: {
    name: string;
    email: string;
    affiliation?: string;
    bio?: string;
    coAuthors: SubmissionCoAuthor[];
    speakerId?: string;
  };
}

const ms = (t: unknown): number => {
  try {
    return (t as Timestamp).toMillis();
  } catch {
    return 0;
  }
};

function toRow(id: string, s: SubmissionDoc, identity?: SubmissionIdentityDoc): SubmissionRow {
  return {
    id,
    callId: s.callId,
    title: s.title ?? '',
    abstract: s.abstract ?? '',
    trackId: s.trackId,
    sessionType: s.sessionType,
    answers: s.answers ?? {},
    formVersion: s.formVersion ?? 1,
    status: s.status,
    submittedAtMs: s.submittedAt ? ms(s.submittedAt) : undefined,
    updatedAtMs: ms(s.updatedAt),
    decision: s.decision
      ? { by: s.decision.by, atMs: ms(s.decision.at), round: s.decision.round }
      : undefined,
    reviewsAssigned: s.reviewsAssigned ?? 0,
    reviewsSubmitted: s.reviewsSubmitted ?? 0,
    scoreAverage: s.scoreAverage,
    sessionId: s.sessionId,
    author: identity
      ? {
          name: identity.name,
          email: identity.email,
          affiliation: identity.affiliation,
          bio: identity.bio,
          coAuthors: identity.coAuthors ?? [],
          speakerId: identity.speakerId,
        }
      : undefined,
  };
}

/**
 * Every submission to one call, newest activity first, with its author attached.
 *
 * ── Sorted in memory, and that is not laziness ─────────────────────────────
 *
 * Two equality filters need no composite index — Firestore serves them by
 * merging single-field indexes — but adding `orderBy('updatedAt')` to them does.
 * The emulator enforces no index configuration at all, so such a query passes
 * every local run and fails in production with `failed-precondition`; AGENTS.md
 * records that exact bug shipping twice, and it is worse here than usual because
 * the failure is caught below and rendered as *"Not inputted yet"* — an
 * organizer would be told nobody had submitted. A call is hundreds of documents,
 * which sort in microseconds, so this follows `listSessions`, `listCalls` and
 * `listReviewers` and keeps the ordering out of the query.
 *
 * ── Ordered by `updatedAt`, not `submittedAt` ──────────────────────────────
 *
 * `submittedAt` is absent on a draft, so ordering by it (in the query or here)
 * would put every incomplete submission last or nowhere, on the screen whose
 * whole job is to chase them. `updatedAt` is also the more useful question: who
 * touched this last, and how long ago.
 *
 * ── The authors are fetched in one `getAll`, not one `get` each ────────────
 *
 * A collection-group query on `identity` would need a `(eventId, callId)` index
 * this project does not have, and adding one to save a batched read that needs
 * no index at all is the wrong trade. `getAll` takes the document references
 * directly — the identity document sits at a fixed id under a known parent — so
 * there is no query, no index and one round trip.
 */
export async function listSubmissions(callId: string): Promise<SubmissionRow[]> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.submissions)
      .where('eventId', '==', EVENT_ID)
      .where('callId', '==', callId)
      .get();

    if (snap.empty) return [];

    const identities = await identitiesFor(snap.docs.map((d) => d.id));
    return snap.docs
      .map((d) => toRow(d.id, d.data() as SubmissionDoc, identities.get(d.id)))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title));
  } catch (err) {
    recordError(`submissions.list:${callId}`, err);
    return [];
  }
}

/** The author documents for a set of submissions, keyed by submission id. */
async function identitiesFor(ids: string[]): Promise<Map<string, SubmissionIdentityDoc>> {
  const out = new Map<string, SubmissionIdentityDoc>();
  if (ids.length === 0) return out;

  try {
    const refs = ids.map((id) =>
      db()
        .collection(COLLECTIONS.submissions)
        .doc(id)
        .collection(SUBCOLLECTIONS.identity)
        .doc(SUBMISSION_IDENTITY_DOC),
    );
    const docs = await db().getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      const data = doc.data() as SubmissionIdentityDoc;
      out.set(data.submissionId, data);
    }
  } catch (err) {
    /*
     * A missing author is rendered as "no author on file", never as an invented
     * name — so this failing degrades the screen rather than emptying it. The
     * decision buttons do not depend on it; the mail does, and `decide()`
     * re-reads the identity itself rather than trusting a row.
     */
    recordError('submissions.identities', err);
  }
  return out;
}

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  try {
    const doc = await db().collection(COLLECTIONS.submissions).doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data() as SubmissionDoc;
    if (data.eventId !== EVENT_ID) return null;

    const identities = await identitiesFor([id]);
    return toRow(doc.id, data, identities.get(id));
  } catch (err) {
    recordError(`submissions.get:${id}`, err);
    return null;
  }
}

/** One reviewer's verdict, flattened. */
export interface ReviewRow {
  reviewerId: string;
  status: ReviewDoc['status'];
  scores: Record<string, number>;
  overall?: number;
  confidence?: number;
  commentsToCommittee?: string;
  commentsToAuthors?: string;
  conflict: boolean;
  conflictNote?: string;
  assignedBy?: ReviewDoc['assignedBy'];
  submittedAtMs?: number;
}

/** The reviews entered against one submission, assigned ones included. */
export async function listReviews(submissionId: string): Promise<ReviewRow[]> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.submissions)
      .doc(submissionId)
      .collection(SUBCOLLECTIONS.reviews)
      .get();

    return snap.docs
      .map((d) => {
        const r = d.data() as ReviewDoc;
        return {
          reviewerId: r.reviewerId ?? d.id,
          status: r.status,
          scores: r.scores ?? {},
          overall: r.overall,
          confidence: r.confidence,
          commentsToCommittee: r.commentsToCommittee,
          commentsToAuthors: r.commentsToAuthors,
          conflict: r.conflict === true,
          conflictNote: r.conflictNote,
          assignedBy: r.assignedBy,
          submittedAtMs: r.submittedAt ? ms(r.submittedAt) : undefined,
        };
      })
      .sort((a, b) => a.reviewerId.localeCompare(b.reviewerId));
  } catch (err) {
    recordError(`submissions.reviews:${submissionId}`, err);
    return [];
  }
}

/** How many submissions are in each state. Real counts, or all zeroes. */
export interface SubmissionCounts {
  total: number;
  draft: number;
  submitted: number;
  underReview: number;
  accepted: number;
  rejected: number;
  withdrawn: number;
  /** Accepted and not yet on the agenda — what the promotion step has to do. */
  awaitingPromotion: number;
}

export function countSubmissions(rows: SubmissionRow[]): SubmissionCounts {
  const c: SubmissionCounts = {
    total: rows.length,
    draft: 0,
    submitted: 0,
    underReview: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0,
    awaitingPromotion: 0,
  };
  for (const r of rows) {
    if (r.status === 'draft') c.draft++;
    else if (r.status === 'submitted') c.submitted++;
    else if (r.status === 'under-review') c.underReview++;
    else if (r.status === 'accepted') c.accepted++;
    else if (r.status === 'rejected') c.rejected++;
    else if (r.status === 'withdrawn') c.withdrawn++;
    if (r.status === 'accepted' && !r.sessionId) c.awaitingPromotion++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export type SubmissionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Accept or reject one submission.
 *
 * ── The decision is a map that is absent until made ────────────────────────
 *
 * `SubmissionDoc.decision` rather than a pair of booleans, so "undo" is a field
 * delete and there is no way to represent the contradiction of an
 * accepted-and-rejected submission. `round` counts the rounds a committee has
 * made — accepting twenty, waiting for confirmations, then going back to the
 * waiting list is two rounds, and the second is not a correction of the first.
 *
 * ── Acceptance does not touch the agenda ───────────────────────────────────
 *
 * No session is written here and none should be. Whova's marketing says
 * acceptance synchronises with the agenda and its own help centre says the
 * opposite — *"Accepting a speaker submission will not automatically
 * synchronize with your Agenda"* — and the help centre is right, because
 * scheduling is a decision about rooms and times that acceptance does not make.
 * `promoteSubmission` below is that second, deliberate step.
 *
 * ── The mail is optional and it is the irreversible half ───────────────────
 *
 * A refund can at least be explained; an email in an author's inbox cannot be
 * recalled. So notifying is a separate choice on the screen rather than an
 * automatic consequence, and a committee that is still deliberating can record
 * decisions without telling anybody yet.
 */
export async function decideSubmission(input: {
  id: string;
  accept: boolean;
  /** Forwarded to the author with the decision. Never reviewer committee notes. */
  note?: string;
  notify: boolean;
  actor: string;
}): Promise<SubmissionResult> {
  try {
    const ref = db().collection(COLLECTIONS.submissions).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That submission does not exist.' };

    const sub = snap.data() as SubmissionDoc;
    if (sub.eventId !== EVENT_ID) return { ok: false, error: 'That submission does not exist.' };

    if (sub.status === 'draft') {
      return {
        ok: false,
        error:
          'That submission is still a draft. Its author has not finished it. Deciding on an ' +
          'unfinished abstract would be deciding on something nobody offered.',
      };
    }
    if (sub.status === 'withdrawn') {
      return {
        ok: false,
        error:
          'The author withdrew this. A withdrawal is theirs to make and a decision on top of it ' +
          'would put a rejection in the acceptance rate for a paper nobody was judging.',
      };
    }

    /*
     * The round increments only when a decision is *replacing* one. A first
     * decision is round 1; changing an acceptance to a rejection is round 2,
     * because the committee met again.
     */
    const round = (sub.decision?.round ?? 0) + 1;
    const status: SubmissionStatus = input.accept ? 'accepted' : 'rejected';

    await ref.update({
      status,
      decision: { by: input.actor, at: Timestamp.now(), round },
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendAudit({
      actor: input.actor,
      action: 'submission.decide',
      targetPath: `${COLLECTIONS.submissions}/${input.id}`,
      targetId: input.id,
      before: { status: sub.status, round: sub.decision?.round ?? null },
      after: { status, round, notified: input.notify },
    });

    if (!input.notify) {
      return {
        ok: true,
        message: `Recorded as ${status}. The author has not been told. Use “Notify the author” when the committee is ready.`,
      };
    }

    const identity = (await identitiesFor([input.id])).get(input.id);
    if (!identity?.email) {
      return {
        ok: true,
        message:
          `Recorded as ${status}, but there is no address on file for the author, so nothing was ` +
          'sent. That is a submission written without an identity document, which should not happen.',
      };
    }

    await sendSubmissionDecision(db(), {
      to: identity.email,
      name: identity.name,
      callTitle: (await getCall(sub.callId))?.title ?? 'the call for abstracts',
      title: sub.title,
      accepted: input.accept,
      link: submissionLink(input.id),
      note: input.note,
      actor: input.actor,
    });

    return {
      ok: true,
      message: `Recorded as ${status}, and ${identity.email} has been told. That email cannot be recalled.`,
    };
  } catch (err) {
    recordError('submissions.decide', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not record the decision.' };
  }
}

/**
 * Take a decision back.
 *
 * A field delete rather than a flag, which is the whole reason `decision` is an
 * optional map. ⚠️ `FieldValue.delete()` and not `undefined`: the store runs
 * with `ignoreUndefinedProperties`, so an `undefined` on an update writes no key
 * at all and the old decision survives while the screen says "Saved" —
 * AGENTS.md gotcha 9, found live in two other files.
 *
 * The status goes back to `under-review` rather than `submitted`, because a
 * submission that reached a decision has been read. `round` is deliberately not
 * decremented: it lives on the decision map, which is gone, and the count of
 * rounds is reconstructed from the audit log where the reversal is also recorded.
 *
 * ⚠️ It does not un-send the email, and the screen says so. Nothing can.
 */
export async function undoDecision(input: {
  id: string;
  actor: string;
}): Promise<SubmissionResult> {
  try {
    const ref = db().collection(COLLECTIONS.submissions).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That submission does not exist.' };

    const sub = snap.data() as SubmissionDoc;
    if (!sub.decision) return { ok: false, error: 'There is no decision on this submission.' };

    if (sub.sessionId) {
      return {
        ok: false,
        error:
          'This submission is already on the agenda as a session. Undoing the acceptance would ' +
          'leave a session nobody accepted; remove or cancel the session first.',
      };
    }

    await ref.update({
      status: 'under-review',
      decision: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendAudit({
      actor: input.actor,
      action: 'submission.undoDecision',
      targetPath: `${COLLECTIONS.submissions}/${input.id}`,
      targetId: input.id,
      before: { status: sub.status, decidedBy: sub.decision.by, round: sub.decision.round },
      after: { status: 'under-review', decision: null },
    });

    return {
      ok: true,
      message:
        'Decision removed; this is back under review. If the author was already emailed, that ' +
        'message stands. Nothing here can recall it, so tell them.',
    };
  } catch (err) {
    recordError('submissions.undoDecision', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not undo the decision.' };
  }
}

// ---------------------------------------------------------------------------
// Promotion into the agenda
// ---------------------------------------------------------------------------

/**
 * Turn an accepted submission into a session and a speaker.
 *
 * ── Why this is a button and not a consequence ─────────────────────────────
 *
 * `CFA-PLAN.md` §4: Whova's marketing claims acceptance synchronises with the
 * agenda and Whova's own help centre says it does not, and the help centre is
 * right. A session needs a day, a start, an end and a room; acceptance decides
 * none of those. Promoting on accept would fill the agenda with sessions at
 * midnight in no room, which somebody then has to find and fix.
 *
 * ── The speaker is found, not created, when it already exists ──────────────
 *
 * `speakerId(name, company)` from `@kgc/scripts/src/lib/ids` — the same
 * derivation the CSV importer and the seed use. An accepted author who is
 * already on the bill updates that document instead of appearing beside
 * themselves on the public page. That is the whole reason the id is derived
 * rather than random, and it is why the derivation is imported rather than
 * re-spelled here.
 *
 * ── One transaction, three documents ───────────────────────────────────────
 *
 * Session, speaker and the submission's `sessionId` commit together. A session
 * written without the back-reference is a session this button would happily
 * write again tomorrow, and `sessionId` is precisely what makes pressing it
 * twice harmless.
 */
export async function promoteSubmission(input: {
  submissionId: string;
  /** `YYYY-MM-DDTHH:mm` wall clock in the event's zone. */
  startsAtLocal: string;
  endsAtLocal: string;
  roomId?: string;
  actor: string;
}): Promise<SubmissionResult> {
  try {
    const subRef = db().collection(COLLECTIONS.submissions).doc(input.submissionId);
    const snap = await subRef.get();
    if (!snap.exists) return { ok: false, error: 'That submission does not exist.' };

    const sub = snap.data() as SubmissionDoc;
    if (sub.status !== 'accepted') {
      return { ok: false, error: 'Only an accepted submission can go onto the agenda.' };
    }
    if (sub.sessionId) {
      return {
        ok: false,
        error: `This is already on the agenda as “${sub.sessionId}”. Edit that session instead.`,
      };
    }

    const identity = (await identitiesFor([input.submissionId])).get(input.submissionId);
    if (!identity?.name) {
      return {
        ok: false,
        error:
          'There is no author on file for this submission, so there is nobody to put on the ' +
          'agenda. That is a submission written without an identity document.',
      };
    }

    const times = deriveTimes(input.startsAtLocal, input.endsAtLocal, TIME_ZONE);
    const sessionDocId = deriveSessionId(sub.title, times.startsAtLocal);
    const speakerDocId = speakerId(identity.name, identity.affiliation);

    const sessionRef = db().collection(COLLECTIONS.sessions).doc(sessionDocId);
    const speakerRef = db().collection(COLLECTIONS.speakers).doc(speakerDocId);
    const identityRef = subRef.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC);

    const room = input.roomId
      ? await db().collection(COLLECTIONS.rooms).doc(input.roomId).get()
      : undefined;
    if (input.roomId && !room?.exists) {
      return { ok: false, error: `No room with id “${input.roomId}”.` };
    }
    const roomName = room?.exists ? ((room.data() as { name?: string }).name ?? undefined) : undefined;

    // Set inside the transaction and read after it, so the audit entry can say
    // whether this author was already on the bill. "Updated an existing speaker"
    // and "created a second one" are the two outcomes this step exists to keep
    // apart, and an entry that cannot tell them apart cannot be used to check it.
    let speakerExisted = false;

    await db().runTransaction(async (tx) => {
      const [existingSession, existingSpeaker] = await Promise.all([
        tx.get(sessionRef),
        tx.get(speakerRef),
      ]);

      if (existingSession.exists) {
        throw new Error(
          `A session already holds the id “${sessionDocId}”. Same title, same start time. ` +
            'Either this has already been promoted under another submission, or the time needs to change.',
        );
      }

      const modelled: Omit<SessionDoc, 'createdAt' | 'updatedAt'> = {
        eventId: EVENT_ID,
        title: sub.title,
        description: sub.abstract,
        ...times,
        roomId: input.roomId,
        roomName,
        trackIds: sub.trackId ? [sub.trackId] : [],
        format: sub.sessionType ?? 'talk',
        speakerIds: [speakerDocId],
        speakerNames: [identity.name],
        tags: [],
        /*
         * Draft, not published. Promotion puts the talk on the organizer's
         * agenda so it can be scheduled against everything else; announcing it
         * is a separate decision, usually made once the whole programme hangs
         * together. A promotion that published straight to a thousand phones
         * would be irreversible in the only way that matters.
         */
        status: 'draft',
        sequence: 0,
        stableGuid: stableGuid(sessionDocId),
        ...qaDefaultsFor(sub.sessionType ?? 'talk'),
      };

      tx.create(sessionRef, {
        ...modelled,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      speakerExisted = existingSpeaker.exists;

      if (existingSpeaker.exists) {
        /*
         * An update rather than a set: this person is already on the bill and
         * their bio, portrait and social links were authored by somebody. The
         * only thing promotion knows better is that they are now also giving
         * this talk.
         */
        tx.update(speakerRef, {
          sessionIds: FieldValue.arrayUnion(sessionDocId),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const speaker: Omit<SpeakerDoc, 'createdAt' | 'updatedAt'> = {
          eventId: EVENT_ID,
          name: identity.name,
          company: identity.affiliation,
          bio: identity.bio,
          contactEmail: identity.email,
          sessionIds: [sessionDocId],
        };
        tx.create(speakerRef, {
          ...speaker,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(subRef, { sessionId: sessionDocId, updatedAt: FieldValue.serverTimestamp() });
      tx.set(identityRef, { speakerId: speakerDocId, updatedAt: Timestamp.now() }, { merge: true });
    });

    await appendAudit({
      actor: input.actor,
      action: 'submission.promote',
      targetPath: `${COLLECTIONS.submissions}/${input.submissionId}`,
      targetId: input.submissionId,
      before: { sessionId: null },
      after: {
        sessionId: sessionDocId,
        speakerId: speakerDocId,
        speakerExisted,
        startsAtLocal: times.startsAtLocal,
        roomName: roomName ?? null,
      },
    });

    return {
      ok: true,
      message:
        `“${sub.title}” is on the agenda as a draft session. ${identity.name} ` +
        `${speakerExisted ? 'was already a speaker and now also has this talk' : 'has been added as a speaker'}. ` +
        'The session is not published. Open it in Session Manager to check the room and the ' +
        'time, then publish.',
    };
  } catch (err) {
    recordError('submissions.promote', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not promote the submission.' };
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * The author's own way back to their submission.
 *
 * Minted rather than stored — the token *is* the authorisation and verifies
 * without a lookup, so a database read is not a set of working links into every
 * draft in the call (`submission-token.ts`). Re-minting is free and does not
 * need the old link dead, which is why "I lost my link" is answered by sending
 * a new one rather than by a revocation flow that does not exist.
 */
export const submissionLink = (submissionId: string) =>
  `${publicSiteOrigin()}/submit/token/${mintSubmissionToken(submissionId)}`;

/**
 * Whether a link can be minted at all, without throwing.
 *
 * `mintSubmissionToken` throws when neither secret is configured, and a screen
 * rendering a per-row link would then fail entirely rather than say what is
 * missing. Checked once, reported once — the same shape `signingLinksAvailable`
 * has in `consents.ts`.
 */
export function submissionLinksAvailable(): boolean {
  try {
    mintSubmissionToken('probe');
    return true;
  } catch (err) {
    recordError('submissions.link', err);
    return false;
  }
}
