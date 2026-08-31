import { createHash } from 'node:crypto';

import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { getFunctions } from 'firebase-admin/functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { TRIGGER } from '../runtime-options.js';

const DEBOUNCE_WINDOW_SECONDS = 5;

/**
 * `sessions/{sessionId}/polls/{pollId}/votes/{uid}` — see functions/SPEC.md
 * #4. Every vote write schedules a `tallyPoll` task 5s out, rather than
 * recomputing tallies itself, so a burst of votes produces one recompute
 * instead of one write per voter — the whole reason `votes` is a
 * subcollection and not a map on the poll (see `PollDoc.tallies` in
 * `packages/shared/src/models.ts`).
 *
 * The debounce is a deterministic, time-bucketed Cloud Tasks id, not a lock
 * document: two votes landing in the same 5s wall-clock bucket for the same
 * poll produce the same task id, so the second `enqueue()` collides with
 * `functions/task-already-exists` and is dropped on purpose. This only works
 * because task ids are hashed rather than the raw `${pollId}:${bucket}`
 * string — Cloud Tasks explicitly warns that sequential or timestamp-prefixed
 * ids cause hotspotting, since its infrastructure assumes a roughly uniform
 * id distribution. Each bucket is used at most once ever, so this never hits
 * the ~1 hour window during which a *reused* task id would be rejected even
 * after the earlier task has already run — the bug a single fixed id per
 * poll would have caused for a poll open across many such windows.
 */
export const onPollVoteWrite = onDocumentWritten(
  {
    document: `${COLLECTIONS.sessions}/{sessionId}/${SUBCOLLECTIONS.polls}/{pollId}/${SUBCOLLECTIONS.votes}/{uid}`,
    ...TRIGGER,
  },
  async (event) => {
    const { sessionId, pollId } = event.params;
    const bucket = Math.floor(Date.now() / (DEBOUNCE_WINDOW_SECONDS * 1000));
    const taskId = createHash('sha256').update(`${pollId}:${bucket}`).digest('hex');

    try {
      await getFunctions()
        .taskQueue<{ sessionId: string; pollId: string }>('tallyPoll')
        .enqueue({ sessionId, pollId }, { id: taskId, scheduleDelaySeconds: DEBOUNCE_WINDOW_SECONDS });
    } catch (err) {
      if ((err as { code?: string }).code === 'functions/task-already-exists') return;
      throw err;
    }
  },
);
