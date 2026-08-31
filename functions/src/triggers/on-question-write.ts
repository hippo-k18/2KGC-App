import { createHash } from 'node:crypto';

import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { getFunctions } from 'firebase-admin/functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { TRIGGER } from '../runtime-options.js';

const DEBOUNCE_WINDOW_SECONDS = 5;

/**
 * `sessions/{sessionId}/questions/{questionId}` — see functions/SPEC.md #5.
 *
 * Only a `state` or `upvoteCount` change (including the question appearing
 * or disappearing) can move what `qaBoard/current` shows. A wording edit
 * (`body`/`editedAt`) cannot, so those are skipped to avoid rebuilding the
 * board on every author correction — `onQuestionUpvoteWrite` (#3) already
 * writes `upvoteCount` on this same document on every upvote/un-upvote,
 * which is what actually drives most of this trigger's firings.
 *
 * Debounced the same way as `onPollVoteWrite` (#4) — see that file's
 * docblock for why the task id is a hashed, time-bucketed value rather than
 * a lock document or a fixed id per session.
 */
export const onQuestionWrite = onDocumentWritten(
  { document: `${COLLECTIONS.sessions}/{sessionId}/${SUBCOLLECTIONS.questions}/{questionId}`, ...TRIGGER },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    const beforeExists = before?.exists ?? false;
    const afterExists = after?.exists ?? false;

    const relevant =
      !beforeExists ||
      !afterExists ||
      before?.data()?.state !== after?.data()?.state ||
      before?.data()?.upvoteCount !== after?.data()?.upvoteCount;
    if (!relevant) return;

    const { sessionId } = event.params;
    const bucket = Math.floor(Date.now() / (DEBOUNCE_WINDOW_SECONDS * 1000));
    const taskId = createHash('sha256').update(`qaBoard:${sessionId}:${bucket}`).digest('hex');

    try {
      await getFunctions()
        .taskQueue<{ sessionId: string }>('rebuildQaBoard')
        .enqueue({ sessionId }, { id: taskId, scheduleDelaySeconds: DEBOUNCE_WINDOW_SECONDS });
    } catch (err) {
      if ((err as { code?: string }).code === 'functions/task-already-exists') return;
      throw err;
    }
  },
);
