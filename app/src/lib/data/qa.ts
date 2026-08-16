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

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type PollDoc,
  type PollVoteDoc,
  type SessionQuestionDoc,
  type WithId,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { useDocument } from '@/lib/data/use-document';
import { runWrite, type WriteResult } from '@/lib/data/write';

export type Question = WithId<SessionQuestionDoc>;
export type Poll = WithId<PollDoc>;
export type Vote = WithId<PollVoteDoc>;

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
  const { data, error, loading } = useCollection<Question>(
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
    // Most-upvoted first, then oldest — the order a moderator reads them in.
    (a, b) =>
      (b.upvoteCount ?? 0) - (a.upvoteCount ?? 0) ||
      (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0),
  );

  return { questions: data, error, loading };
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

  // Applied optimistically so the tap feels instant; the trigger-owned count on
  // the question catches up separately.
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
  const { data, loading } = useCollection<Poll>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.sessions, sessionId ?? '_', SUBCOLLECTIONS.polls),
        orderBy('createdAt', 'desc'),
      ),
    [sessionId],
    (id, d) => ({ id, ...d }) as Poll,
  );

  return { polls: data ?? [], loading };
}

/** Your own ballot. Readable only by you and an organizer — a vote is secret. */
export function useMyVote(sessionId: string | undefined, pollId: string | undefined) {
  const { user } = useAuth();

  const { data } = useDocument<Vote>(
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

  return data;
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
