import { COLLECTIONS, QA_BOARD_DOC, SUBCOLLECTIONS } from '@kgc/shared';
import type { SessionQuestionDoc } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { TASK_QUEUE_RATE_LIMITS, TRIGGER } from '../runtime-options.js';

interface RebuildQaBoardTask {
  sessionId: string;
}

/**
 * To be fixed in Phase 1 — functions/SPEC.md #5 says "e.g. 50" without
 * committing to a number. 50 is generous for a keynote Q&A; revisit if a
 * real session ever gets close to it.
 */
const MAX_BOARD_QUESTIONS = 50;

/**
 * The Cloud Tasks target for `onQuestionWrite` — see functions/SPEC.md #5.
 *
 * Reads every question under the session — bounded, a live Q&A runs a few
 * dozen questions deep at most, nowhere near the volume that would justify
 * an indexed query — and filters to `state == 'approved'` in memory before
 * writing anything. This is the rule that matters most in this file:
 * `qaBoard/current` is rendered directly on a keynote screen, so a `pending`
 * or `hidden` question must never reach it, not even for one write.
 */
export const rebuildQaBoard = onTaskDispatched<RebuildQaBoardTask>(
  { retryConfig: { maxAttempts: 3 }, rateLimits: TASK_QUEUE_RATE_LIMITS, ...TRIGGER },
  async (req) => {
    const { sessionId } = req.data;
    const db = getFirestore();
    const questionsRef = db
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.questions);

    const snap = await questionsRef.get();

    const questions = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as SessionQuestionDoc) }))
      .filter((q) => q.state === 'approved')
      .sort((a, b) => b.upvoteCount - a.upvoteCount || b.createdAt.toMillis() - a.createdAt.toMillis())
      .slice(0, MAX_BOARD_QUESTIONS)
      .map((q) => ({
        id: q.id,
        body: q.body,
        authorId: q.authorId,
        upvoteCount: q.upvoteCount,
        state: q.state,
      }));

    await db
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.qaBoard)
      .doc(QA_BOARD_DOC)
      .set({ questions, rebuiltAt: FieldValue.serverTimestamp() });
  },
);
