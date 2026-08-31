import { useCallback, useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { useSubcollectionCounts } from '@/lib/data/counts';
import { useDocument } from '@/lib/data/use-document';
import { runWrite, type WriteResult } from '@/lib/data/write';
import { compareQuestions, type Question, type Poll, type Vote } from '@/lib/data/qa-core';

// The pure half of this module — the ranking and the tally-staleness test — is
// in `qa-core.ts` so that it can be tested; see its header. Re-exported so a
// screen still imports questions, polls and the rules for ordering them from one
// place.
export type { Question, Poll, Vote, TallyState } from '@/lib/data/qa-core';
export { rankQuestions, tallyState, upvoteScore } from '@/lib/data/qa-core';

/**
 * Live Q&A for a session.
 *
 * Reads the raw question collection, which is correct at KGC's scale — a
 * session's Q&A is tens of documents, not thousands. The `qaBoard` aggregate
 * exists for the case this does not survive: a keynote where 1,000 devices each
 * hold a listener over every question and re-render on every upvote is roughly
 * 40M reads and ten snapshot callbacks a second. Switching to the board is a
 * change to this hook and nothing else, which is why the screens never touch
 * the collection directly.
 */
export function useQuestions(sessionId: string | undefined) {
  const { data, error, loading, retry } = useCollection<Question>(
    () =>
      query(
        collection(
          getDb(),
          COLLECTIONS.sessions,
          sessionId ?? '_',
          SUBCOLLECTIONS.questions,
        ),
        where('state', 'in', ['approved', 'answered']),
      ),
    [sessionId],
    (id, d) => ({ id, ...d }) as Question,
    // The same comparator the screen uses, with nothing counted yet — see
    // `rankQuestions`. Sorting here by one rule and there by another is how a
    // list reorders itself for no reason the reader can see.
    compareQuestions(null),
  );

  return { questions: data, error, loading, retry };
}

/**
 * How many upvotes a question has, counted rather than read.
 *
 * `SessionQuestionDoc.upvoteCount` is owned by `onQuestionUpvoteWrite`, which is
 * written, tested and not deployed, so it is zero on every question — and it was
 * both the number on the screen and the sort key. Tapping upvote wrote the
 * `upvotes/{uid}` document correctly, the count stayed at zero, and the question
 * never rose: the ranking that is the entire point of a Q&A board was inert.
 *
 * Counting works here where it does not for poll ballots. An upvote is public by
 * rule — `match /upvotes/{uid} { allow read: if isRegistered() }` — so an
 * attendee may run the aggregation, which was verified against the emulator
 * rather than assumed from the rule text. A ballot is not; see `tallyState`.
 */
export function useUpvoteCounts(sessionId: string | undefined, questionIds: string[]) {
  return useSubcollectionCounts(
    sessionId ? questionIds : null,
    (id) => [
      COLLECTIONS.sessions,
      sessionId ?? '_',
      SUBCOLLECTIONS.questions,
      id,
      SUBCOLLECTIONS.upvotes,
    ],
    [sessionId],
  );
}

/**
 * Asks a question.
 *
 * `state: 'pending'` is not a default the client may vary — the rules reject
 * anything else. Without that, an attendee could file a question already marked
 * approved and put it straight on the screen behind the speaker.
 */
export function useAskQuestion(sessionId: string | undefined) {
  const { user } = useAuth();

  return useCallback(
    async (body: string): Promise<WriteResult> => {
      if (!user || !sessionId) return { ok: false, error: new Error('Not signed in') };
      return runWrite('ask question', () =>
        addDoc(
          collection(getDb(), COLLECTIONS.sessions, sessionId, SUBCOLLECTIONS.questions),
          {
            eventId: EVENT_ID,
            authorId: user.uid,
            body: body.trim(),
            state: 'pending',
            answered: false,
            // Owned by a trigger from here on; no client may move it.
            upvoteCount: 0,
            createdAt: serverTimestamp(),
          },
        ),
      );
    },
    [user, sessionId],
  );
}

/**
 * Which of these questions the signed-in user has already upvoted.
 *
 * One `getDoc` per question at a known path, rather than a query. There is no
 * collection-group rule for `upvotes`, so a single query across them is denied;
 * and a listener per question would be N live subscriptions for a set that
 * changes only when the user taps. A session carries tens of questions, so N
 * point reads on mount is the cheap, correct shape.
 */
export function useMyUpvotes(sessionId: string | undefined, questionIds: string[]) {
  const { user } = useAuth();
  const [upvoted, setUpvoted] = useState<Set<string>>(new Set());
  const key = questionIds.join(',');

  useEffect(() => {
    if (!user || !sessionId || !questionIds.length) return;
    let ignore = false;
    (async () => {
      const found = await Promise.all(
        questionIds.map(async (qid) => {
          const snap = await getDoc(
            doc(
              getDb(),
              COLLECTIONS.sessions,
              sessionId,
              SUBCOLLECTIONS.questions,
              qid,
              SUBCOLLECTIONS.upvotes,
              user.uid,
            ),
          ).catch(() => null);
          return snap?.exists() ? qid : null;
        }),
      );
      if (!ignore) setUpvoted(new Set(found.filter((q): q is string => q !== null)));
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, sessionId, key]);

  // Applied optimistically so the tap feels instant. This is only whether the
  // star is filled in — the number beside it is `useUpvoteCounts`, and it moves
  // once the write has landed rather than before.
  const mark = useCallback((qid: string, on: boolean) => {
    setUpvoted((prev) => {
      const next = new Set(prev);
      if (on) next.add(qid);
      else next.delete(qid);
      return next;
    });
  }, []);

  return { upvoted, mark };
}

export function useToggleUpvote(sessionId: string | undefined) {
  const { user } = useAuth();

  return useCallback(
    async (questionId: string, on: boolean): Promise<WriteResult> => {
      if (!user || !sessionId) return { ok: false, error: new Error('Not signed in') };
      const ref = doc(
        getDb(),
        COLLECTIONS.sessions,
        sessionId,
        SUBCOLLECTIONS.questions,
        questionId,
        SUBCOLLECTIONS.upvotes,
        user.uid,
      );
      return on
        ? runWrite('upvote', () =>
            setDoc(ref, { uid: user.uid, createdAt: serverTimestamp() }),
          )
        : runWrite('remove upvote', () => deleteDoc(ref));
    },
    [user, sessionId],
  );
}

/**
 * The open poll for a session, if there is one.
 *
 * Polls are few per session, so this reads the collection rather than paging.
 */
export function usePolls(sessionId: string | undefined) {
  const { data, error, loading, retry } = useCollection<Poll>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.sessions, sessionId ?? '_', SUBCOLLECTIONS.polls),
        orderBy('createdAt', 'desc'),
      ),
    [sessionId],
    (id, d) => ({ id, ...d }) as Poll,
  );

  return { polls: data ?? [], error, loading, retry };
}

/** Your own ballot. Readable only by you and an organizer — a vote is secret. */
export function useMyVote(sessionId: string | undefined, pollId: string | undefined) {
  const { user } = useAuth();

  const { data, error } = useDocument<Vote>(
    () =>
      user && sessionId && pollId
        ? doc(
            getDb(),
            COLLECTIONS.sessions,
            sessionId,
            SUBCOLLECTIONS.polls,
            pollId,
            SUBCOLLECTIONS.votes,
            user.uid,
          )
        : null,
    [user?.uid, sessionId, pollId],
    (id, d) => ({ id, ...d }) as Vote,
  );

  return { vote: data, error };
}

/**
 * Casts a ballot.
 *
 * One document per voter, keyed by uid. The shape this replaced held every
 * vote in a map on the poll document: 1,000 voters against Firestore's
 * ~1 write/sec/document limit took **sixteen minutes** to drain, so under a
 * tenth of the room had registered by the time the organizer read the result
 * off the screen. Per-voter documents make that limit per-voter and irrelevant.
 */
export function useCastVote(sessionId: string | undefined, pollId: string | undefined) {
  const { user } = useAuth();

  return useCallback(
    async (optionIds: string[]): Promise<WriteResult> => {
      if (!user || !sessionId || !pollId) {
        return { ok: false, error: new Error('Not signed in') };
      }
      return runWrite('cast vote', () =>
        setDoc(
          doc(
            getDb(),
            COLLECTIONS.sessions,
            sessionId,
            SUBCOLLECTIONS.polls,
            pollId,
            SUBCOLLECTIONS.votes,
            user.uid,
          ),
          { uid: user.uid, optionIds, createdAt: serverTimestamp() },
        ),
      );
    },
    [user, sessionId, pollId],
  );
}
