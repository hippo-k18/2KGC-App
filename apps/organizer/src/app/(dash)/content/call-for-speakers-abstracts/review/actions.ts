'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { acceptCfp, finishPass, rejectCfp } from '@/lib/cfp';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { CFA_BASE } from '../routes';

/**
 * François's two buttons. Leave has no action: it is the default, and a
 * submission left alone is simply on next week's list.
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
        ? await acceptCfp({ submissionId, actor })
        : verdict === 'reject'
          ? await rejectCfp({ submissionId, actor })
          : ({ ok: false, error: 'Choose accept or reject.' } as const);
    if (!result.ok) return { error: result.error };
    /*
     * Nothing is revalidated. Any `revalidatePath` in an action re-renders the
     * page it was called from, which would drop this row and the confirmation
     * in it ("the acceptance email went to …"), leaving François to guess
     * whether the email went. Every CFA screen is `force-dynamic`, so the next
     * visit to any of them reads the decision fresh.
     */
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('cfp.reviewDecide', err);
    return { error: 'Could not record the decision. Reload the list to see what was saved.' };
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
