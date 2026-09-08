'use server';

import { revalidatePath } from 'next/cache';
import type { ReviewerStatus } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { assignByTrack, assignReviewer, inviteReviewer, setReviewerStatus } from '@/lib/reviewers';
import { getCall } from '@/lib/calls';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { CFA_BASE } from '../routes';

/**
 * Committee membership and assignment.
 *
 * ⚠️ **Nothing here sends an email.** A committee invitation is normally one
 * paragraph inside a longer personal message, and a templated blast is the wrong
 * shape for it — so the reviewer is recorded and the organizer writes to them
 * themselves. The screen says that rather than letting the word "invite" imply
 * a message went out.
 */

const STATUSES: ReviewerStatus[] = ['invited', 'accepted', 'declined', 'removed'];

function revalidate(): void {
  revalidatePath(`${CFA_BASE}/reviewers`);
  revalidatePath(`${CFA_BASE}/submissions`);
}

export async function inviteReviewerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOrganizer();

  try {
    const result = await inviteReviewer({
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      affiliation: String(formData.get('affiliation') ?? '') || undefined,
      trackIds: formData.getAll('trackIds').map(String).filter(Boolean),
      maxAssignments: Number(formData.get('maxAssignments') ?? 10),
      actor,
    });

    if (!result.ok) return { error: result.error };
    revalidate();
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('reviewer.invite', err);
    return { error: err instanceof Error ? err.message : 'Could not add the reviewer.' };
  }
}

export async function setReviewerStatusAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') as ReviewerStatus;
  if (!id || !STATUSES.includes(status)) return;

  const result = await setReviewerStatus({ id, status, actor });
  if (!result.ok) recordError('reviewer.setStatus', new Error(result.error));
  revalidate();
}

/**
 * Assign one reviewer one submission, by hand.
 *
 * The manual path exists because assignment by track cannot cover everything: a
 * submission with no track, a reviewer whose expertise is not a track, a paper
 * the chair wants a specific person to read. It is the one assignment that needs
 * no matcher and no explanation.
 */
export async function assignReviewerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOrganizer();

  const submissionId = String(formData.get('submissionId') ?? '');
  const reviewerId = String(formData.get('reviewerId') ?? '');
  if (!submissionId || !reviewerId) return { error: 'Choose a submission and a reviewer.' };

  try {
    const result = await assignReviewer({ submissionId, reviewerId, by: 'manual', actor });
    if (!result.ok) return { error: result.error };
    revalidate();
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('reviewer.assign', err);
    return { error: err instanceof Error ? err.message : 'Could not assign the reviewer.' };
  }
}

/**
 * Assign everybody whose tracks overlap, up to the call's target.
 *
 * ⚠️ It runs immediately and it is not a preview. Assignments are cheap to make
 * and awkward to unpick — a review document exists from the moment of
 * assignment, which is what makes reviewer progress a query — so the button says
 * how many it made rather than asking first.
 */
export async function assignByTrackAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  if (!callId) return { error: 'No call was named.' };

  try {
    const call = await getCall(callId);
    if (!call) return { error: 'That call does not exist.' };

    const result = await assignByTrack({
      callId,
      reviewsPerSubmission: call.reviewsPerSubmission,
      actor,
    });
    if (!result.ok) return { error: result.error };
    revalidate();
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('reviewer.assignByTrack', err);
    return { error: err instanceof Error ? err.message : 'Could not assign by track.' };
  }
}
