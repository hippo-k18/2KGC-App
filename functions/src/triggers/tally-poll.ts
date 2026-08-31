import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { TASK_QUEUE_RATE_LIMITS, TRIGGER } from '../runtime-options.js';

interface TallyPollTask {
  sessionId: string;
  pollId: string;
}

/**
 * The Cloud Tasks target for `onPollVoteWrite` — see functions/SPEC.md #4.
 *
 * Recomputes `tallies` and `totalVotes` from scratch by reading every
 * document in `votes/`, rather than adjusting the previous values. A running
 * total invites drift the moment two dispatches for the same poll overlap
 * (retries, or two buckets scheduled close together); a full recompute is
 * idempotent by construction — running it twice in a row produces the same
 * result both times.
 *
 * Tallies are seeded from the poll's *current* `options`, not accumulated
 * from whatever option ids happen to appear in `votes/`. An organizer may
 * edit `options` after votes exist (`firestore.rules` allows it), and a vote
 * cast against a since-removed option must not resurrect a tally key nothing
 * on the ballot UI can display any more.
 */
export const tallyPoll = onTaskDispatched<TallyPollTask>(
  { retryConfig: { maxAttempts: 3 }, rateLimits: TASK_QUEUE_RATE_LIMITS, ...TRIGGER },
  async (req) => {
    const { sessionId, pollId } = req.data;
    const db = getFirestore();
    const pollRef = db
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.polls)
      .doc(pollId);

    const pollSnap = await pollRef.get();
    if (!pollSnap.exists) return;

    const options = (pollSnap.data()?.options ?? []) as { id: string; label: string }[];
    const tallies: Record<string, number> = Object.fromEntries(options.map((o) => [o.id, 0]));
    const validOptionIds = new Set(options.map((o) => o.id));

    const votesSnap = await pollRef.collection(SUBCOLLECTIONS.votes).get();
    for (const vote of votesSnap.docs) {
      const optionIds = (vote.data().optionIds ?? []) as string[];
      for (const id of optionIds) {
        if (validOptionIds.has(id)) tallies[id] += 1;
      }
    }

    await pollRef.update({
      tallies,
      totalVotes: votesSnap.size,
      talliesUpdatedAt: FieldValue.serverTimestamp(),
    });
  },
);
