'use server';

import { revalidatePath } from 'next/cache';
import type { BlindReviewMode, PublishStatus, SessionFormat } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { saveCall } from '@/lib/calls';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../form';
import { CFA_BASE } from './routes';

/**
 * Everything the call-setup screen writes.
 *
 * ⚠️ The dates are the only fields on this form that change who may write to
 * Firestore. `calls` and `submissions` have no `match` block in
 * `firestore.rules` — every write is Admin-SDK — so the closing date is enforced
 * by the public portal's server action and by nothing else. Editing it here is
 * therefore a security-relevant act, and it is audited as one.
 */

const FORMATS: SessionFormat[] = ['keynote', 'talk', 'panel', 'workshop', 'poster', 'social'];
const BLIND: BlindReviewMode[] = ['open', 'single-blind', 'double-blind'];
const STATUSES: PublishStatus[] = ['draft', 'published', 'cancelled'];

/** Every ticked box under one name, as an array. */
const many = (formData: FormData, name: string) =>
  formData.getAll(name).map(String).filter(Boolean);

export async function saveCallAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const status = String(formData.get('status') ?? 'draft') as PublishStatus;
  const blindReview = String(formData.get('blindReview') ?? 'single-blind') as BlindReviewMode;

  if (!STATUSES.includes(status)) return { error: 'Choose a status.' };
  if (!BLIND.includes(blindReview)) return { error: 'Choose how much reviewers see.' };

  const sessionTypes = many(formData, 'sessionTypes').filter((t): t is SessionFormat =>
    FORMATS.includes(t as SessionFormat),
  );

  /*
   * Split on commas *and* newlines, because an organizer pasting a list of
   * addresses out of a mail client gets one per line and one who types them
   * gets commas. Rejecting either is a form that only works for people who
   * guessed how it wanted to be filled in.
   */
  const notifyEmails = String(formData.get('notifyEmails') ?? '')
    .split(/[\n,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const reminderDaysBefore = String(formData.get('reminderDaysBefore') ?? '')
    .split(/[\n,;\s]+/)
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d > 0)
    .sort((a, b) => b - a);

  try {
    const result = await saveCall({
      id: id || undefined,
      title: String(formData.get('title') ?? ''),
      instructions: String(formData.get('instructions') ?? ''),
      status,
      opensAtLocal: String(formData.get('opensAtLocal') ?? ''),
      closesAtLocal: String(formData.get('closesAtLocal') ?? ''),
      sessionTypes,
      trackIds: many(formData, 'trackIds'),
      blindReview,
      reviewsPerSubmission: Number(formData.get('reviewsPerSubmission') ?? 3),
      reminderDaysBefore,
      notifyEmails,
      actor,
    });

    if (!result.ok) return { error: result.error };

    revalidatePath(CFA_BASE);
    revalidatePath(`${CFA_BASE}/submissions`);
    revalidatePath(`${CFA_BASE}/form-builder`);
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('call.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the call.' };
  }
}
