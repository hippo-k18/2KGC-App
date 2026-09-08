'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { promoteSubmission } from '@/lib/submissions';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import type { FormState } from '../../../../form';

/**
 * Putting one accepted abstract onto the agenda.
 *
 * ── Why this is a form and not a button ────────────────────────────────────
 *
 * The three fields it asks for — a start, an end and a room — are exactly the
 * three things acceptance does not decide, which is the whole argument for this
 * being a separate step (`CFA-PLAN.md` §4). A one-click "promote" would have to
 * invent them, and a session at midnight in no room is a session somebody has to
 * find and fix later.
 */
export async function promoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const submissionId = String(formData.get('submissionId') ?? '');
  const startsAtLocal = String(formData.get('startsAtLocal') ?? '');
  const endsAtLocal = String(formData.get('endsAtLocal') ?? '');
  if (!submissionId) return { error: 'No submission was named.' };
  if (!startsAtLocal || !endsAtLocal) return { error: 'A session needs a start and an end.' };

  try {
    const result = await promoteSubmission({
      submissionId,
      startsAtLocal,
      endsAtLocal,
      roomId: String(formData.get('roomId') ?? '') || undefined,
      actor,
    });

    if (!result.ok) return { error: result.error };

    revalidatePath('/content/agenda-center/session-manager/from-accepted');
    revalidatePath(ROUTES.sessionManager);
    revalidatePath(ROUTES.speakerManager);
    revalidatePath(ROUTES.conflictCheck);
    revalidatePath('/content/call-for-speakers-abstracts/submissions');
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('submission.promote', err);
    return { error: err instanceof Error ? err.message : 'Could not promote the submission.' };
  }
}
