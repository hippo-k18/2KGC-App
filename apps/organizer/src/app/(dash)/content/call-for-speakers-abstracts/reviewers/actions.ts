'use server';

import { revalidatePath } from 'next/cache';
import type { ReviewerStatus } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import {
  assignByTrack,
  assignReviewer,
  inviteReviewer,
  listReviewers,
  sendInvitation,
  setReviewerStatus,
} from '@/lib/reviewers';
import { applyDefaultRubric, deleteCriterion, moveCriterion, saveCriterion } from '@/lib/rubric';
import { getCall } from '@/lib/calls';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { CFA_BASE } from '../routes';

/**
 * Committee membership, the scoring criteria, assignment and the invitation.
 *
 * Adding a reviewer sends nothing. The invitation is its own button, pressed
 * once assignments are made, so the mail can say how many submissions are
 * waiting and the link it carries opens onto real work.
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

// ---------------------------------------------------------------------------
// The invitation
// ---------------------------------------------------------------------------

/** The value the reviewer select posts for "everyone". */
const EVERYONE = '__all';

/**
 * Email one reviewer, or the whole committee, their review link.
 *
 * "Everyone" means everybody whose link would open: invited or accepted, not
 * declined and not removed. It is also the reminder, since every send carries a
 * fresh link.
 */
export async function sendInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  const reviewerId = String(formData.get('reviewerId') ?? '');
  const note = String(formData.get('note') ?? '') || undefined;
  if (!callId) return { error: 'No call was named.' };
  if (!reviewerId) return { error: 'Choose who to invite.' };

  try {
    if (reviewerId !== EVERYONE) {
      const result = await sendInvitation({ reviewerId, callId, note, actor });
      if (!result.ok) return { error: result.error };
      revalidate();
      return { ok: true, message: result.message };
    }

    const committee = (await listReviewers()).filter(
      (r) => r.status === 'invited' || r.status === 'accepted',
    );
    if (committee.length === 0) return { error: 'There is nobody on the committee to invite.' };

    let last = '';
    let failed = 0;
    for (const r of committee) {
      const result = await sendInvitation({ reviewerId: r.id, callId, note, actor });
      if (result.ok) last = result.message;
      else failed++;
    }
    revalidate();
    return {
      ok: true,
      message:
        last.startsWith('Email is not switched on')
          ? 'Email is not switched on yet, so nothing was sent. Copy each link and send it yourself.'
          : `Invitation sent to ${committee.length - failed} reviewer${committee.length - failed === 1 ? '' : 's'}.` +
            (failed ? ` ${failed} could not be sent.` : ''),
    };
  } catch (err) {
    recordError('reviewer.sendInvitation', err);
    return { error: err instanceof Error ? err.message : 'Could not send the invitation.' };
  }
}

// ---------------------------------------------------------------------------
// Scoring criteria
// ---------------------------------------------------------------------------

export async function saveCriterionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  if (!callId) return { error: 'No call was named.' };

  const result = await saveCriterion({
    callId,
    id: String(formData.get('id') ?? '') || undefined,
    label: String(formData.get('label') ?? ''),
    description: String(formData.get('description') ?? ''),
    min: Number(formData.get('min') ?? NaN),
    max: Number(formData.get('max') ?? NaN),
    actor,
  });
  if (!result.ok) return { error: result.error };
  revalidate();
  return { ok: true, message: result.message };
}

export async function defaultCriteriaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  if (!callId) return { error: 'No call was named.' };

  const result = await applyDefaultRubric({ callId, actor });
  if (!result.ok) return { error: result.error };
  revalidate();
  return { ok: true, message: result.message };
}

export async function deleteCriterionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!callId || !id) return { error: 'No criterion was named.' };

  const result = await deleteCriterion({ callId, id, actor });
  if (!result.ok) return { error: result.error };
  revalidate();
  return { ok: true, message: result.message };
}

export async function moveCriterionAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  const id = String(formData.get('id') ?? '');
  const direction = String(formData.get('direction') ?? '');
  if (!callId || !id || (direction !== 'up' && direction !== 'down')) return;

  const result = await moveCriterion({ callId, id, direction, actor });
  if (!result.ok) recordError('rubric.move', new Error(result.error));
  revalidate();
}
