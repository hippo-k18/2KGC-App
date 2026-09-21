'use server';

import { revalidatePath } from 'next/cache';
import type { ConsentAudience } from '@kgc/shared';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import {
  getConsentForm,
  saveConsentForm,
  sendSigningLinks,
  signingSendPlan,
} from '@/lib/consents';
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
 * ── Publishing is not the send ──────────────────────────────────────────────
 *
 * ⚠️ It used to be. Saving with the status `published` mailed everybody who had
 * not signed, from inside this action, with no count and no confirmation — so
 * correcting a sentence in a photo release wrote to a thousand people, and a
 * request that timed out halfway left nobody able to say who had been reached.
 *
 * Publishing now saves, and nothing else. The register screen counts who is
 * outstanding and offers the send as its own step, behind a typed count and the
 * passphrase. The message below says how many are waiting and where the button
 * is, so publication still ends by pointing at the thing that has to happen
 * next. `saveConsentForm` writes the audit entry that records who published
 * which wording.
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
     * Nothing is mailed here. The line below counts who is waiting and says
     * where to send from, which is the same information the old automatic send
     * acted on — with a person deciding instead of a save.
     */
    const firstPublication = status === 'published' && existing?.status !== 'published';
    const worthAsking = status === 'published' && (firstPublication || saved.versionBumped);
    const plan = worthAsking ? await signingSendPlan(saved.id) : null;

    const sendLine = (() => {
      if (!plan) return '';
      if (!plan.available) {
        return ' Signing links cannot be sent yet: the link setup is not finished.';
      }
      if (plan.pending === 0 && plan.noAddress === 0) {
        return ' Everybody has already signed it, so there is nobody to write to.';
      }
      return (
        ` ${plan.pending} ${plan.pending === 1 ? 'person is' : 'people are'} waiting to sign it.` +
        (plan.noAddress > 0
          ? ` ${plan.noAddress} ${plan.noAddress === 1 ? 'of them has' : 'of them have'} no address on file.`
          : '') +
        ' Open the form to send them their links.'
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

/**
 * Send the signing links, as a step of its own.
 *
 * ── The three guards, and what each one stops ───────────────────────────────
 *
 * A **typed count**, which is the number the screen just showed. It catches the
 * case that matters: an audience that silently resolved to everybody. Mailing a
 * thousand people a link that signs a legal release in their name is not
 * recoverable, and finding out afterwards is the wrong way round.
 *
 * The **passphrase**, for the same reason a refund asks for it. A session lasts
 * eight hours and an unattended dashboard is the normal state of a conference.
 *
 * And **the log**, which is not a guard on this press but on the next one.
 * Every recipient is written to `emailLog` under one campaign id per form and
 * version, so a press after a timeout picks up where the last one stopped. The
 * count is re-read here rather than trusted from the form, so two organizers
 * pressing at once cannot both be told they are sending to the same people.
 */
export async function sendSigningLinksAction(
  _prev: ConsentFormState,
  formData: FormData,
): Promise<ConsentFormState> {
  const actor = await requireOrganizer();

  const formId = String(formData.get('formId') ?? '').trim();
  const typed = String(formData.get('confirmCount') ?? '').trim();
  const passphrase = String(formData.get('passphrase') ?? '');

  if (!formId) return { error: 'That form is no longer here.' };

  try {
    const plan = await signingSendPlan(formId);
    if (!plan) return { error: 'That form is no longer here.' };
    if (!plan.available) {
      return { error: 'Signing links cannot be sent yet. Ask your administrator to finish the website link setup.' };
    }
    if (plan.pending === 0) {
      return {
        error:
          plan.reachable === 0
            ? 'There is nobody to write to. Everybody in this audience has either signed it or has no address on file.'
            : 'Everybody waiting to sign this version has already been sent their link.',
      };
    }

    if (!(await reauthenticate(passphrase))) {
      return { error: 'That passphrase is not correct. Nothing has been sent.' };
    }

    if (Number(typed) !== plan.pending) {
      return {
        error: `Type ${plan.pending} to confirm. That is how many people will be emailed.`,
      };
    }

    const result = await sendSigningLinks({ formId, actor });

    revalidatePath('/attendees/release-and-consent-forms');
    revalidatePath('/content/speaker-center/release-and-consent-forms');
    revalidatePath('/attendees/call-for-volunteers/release-and-consent-forms');

    const reached = process.env.RESEND_API_KEY
      ? `Sent ${result.sent} ${result.sent === 1 ? 'link' : 'links'}.`
      : `${result.sent} ${result.sent === 1 ? 'link is' : 'links are'} ready. Email is not switched on yet, so nothing went out.`;

    const more = result.remaining > 0
      ? ` ${result.remaining} still to go. Press Send again to reach them; nobody is written to twice.`
      : '';

    const unreachable = result.noAddress > 0
      ? ` ${result.noAddress} ${result.noAddress === 1 ? 'person has' : 'people have'} no address on file and got nothing.`
      : '';

    return { ok: true, message: reached + more + unreachable };
  } catch (err) {
    recordError('consent.sendLinks', err);
    return { error: 'That did not finish. Nobody is written to twice, so press Send again.' };
  }
}
