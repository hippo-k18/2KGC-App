'use server';

import { revalidatePath } from 'next/cache';
import type { ConsentAudience } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { getConsentForm, saveConsentForm, sendSigningLinks } from '@/lib/consents';
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
 * ── Publishing is also the send ─────────────────────────────────────────────
 *
 * First publication, and any republication whose wording moved, mails the
 * signing link to everybody who has not signed. A save that changes neither
 * sends nothing, which is why the condition below is not simply "status is
 * published": correcting a comma in a title must not write to a hundred people.
 * `saveConsentForm` writes the audit entry that records who published which
 * wording.
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
        'asked to agree to. It is what every signature will be stored against.',
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
    revalidatePath('/attendees/name-badges');
    revalidatePath('/attendees/check-in-and-checkout/check-in');

    /*
     * Publication is the moment people are asked, so it is the moment the links
     * go out — first publication, and any republication whose wording moved.
     * Saving a typo in a title sends nothing, which is why this is not simply
     * "status is published".
     */
    const firstPublication = status === 'published' && existing?.status !== 'published';
    const sending = status === 'published' && (firstPublication || saved.versionBumped);
    const sends = sending ? await sendSigningLinks({ formId: saved.id, actor }) : null;

    const sendLine = (() => {
      if (!sends) return '';
      if (!sends.available) return ' Signing links could not be sent: the link setup is not finished.';
      if (sends.sent === 0 && sends.noAddress === 0) return ' Everybody has already signed it.';
      const note = process.env.RESEND_API_KEY
        ? ` Signing links went to ${sends.sent} ${sends.sent === 1 ? 'person' : 'people'}.`
        : ` ${sends.sent} signing ${sends.sent === 1 ? 'link is' : 'links are'} ready to send. Email is not set up yet, so nothing went out.`;
      return (
        note +
        (sends.noAddress > 0
          ? ` ${sends.noAddress} ${sends.noAddress === 1 ? 'person has' : 'people have'} no address on file.`
          : '')
      );
    })();

    if (!existing) {
      return { ok: true, message: `Created “${title}” at version 1.${sendLine}` };
    }
    if (saved.versionBumped) {
      return {
        ok: true,
        message:
          `The wording changed, so this is now version ${saved.version}. Everybody who signed ` +
          `version ${saved.version - 1} is outstanding against the new text. Their earlier ` +
          'agreement still stands for what it said, and it does not cover this.' +
          sendLine,
      };
    }
    return {
      ok: true,
      message: `Saved “${title}”. The wording is unchanged, so version ${saved.version} still stands and nobody has to sign again.${sendLine}`,
    };
  } catch (err) {
    recordError('consent.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the form.' };
  }
}
