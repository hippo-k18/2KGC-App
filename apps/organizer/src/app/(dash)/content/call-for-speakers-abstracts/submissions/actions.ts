'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { decideMany, decideSubmission, getSubmission, undoDecision } from '@/lib/submissions';
import { acceptCfp, getCfpCall, rejectCfp } from '@/lib/cfp';
import { excludeReviewer, liftExclusion } from '@/lib/reviewers';
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

  // `submissionId`, not `id`: see the warning in `decision-panel.tsx`.
  const id = String(formData.get('submissionId') ?? '');
  const verdict = String(formData.get('verdict') ?? '');
  if (!id) return { error: 'No submission was named.' };
  if (verdict !== 'accept' && verdict !== 'reject' && verdict !== 'waitlist') {
    return { error: 'Choose accept, waitlist or reject.' };
  }

  try {
    /*
     * On a call run with the rolling review (T249) Accept and Reject are the
     * same as on the weekly review screen: Accept creates the speaker and
     * mails E2, Reject records and sends nothing. The waiting list keeps the
     * old path, which Min's plan does not use.
     */
    const rolling = await onRollingReview(id);
    if (rolling && verdict === 'waitlist') {
      return { error: 'This call has no waiting list. Accept it, reject it, or leave it for next week.' };
    }
    if (rolling) {
      const r = verdict === 'accept' ? await acceptCfp({ submissionId: id, actor }) : await rejectCfp({ submissionId: id, actor });
      if (!r.ok) return { error: r.error };
      revalidate(id);
      return { ok: true, message: r.message };
    }

    const result = await decideSubmission({
      id,
      accept: verdict === 'accept',
      waitlist: verdict === 'waitlist',
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
    return { error: 'Could not record the decision. Reload the page to see what was saved.' };
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

/**
 * The same decision for every ticked row.
 *
 * The ids arrive from checkboxes in the table, tied to this form by the HTML
 * `form` attribute, so the table stays a table and the bar stays one form. The
 * notify box has the same default and the same warning as the single decision:
 * here it is one press for many inboxes.
 */
export async function bulkDecideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const ids = formData.getAll('ids').map(String).filter(Boolean);
  const verdict = String(formData.get('verdict') ?? '');
  if (ids.length === 0) return { error: 'Tick at least one submission first.' };
  if (verdict !== 'accept' && verdict !== 'reject' && verdict !== 'waitlist') {
    return { error: 'Choose accept, waitlist or reject.' };
  }

  try {
    const rolling = ids.length > 0 && (await onRollingReview(ids[0]));
    if (rolling && verdict === 'waitlist') {
      return { error: 'This call has no waiting list. Accept or reject the ticked submissions, or leave them.' };
    }
    if (rolling) {
      let done = 0;
      const refused: string[] = [];
      for (const submissionId of [...new Set(ids)].slice(0, 200)) {
        const r =
          verdict === 'accept' ? await acceptCfp({ submissionId, actor }) : await rejectCfp({ submissionId, actor });
        if (r.ok) done++;
        else refused.push(r.error);
      }
      revalidatePath(`${CFA_BASE}/submissions`);
      revalidatePath(CFA_BASE);
      if (done === 0) return { error: `Nothing was changed. ${refused[0] ?? ''}` };
      return {
        ok: true,
        message:
          `${done} submission${done === 1 ? '' : 's'} ${verdict === 'accept' ? 'accepted; each speaker with an address on file was emailed their link' : 'rejected; nothing was sent'}.` +
          (refused.length ? ` ${refused.length} left unchanged: ${refused[0]}` : ''),
      };
    }

    const result = await decideMany({
      ids,
      accept: verdict === 'accept',
      waitlist: verdict === 'waitlist',
      note: String(formData.get('note') ?? '') || undefined,
      notify: formData.get('notify') === 'on',
      actor,
    });
    if (!result.ok) return { error: result.error };

    revalidatePath(`${CFA_BASE}/submissions`);
    revalidatePath(CFA_BASE);
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('submission.bulkDecide', err);
    return { error: 'Could not record the decisions. Reload the list to see what was saved.' };
  }
}

/** Keep one reviewer away from this submission, whether or not they hold it yet. */
export async function excludeReviewerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const submissionId = String(formData.get('submissionId') ?? '');
  const reviewerId = String(formData.get('reviewerId') ?? '');
  if (!submissionId || !reviewerId) return { error: 'Choose a reviewer.' };

  const result = await excludeReviewer({
    submissionId,
    reviewerId,
    note: String(formData.get('note') ?? '') || undefined,
    actor,
  });
  if (!result.ok) return { error: result.error };

  revalidate(submissionId);
  revalidatePath(`${CFA_BASE}/reviewers`);
  return { ok: true, message: result.message };
}

export async function liftExclusionAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const submissionId = String(formData.get('submissionId') ?? '');
  const reviewerId = String(formData.get('reviewerId') ?? '');
  if (!submissionId || !reviewerId) return;

  const result = await liftExclusion({ submissionId, reviewerId, actor });
  if (!result.ok) recordError('reviewer.liftExclusion', new Error(result.error));
  revalidate(submissionId);
  revalidatePath(`${CFA_BASE}/reviewers`);
}

/** Whether a submission's call runs Min's rolling review. */
async function onRollingReview(submissionId: string): Promise<boolean> {
  const sub = await getSubmission(submissionId);
  if (!sub) return false;
  return Boolean((await getCfpCall(sub.callId))?.enabled);
}
