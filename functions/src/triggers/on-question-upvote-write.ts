import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

/**
 * `sessions/{sessionId}/questions/{questionId}/upvotes/{uid}` — see
 * functions/SPEC.md #3.
 *
 * One document per upvoter, keyed by uid. `firestore.rules` only ever allows
 * `create` or `delete` on this path (never `update`), but the
 * appear/disappear check is kept anyway rather than assuming create/delete —
 * the same shape as #1 and #2, and it costs nothing to stay correct if that
 * ever changes.
 */
export const onQuestionUpvoteWrite = onDocumentWritten(
  `${COLLECTIONS.sessions}/{sessionId}/${SUBCOLLECTIONS.questions}/{questionId}/${SUBCOLLECTIONS.upvotes}/{uid}`,
  async (event) => {
    const existedBefore = event.data?.before.exists ?? false;
    const existedAfter = event.data?.after.exists ?? false;
    if (existedBefore === existedAfter) return;

    const delta = existedAfter ? 1 : -1;
    const { sessionId, questionId } = event.params;

    await getFirestore()
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.questions)
      .doc(questionId)
      .update({ upvoteCount: FieldValue.increment(delta) });
  },
);
