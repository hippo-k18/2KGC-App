import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { TRIGGER } from '../runtime-options.js';

/**
 * `communityPosts/{postId}/replies/{replyId}` — see functions/SPEC.md #1.
 *
 * `replyCount` tracks how many reply documents exist, not how many are
 * currently visible. A `status` change (hidden/removed, or back to visible)
 * fires this trigger with the document existing on both sides and must not
 * move the counter — only a hard delete does, whether that is an author's own
 * retraction or an organizer's removal (both are `delete`, per
 * `firestore.rules`; a reply, unlike a post, is never soft-deleted only).
 */
export const onReplyWrite = onDocumentWritten(
  { document: `${COLLECTIONS.communityPosts}/{postId}/${SUBCOLLECTIONS.replies}/{replyId}`, ...TRIGGER },
  async (event) => {
    const existedBefore = event.data?.before.exists ?? false;
    const existedAfter = event.data?.after.exists ?? false;
    if (existedBefore === existedAfter) return;

    const delta = existedAfter ? 1 : -1;
    const { postId } = event.params;

    await getFirestore()
      .collection(COLLECTIONS.communityPosts)
      .doc(postId)
      .update({ replyCount: FieldValue.increment(delta) });
  },
);
