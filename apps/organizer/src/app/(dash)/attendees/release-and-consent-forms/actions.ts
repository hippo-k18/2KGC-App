'use server';

import { revalidatePath } from 'next/cache';
import type { ConsentAudience } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { getConsentForm, saveConsentForm } from '@/lib/consents';
import { recordError } from '@/lib/errors';

export interface ConsentFormState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const AUDIENCES: ConsentAudience[] = ['attendee', 'speaker', 'volunteer'];
const STATUSES = ['draft', 'published', 'cancelled'] as const;

/**
 * Publishing a release.
 *
 * ── The one rule worth stating twice ────────────────────────────────────────
 *
 * Changing the wording of a form that people have already signed does **not**
 * change what they signed. It publishes a new version, and everybody who signed
 * the old one becomes outstanding against the new one. That is not a
 * limitation to work around — it is the property that makes a stored consent
 * worth anything, and there is deliberately no "minor edit" switch that would
 * let an organizer alter the text under signatures already given.
 *
 * The screen says so before the save as well as after it, because "I only fixed
 * a typo and now forty speakers are unsigned" is a surprise worth spending a
 * paragraph to avoid.
 *
 * ── Not in the audit log, and that is a real gap ────────────────────────────
 *
 * ⚠️ `lib/audit.ts` has no `consent.*` action, so publishing a release writes no
 * audit entry — the only record of who changed the wording is `updatedBy` and
 * `updatedAt` on the form itself, which is one name and one date rather than a
 * before-and-after. For the collection in this project that is most likely to be
 * asked about after the fact, that is the wrong way round. It is listed on the
 * screen's gap panel rather than quietly left out.
 */
export async function saveConsentFormAction(
  _prev: ConsentFormState,
  formData: FormData,
): Promise<ConsentFormState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const audience = String(formData.get('audience') ?? '') as ConsentAudience;
  const status = String(formData.get('status') ?? 'draft') as (typeof STATUSES)[number];
  const required = formData.get('required') === 'on';

  if (title.length < 3) return { error: 'Give the form a title.' };
  if (body.length < 40) {
    /*
     * A floor rather than a nicety. Forty characters is about one sentence, and
     * a release that fits in less than that is almost certainly a placeholder
     * somebody meant to come back to — which would then be the wording a
     * hundred people are recorded as having agreed to.
     */
    return {
      error:
        'The wording is too short to be an agreement. Paste the actual text people are being ' +
        'asked to agree to — it is what every signature will be stored against.',
    };
  }
  if (!AUDIENCES.includes(audience)) return { error: 'Choose who this form is for.' };
  if (!STATUSES.includes(status)) return { error: 'Choose a status.' };

  try {
    const existing = id ? await getConsentForm(id) : null;
    const saved = await saveConsentForm({
      id: id || undefined,
      title,
      body,
      audience,
      required,
      status,
      actor,
    });

    revalidatePath('/attendees/release-and-consent-forms');
    revalidatePath('/content/speaker-center/release-and-consent-forms');
    revalidatePath('/attendees/call-for-volunteers/release-and-consent-forms');

    if (!existing) {
      return { ok: true, message: `Created “${title}” at version 1.` };
    }
    if (saved.versionBumped) {
      return {
        ok: true,
        message:
          `The wording changed, so this is now version ${saved.version}. Everybody who signed ` +
          `version ${saved.version - 1} is outstanding against the new text — their earlier ` +
          'agreement still stands for what it said, and it does not cover this.',
      };
    }
    return {
      ok: true,
      message: `Saved “${title}”. The wording is unchanged, so version ${saved.version} still stands and nobody has to sign again.`,
    };
  } catch (err) {
    recordError('consent.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the form.' };
  }
}
