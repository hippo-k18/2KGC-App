'use server';

import { revalidatePath } from 'next/cache';
import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

/**
 * Hiding and restoring community content.
 *
 * Every action is a status change, never a delete. An organizer moderating
 * during an event will hide the wrong thing at some point, at speed — `hidden`
 * is one click from reversible and a delete is not. And when something is
 * hidden *because* it was abusive, the post is the evidence a code-of-conduct
 * process needs; destroying it destroys the only record of what happened.
 *
 * Both actions take the whole decision from the form rather than toggling,
 * because a toggle read from a stale page hides the thing the organizer was
 * trying to restore.
 */

async function setStatus(
  ref: FirebaseFirestore.DocumentReference,
  status: 'visible' | 'hidden',
  actor: string,
  what: string,
  targetId: string,
) {
  const before = (await ref.get()).data()?.status ?? 'visible';
  await ref.update({ status, updatedAt: new Date() });
  await appendAudit({
    actor,
    action: 'moderation.setStatus',
    targetPath: ref.path,
    targetId,
    before: { status: before },
    after: { status, kind: what },
  });
}

export async function moderatePostAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') === 'hidden' ? 'hidden' : 'visible';
  if (!id) return;

  try {
    await setStatus(
      db().collection(COLLECTIONS.communityPosts).doc(id),
      status,
      actor,
      'post',
      id,
    );
  } catch (err) {
    recordError('moderation.post', err);
  }
  revalidatePath(ROUTES.moderateBoard);
}

export async function moderateReplyAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const postId = String(formData.get('postId') ?? '');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') === 'hidden' ? 'hidden' : 'visible';
  if (!postId || !id) return;

  try {
    await setStatus(
      db()
        .collection(COLLECTIONS.communityPosts)
        .doc(postId)
        .collection(SUBCOLLECTIONS.replies)
        .doc(id),
      status,
      actor,
      'reply',
      id,
    );
  } catch (err) {
    recordError('moderation.reply', err);
  }
  revalidatePath(ROUTES.moderateBoard);
}

/**
 * Destroying a post or a reply, as opposed to hiding it.
 *
 * ── Why this exists at all, given everything above ──────────────────────────
 *
 * The argument for hiding rather than deleting is sound and it is still the
 * default: hidden is one click from reversible, the counters that derive from a
 * document need the document, and when something is hidden *because* it was
 * abusive the post is the evidence a code-of-conduct process needs.
 *
 * It is not sound for every case. A post carrying somebody's home address, a
 * legal takedown, an erasure request under GDPR — for those, "hidden" means the
 * text is still in a collection that any future feature, export or backup can
 * read, and the organizer's only remaining route is the Firebase console. A
 * moderation queue that cannot remove content is a queue whose worst case is
 * handled outside the product, unaudited.
 *
 * ── The evidence objection is answered by the audit entry, not by hiding ────
 *
 * `before` carries the whole document, so the record of what was said and who
 * decided to destroy it outlives the post itself. That is the property hiding
 * was protecting; it survives the delete.
 *
 * A confirmation phrase is required in the UI, because this is the only action
 * in this dashboard that a stale page cannot undo.
 */
async function destroy(
  ref: FirebaseFirestore.DocumentReference,
  actor: string,
  what: 'post' | 'reply',
  targetId: string,
): Promise<void> {
  const snap = await ref.get();
  if (!snap.exists) return;

  /**
   * Replies and reactions go first, then the post.
   *
   * The other order leaves orphans: Firestore deletes are not recursive, a
   * subcollection under a deleted document keeps existing, and the next
   * moderator would see a post with no body and eleven replies under it. The
   * batch is deliberately not a transaction — at conference volumes a thread is
   * tens of documents, and a partial failure here retries cleanly because
   * deleting an already-deleted document is a no-op.
   */
  if (what === 'post') {
    for (const sub of [SUBCOLLECTIONS.replies, SUBCOLLECTIONS.reactions]) {
      const children = await ref.collection(sub).get();
      await Promise.all(children.docs.map((d) => d.ref.delete()));
    }
  }

  await ref.delete();

  await appendAudit({
    actor,
    action: 'moderation.delete',
    targetPath: ref.path,
    targetId,
    before: { kind: what, ...snap.data() },
    after: { deleted: true },
  });
}

export async function deletePostAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  try {
    await destroy(db().collection(COLLECTIONS.communityPosts).doc(id), actor, 'post', id);
  } catch (err) {
    recordError('moderation.deletePost', err);
  }
  revalidatePath(ROUTES.moderateBoard);
}

export async function deleteReplyAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const postId = String(formData.get('postId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!postId || !id) return;

  try {
    await destroy(
      db()
        .collection(COLLECTIONS.communityPosts)
        .doc(postId)
        .collection(SUBCOLLECTIONS.replies)
        .doc(id),
      actor,
      'reply',
      id,
    );
  } catch (err) {
    recordError('moderation.deleteReply', err);
  }
  revalidatePath(ROUTES.moderateBoard);
}
