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
