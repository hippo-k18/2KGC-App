import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { useDocument } from '@/lib/data/use-document';
import { prune, type Answers, type Survey, type SurveyResponse } from '@/lib/data/surveys-core';
import { runWrite, type WriteResult } from '@/lib/data/write';

// The pure half — the open/closed window, the required-question check and the
// multi-select encoding — is in `surveys-core.ts` so it can be tested; see its
// header. Re-exported so a screen imports surveys from one place.
export type { Answers, Survey, SurveyResponse } from '@/lib/data/surveys-core';
export {
  answeredCount,
  decodeMulti,
  encodeMulti,
  isOpen,
  missingRequired,
  MULTI_SEPARATOR,
  RATING_MAX,
} from '@/lib/data/surveys-core';

/**
 * Every survey an attendee may answer.
 *
 * ## The `status` filter is load-bearing, not cosmetic
 *
 * `firestore.rules` serves a survey only when `resource.data.status ==
 * 'published'`, which across a *query* means the query itself must carry that
 * equality or the whole thing is denied — `resource.data` is null on a `list`.
 * So this filter is what makes the read permitted at all, exactly as it is on
 * `sessions`. Removing it does not widen the list; it empties it.
 *
 * The pair of equalities is indexed as `eventId, status` in
 * `firestore.indexes.json`. The emulator does not enforce composite indexes, so
 * an unindexed query here would pass every local run and fail in production
 * with `failed-precondition`.
 *
 * Ordered by title. There is no ordering field the console reliably writes —
 * `createdAt` is set on create and an `orderBy` on it would silently drop any
 * survey that predates the field — and a handful of surveys does not need one.
 */
export function useSurveys() {
  const { data, error, loading, status, retry } = useCollection<Survey>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.surveys),
        where('eventId', '==', EVENT_ID),
        where('status', '==', 'published'),
      ),
    [],
    (id, d) => ({ id, ...d }) as Survey,
    (a, b) => a.title.localeCompare(b.title),
  );
  return { surveys: data, error, loading, status, retry };
}

/** One survey, for the screen that answers it. */
export function useSurvey(surveyId: string | undefined) {
  const { data, error, status, retry } = useDocument<Survey>(
    () => (surveyId ? doc(getDb(), COLLECTIONS.surveys, surveyId) : null),
    [surveyId],
    (id, d) => ({ id, ...d }) as Survey,
  );
  return { survey: data, error, status, retry };
}

/**
 * The reader's own response to one survey, or `null` if they have not answered.
 *
 * `surveys/{id}/responses/{uid}` — keyed by uid, so this is a point read rather
 * than a query. It has to be: the rules make a response readable only by its
 * author, which resolves on a `get` and is false across a `list`, so listing the
 * subcollection to find your own row is denied. That is the intent — a survey's
 * responses are not the room's to browse.
 */
export function useMySurveyResponse(surveyId: string | undefined) {
  const { user } = useAuth();

  const { data, error, status, retry } = useDocument<SurveyResponse>(
    () =>
      user && surveyId
        ? doc(getDb(), COLLECTIONS.surveys, surveyId, SUBCOLLECTIONS.responses, user.uid)
        : null,
    [user?.uid, surveyId],
    (id, d) => ({ id, ...d }) as SurveyResponse,
  );

  return { response: data, error, status, retry };
}

/**
 * Which of these surveys the reader has already answered.
 *
 * One `getDoc` per survey at a known path, the shape `useMyUpvotes` uses and for
 * the same reason: a `list` over anyone's responses is denied, and a listener
 * per survey would be N live subscriptions for a set that changes only when the
 * reader submits something.
 *
 * `answered` is a set of ids, and `checked` says whether the reads have settled.
 * They are separate because "not in the set" before the reads return is
 * indistinguishable from "not answered", and offering the form to somebody who
 * has already submitted ends in a `permission-denied` on a write they were
 * invited to make.
 */
export function useAnsweredSurveys(surveyIds: string[]) {
  const { user } = useAuth();
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const key = surveyIds.join(',');

  useEffect(() => {
    if (!user || !key) {
      setAnswered(new Set());
      setChecked(!key);
      return;
    }
    let ignore = false;
    setChecked(false);
    (async () => {
      const ids = key.split(',');
      const found = await Promise.all(
        ids.map(async (id) => {
          const snap = await getDoc(
            doc(getDb(), COLLECTIONS.surveys, id, SUBCOLLECTIONS.responses, user.uid),
          ).catch(() => null);
          return snap?.exists() ? id : null;
        }),
      );
      if (ignore) return;
      setAnswered(new Set(found.filter((id): id is string => id !== null)));
      setChecked(true);
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, key]);

  return { answered, checked };
}

/**
 * Submits a response.
 *
 * `setDoc` at `responses/{uid}`, so a second submission is a write to a document
 * that already exists — and the rules close `update`, so it is refused at the
 * boundary rather than by this screen. That is deliberate: the "you have already
 * answered" state in the UI is read from your own response document, and a read
 * that fails must not be able to turn into a silent overwrite of an answer
 * somebody already gave.
 *
 * The key set is exactly what the rule allows and what `SurveyResponseDoc`
 * declares. Anything else — an `eventId` copied in out of habit, a `surveyId`
 * that duplicates the path — is refused by `hasOnly`, which is the point of
 * having it.
 */
export function useSubmitSurveyResponse(survey: Survey | null) {
  const { user } = useAuth();

  return useCallback(
    async (answers: Answers): Promise<WriteResult> => {
      if (!user || !survey) return { ok: false, error: new Error('Not signed in') };
      return runWrite('submit survey response', () =>
        setDoc(
          doc(getDb(), COLLECTIONS.surveys, survey.id, SUBCOLLECTIONS.responses, user.uid),
          {
            uid: user.uid,
            answers: prune(survey, answers),
            submittedAt: serverTimestamp(),
          },
        ),
      );
    },
    [user, survey],
  );
}
