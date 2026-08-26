import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

/**
 * `communityPosts/{postId}/reactions/{uid}` — see functions/SPEC.md #2.
 *
 * One document per reacting user, keyed by uid. `reactionCount` moves only
 * when the document appears or disappears; a reaction document can also be
 * `update`d in place (a user changing their emoji, per `firestore.rules`'
 * `allow create, update`), and that must not move the count at all.
 */
export const onReactionWrite = onDocumentWritten(
  `${COLLECTIONS.communityPosts}/{postId}/${SUBCOLLECTIONS.reactions}/{uid}`,
  async (event) => {
    const existedBefore = event.data?.before.exists ?? false;
    const existedAfter = event.data?.after.exists ?? false;
    if (existedBefore === existedAfter) return;

    const delta = existedAfter ? 1 : -1;
    const { postId } = event.params;

    await getFirestore()
      .collection(COLLECTIONS.communityPosts)
      .doc(postId)
      .update({ reactionCount: FieldValue.increment(delta) });
  },
);
