'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { acceptCfp, finishPass, leaveCfp, previewAcceptEmail, rejectCfp, type AcceptPreview } from '@/lib/cfp';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { editedEmailFrom } from '../edited-email';
import { CFA_BASE } from '../routes';

/**
 * François's three buttons. Leave is recorded since T378: the talk goes off
 * this week's list and comes back after the next pass.
 *
 * The hidden field is `submissionId`, never `id`: a control named `id` hides
 * the pressed button from React (see `submissions/decision-panel.tsx`).
 */
export async function reviewDecideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const submissionId = String(formData.get('submissionId') ?? '');
  const verdict = String(formData.get('verdict') ?? '');
  if (!submissionId) return { error: 'No submission was named.' };
  try {
    const result =
      verdict === 'accept'
        ? await acceptCfp({ submissionId, actor, e2Edited: editedEmailFrom(formData) })
        : verdict === 'reject'
          ? await rejectCfp({ submissionId, actor })
          : verdict === 'leave'
            ? await leaveCfp({ submissionId, actor })
            : ({ ok: false, error: 'Choose accept, reject or leave.' } as const);
    if (!result.ok) return { error: result.error };
    /*
     * Nothing is revalidated. Any `revalidatePath` in an action re-renders the
     * page it was called from, which would drop this row and the confirmation
     * in it ("the acceptance email went to …"), leaving François to guess
     * whether the email went. Every CFA screen is `force-dynamic`, and the
     * review page refreshes itself when the browser shows an old copy of it
     * (`RefreshWhenStale`, T378), so the next look at the list is current.
     */
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('cfp.reviewDecide', err);
    return { error: 'Could not record the decision. Reload the list to see what was saved.' };
  }
}

/** The acceptance email the dialog opens with. Reads only. */
export async function acceptPreviewAction(submissionId: string): Promise<AcceptPreview> {
  await requireOrganizer();
  try {
    return await previewAcceptEmail(submissionId);
  } catch (err) {
    recordError('cfp.acceptPreview', err);
    return { ok: false, error: 'Could not build the acceptance email. Reload and try again.' };
  }
}

export async function finishPassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  if (!callId) return { error: 'No call was named.' };
  const result = await finishPass(callId, actor);
  revalidatePath(`${CFA_BASE}/review`);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}
