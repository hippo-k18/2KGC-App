'use server';

import { revalidatePath } from 'next/cache';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { erasePerson, resolvePerson } from '@/lib/person-data';
import { PersonKeyMismatch, parsePersonRef } from '@/lib/person-data-core';
import type { FormState } from '../../../form';

/**
 * The write side of the data panel: one action, and the only one in the
 * dashboard that destroys a person.
 *
 * Thin like its neighbours in `edit-actions.ts`. It checks the session, turns
 * the row's parameter back into a person, and hands over to `lib/person-data.ts`
 * — which holds the walk, the typed-confirmation check and the audit entry.
 *
 * ⚠️ The person is resolved **server-side from the row parameter**, and the
 * typed confirmation is checked against the address that resolution returned.
 * The address is never posted. A form that carried both would let a tampered
 * field confirm one person and erase another.
 *
 * ── Why the passphrase is asked for again ───────────────────────────────────
 *
 * The same argument `refundOrderAction` makes, and it is stronger here. A
 * session cookie lasts eight hours and an unattended laptop at a registration
 * desk is the normal state of a conference, so the typed address alone is not
 * a guard — it is printed on the screen directly above the box. A passer-by
 * could copy it and permanently delete somebody's ticket, profile, messages,
 * posts and sign-in account. A refund can be reversed and this cannot, so the
 * one irreversible destroy in this dashboard gets at least what the reversible
 * one gets.
 */
export async function erasePersonAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOrganizer();

  const ref = parsePersonRef(String(formData.get('ref') ?? ''));
  if (!ref) return { error: 'That attendee is no longer on the list.' };

  if (!(await reauthenticate(String(formData.get('passphrase') ?? '')))) {
    return { error: 'That passphrase is not correct. Nothing has been deleted.' };
  }

  try {
    const identity = await resolvePerson(ref);
    if (!identity) return { error: 'That attendee is no longer on the list.' };

    const result = await erasePerson(identity, String(formData.get('confirm') ?? ''), actor);
    if (!result.ok) return { error: result.error };

    revalidatePath(ROUTES.attendees);
    revalidatePath(ROUTES.checkIn);
    revalidatePath(ROUTES.analyticsExports);
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('attendee.erase', err);
    /*
     * A mismatch is refused before anything is touched, so it must not read as
     * a half-finished deletion. It means the row pointed at a ticket belonging
     * to somebody other than the account beside it.
     */
    if (err instanceof PersonKeyMismatch) return { error: err.message };
    return { error: 'That did not finish. Check what is left and try again.' };
  }
}
