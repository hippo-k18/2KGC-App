'use server';

import { revalidatePath } from 'next/cache';
import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

/**
 * Q&A settings and question moderation.
 *
 * Whova's version says a moderator's powers are exactly three: hide a question,
 * pin it, mark it answered. Two of those are here. **Pinning is not**, and that
 * is deliberate rather than unfinished — pinning reorders the board, the board
 * is ranked by `upvoteCount`, and `upvoteCount` is maintained by a Cloud
 * Function trigger that does not exist on the Spark plan. A pin control that
 * fought a frozen ranking would be worse than no pin control.
 */

export async function setQaSettingsAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '');
  const field = String(formData.get('field') ?? '');
  const next = String(formData.get('next') ?? '') === 'true';
  if (!id || (field !== 'qaEnabled' && field !== 'pollsEnabled')) return;

  try {
    const ref = db().collection(COLLECTIONS.sessions).doc(id);
    await ref.update({ [field]: next, updatedAt: new Date() });
    await appendAudit({
      actor,
      action: 'session.qaSettings',
      targetPath: ref.path,
      targetId: id,
      before: { [field]: !next },
      after: { [field]: next },
    });
  } catch (err) {
    recordError('session.qaSettings', err);
  }

  revalidatePath(ROUTES.qaManager);
}

export async function moderateQuestionAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '');
  const id = String(formData.get('id') ?? '');
  const state = String(formData.get('state') ?? '');
  if (!sessionId || !id) return;
  if (!['approved', 'hidden', 'answered'].includes(state)) return;

  try {
    const ref = db()
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.questions)
      .doc(id);

    const before = (await ref.get()).data()?.state ?? 'pending';
    await ref.update({
      state,
      // `answered` is a separate boolean on the model, kept in step so the app
      // can style an answered question without parsing the state machine.
      answered: state === 'answered',
    });

    await appendAudit({
      actor,
      action: 'moderation.setStatus',
      targetPath: ref.path,
      targetId: id,
      before: { state: before },
      after: { state, kind: 'question' },
    });
  } catch (err) {
    recordError('moderation.question', err);
  }

  revalidatePath(ROUTES.qaManager);
}
