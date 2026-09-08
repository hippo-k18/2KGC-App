'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { decideSubmission, undoDecision } from '@/lib/submissions';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { CFA_BASE } from '../routes';

/**
 * The decisions.
 *
 * ── Notifying is a separate choice, because it is the irreversible half ─────
 *
 * Recording a decision is a field write and can be taken back. The email cannot:
 * a refund can at least be explained, and a message in an author's inbox cannot
 * be recalled by anything in this product. So the screen offers two buttons —
 * decide, and decide *and tell them* — rather than one that quietly does both.
 * A committee that is still deliberating can record every decision and send
 * nothing until it has finished.
 */

function revalidate(id: string): void {
  revalidatePath(`${CFA_BASE}/submissions`);
  revalidatePath(`${CFA_BASE}/submissions/${id}`);
  revalidatePath(CFA_BASE);
}

export async function decideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '');
  const verdict = String(formData.get('verdict') ?? '');
  if (!id) return { error: 'No submission was named.' };
  if (verdict !== 'accept' && verdict !== 'reject') return { error: 'Choose accept or reject.' };

  try {
    const result = await decideSubmission({
      id,
      accept: verdict === 'accept',
      note: String(formData.get('note') ?? '') || undefined,
      /*
       * The checkbox is the *only* thing that sends mail. It is unticked by
       * default, so a mis-click records a decision rather than announcing one.
       */
      notify: formData.get('notify') === 'on',
      actor,
    });

    if (!result.ok) return { error: result.error };
    revalidate(id);
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('submission.decide', err);
    return { error: err instanceof Error ? err.message : 'Could not record the decision.' };
  }
}

/**
 * Undo, which is a field delete rather than a third status.
 *
 * ⚠️ It cannot un-send the acceptance email, and the confirmation says so.
 * Nothing can, and a button that silently left the author holding a message
 * saying they were accepted would be worse than no button.
 */
export async function undoDecisionAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const result = await undoDecision({ id, actor });
  revalidate(id);

  /*
   * The outcome travels back as a query parameter rather than as returned
   * state, because this action is bound to `ConfirmButton`, which takes a
   * `void` action so that it can live inside a `<details>` rather than a
   * modal. Swallowing a failure here would leave the organizer looking at a
   * decision they believe they removed.
   */
  if (!result.ok) {
    recordError('submission.undoDecision', new Error(result.error));
    // The reason travels in the URL rather than being flattened to "error":
    // the one an organizer actually hits is "this is already on the agenda",
    // which names the next thing to do, and a generic failure would not.
    redirect(
      `${CFA_BASE}/submissions/${id}?undo=${encodeURIComponent(result.error.slice(0, 240))}`,
    );
  }
  redirect(`${CFA_BASE}/submissions/${id}?undo=ok`);
}
